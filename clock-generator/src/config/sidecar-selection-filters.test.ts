import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sidecar's selection tool hands the extraction only the entities its `entity_type_filters` let through, while the
 * harness extracts by script and never meets the filters. So a type the extraction reads but the tool cannot select is
 * missed in a player's selection only: the silo, car and cargo wagon were (#294, #301). This reads both Lua files as
 * text, as the mod has no Lua runtime in the tests.
 */
const sidecar = path.resolve(__dirname, "..", "..", "..", "clock-generator-sidecar");
const read = (file: string) => withoutComments(fs.readFileSync(path.join(sidecar, file), "utf8"));

/** Lua with its comments removed, strings kept: a quoted type in a comment is no type the code reads */
function withoutComments(lua: string): string {
    let out = "";
    let i = 0;
    while (i < lua.length) {
        const char = lua[i];
        if (char === '"' || char === "'") {
            let end = i + 1;
            while (end < lua.length && lua[end] !== char) end += lua[end] === "\\" ? 2 : 1;
            out += lua.slice(i, end + 1);
            i = end + 1;
        } else if (lua.startsWith("--", i)) {
            const long = /^--\[(=*)\[/.exec(lua.slice(i));
            const end = long ? lua.indexOf(`]${long[1]}]`, i) : lua.indexOf("\n", i);
            i = end === -1 ? lua.length : (long ? end + long[1].length + 2 : end);
        } else {
            out += char;
            i++;
        }
    }
    return out;
}

/** The table that follows `name = {` in the text, without its outer braces */
function tableAfter(text: string, name: string): string {
    const start = new RegExp(`\\b${name}\\s*=\\s*\\{`).exec(text);
    if (!start) throw new Error(`No ${name} = { ... } in the sidecar's Lua`);
    let depth = 0;
    for (let i = start.index + start[0].length - 1; i < text.length; i++) {
        if (text[i] === "{") depth++;
        if (text[i] === "}" && --depth === 0) return text.slice(start.index + start[0].length, i);
    }
    throw new Error(`${name} = { ... } is not closed`);
}

/** The body of a top-level function, up to the `end` at the start of a line that closes it */
function functionBody(text: string, name: string): string {
    const start = new RegExp(`^(?:local )?function ${name.replace(".", "\\.")}\\(`, "m").exec(text);
    if (!start) throw new Error(`No function ${name} in the extraction`);
    const end = /^end\b/m.exec(text.slice(start.index));
    if (!end) throw new Error(`function ${name} has no end at the start of a line`);
    return text.slice(start.index, start.index + end.index);
}

const strings = (text: string) => Array.from(text.matchAll(/"([^"]*)"/g), match => match[1]);
/**
 * The entity types a piece of the extraction compares an entity's type with (`entity.type == "car"`, `t == "car"`); a
 * field of a table, such as `data.source.type == "belt"`, is the sidecar's own kind of end, not an entity type
 */
const typesComparedIn = (text: string) =>
    Array.from(text.matchAll(/(?<![\w.])(?:\w+\.type|t)\s*[=~]=\s*"([a-z0-9-]+)"/g), match => match[1]);

const data = read("data.lua");
const extraction = read("scripts/extraction.lua");

/** What the extraction reads from a selection, by where it reads it */
const read_types = {
    chests: typesComparedIn(functionBody(extraction, "is_chest_entity")),
    machines: typesComparedIn(functionBody(extraction, "extract_machine_data")),
    // drills, inserters and the pieces of belts: each pass over the selected entities
    passes: typesComparedIn(functionBody(extraction, "extraction.extract_all_entities")),
};

describe("the sidecar's selection tool", () => {
    it("reads what the extraction reads", () => {
        // a sanity check of the parsing, so that a rename cannot empty the lists and pass
        expect(read_types.chests).toEqual(expect.arrayContaining(["container", "car", "cargo-wagon", "rocket-silo"]));
        expect(read_types.machines).toEqual(expect.arrayContaining(["assembling-machine", "furnace", "mining-drill"]));
        expect(read_types.passes).toEqual(expect.arrayContaining(["mining-drill", "inserter", "transport-belt", "underground-belt"]));
    });

    it("finds a drill's container among every machine and chest type the extraction exports (#316)", () => {
        // a drill that has not dropped yet is given the machine or chest under its drop position, searched by type
        const sinks = strings(tableAfter(extraction, "DRILL_SINK_TYPES"));
        const exported = [...read_types.chests, ...read_types.machines.filter(type => type !== "mining-drill")];
        expect([...new Set(exported)].filter(type => !sinks.includes(type))).toEqual([]);
        expect(sinks.filter(type => !exported.includes(type))).toEqual([]);
    });

    for (const mode of ["select", "alt_select"]) {
        describe(mode, () => {
            const settings = tableAfter(data, mode);
            const filters = new Set(strings(tableAfter(settings, "entity_type_filters")));

            it.each(Object.entries(read_types))("selects every type the extraction reads for %s", (_, types) => {
                expect(types.filter(type => !filters.has(type))).toEqual([]);
            });

            it("selects entities that are not buildings, such as cars and cargo wagons (#301)", () => {
                // "buildable-type" applies the filters to buildings only
                expect(strings(tableAfter(settings, "mode"))).toContain("any-entity");
            });
        });
    }
});
