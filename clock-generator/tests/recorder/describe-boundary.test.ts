// The recorder's own Lua reaches the Lua that describes a build (scripts/describe/) only through `recorder.lua`, and only
// through the calls that `recorder.describe` makes too. A recording is keyed on what that Lua made of the build (the folder
// is left out of the recorder's fingerprint, src/harness/recording-cache.ts), so a call into it from anywhere else, say one
// made every tick, would change what a recording holds without changing its key.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const RECORDER = path.resolve(__dirname, "../../../clock-generator-recorder");
const DESCRIBE_PREFIX = "__clock-generator-recorder__.scripts.describe.";

/** The only calls of the recorder into the folder: the module they are read from, and what is called there */
const ENTRY_POINTS: Record<string, string[]> = {
    extraction: ["extract_all_entities"],
    export: ["exported_inserters", "drill_target", "left_out_inserters", "left_out_drills", "to_table"],
    // required for the types it declares and called for nothing
    types: [],
};

/** The text of Lua with its comments cut out and its strings kept, so a word in a comment is not a call */
function withoutComments(source: string): string {
    let out = "";
    for (let i = 0; i < source.length;) {
        const rest = source.slice(i);
        const long = /^--\[(=*)\[/.exec(rest);
        if (long) {
            const end = source.indexOf(`]${long[1]}]`, i + long[0].length);
            i = end < 0 ? source.length : end + long[1].length + 2;
        } else if (rest.startsWith("--")) {
            const end = source.indexOf("\n", i);
            i = end < 0 ? source.length : end;
        } else if (rest[0] === '"' || rest[0] === "'") {
            let j = i + 1;
            while (j < source.length && source[j] !== rest[0] && source[j] !== "\n") {
                j += source[j] === "\\" ? 2 : 1;
            }
            out += source.slice(i, j + 1);
            i = j + 1;
        } else {
            out += source[i++];
        }
    }
    return out;
}

/** What `file`, given as its name and text, takes from the folder that is not allowed; empty when it takes nothing it should not */
function trespasses(name: string, source: string, may_require: boolean): string[] {
    const text = withoutComments(source);
    const found: string[] = [];
    const requires = [...text.matchAll(/(?:local\s+(\w+)\s*=\s*)?require\s*\(?\s*["']([^"']+)["']/g)];
    const bindings = new Map<string, string>();
    for (const [, binding, module] of requires) {
        if (!module.includes("scripts.describe")) {
            continue;
        }
        if (!may_require) {
            found.push(`${name} requires ${module}: only recorder.lua may`);
            continue;
        }
        const wanted = module.startsWith(DESCRIBE_PREFIX) ? module.slice(DESCRIBE_PREFIX.length) : "";
        if (!(wanted in ENTRY_POINTS)) {
            found.push(`${name} requires ${module}: it may require ${Object.keys(ENTRY_POINTS).join(", ")}`);
        } else if (binding) {
            bindings.set(binding, wanted);
        }
    }
    for (const [binding, module] of bindings) {
        const uses = [...text.matchAll(new RegExp(`(?<![\\w.])${binding}\\b(?!\\s*=[^=])(\\s*[.:]\\s*(\\w+))?`, "g"))]
            // the line that binds it is not a use
            .filter(use => !new RegExp(`local\\s+${binding}\\s*=\\s*require`).test(text.slice(Math.max(0, use.index - 12), use.index + use[0].length)));
        for (const use of uses) {
            const member = use[2];
            if (member === undefined) {
                found.push(`${name} uses the module ${binding} (${module}) as a value: it may only call ${ENTRY_POINTS[module].join(", ") || "nothing"} on it`);
            } else if (!ENTRY_POINTS[module].includes(member)) {
                found.push(`${name} calls ${binding}.${member} (${module}): it may call ${ENTRY_POINTS[module].join(", ") || "nothing"}`);
            }
        }
    }
    return found;
}

/** The Lua files of the recorder mod that are not in the folder of the description: what runs in the game besides it */
function recorderFiles(): string[] {
    const own = ["control.lua", "data.lua", "settings.lua"].map(name => path.join(RECORDER, name));
    const scripts = fs.readdirSync(path.join(RECORDER, "scripts"), { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(".lua"))
        .map(entry => path.join(RECORDER, "scripts", entry.name));
    return [...own, ...scripts].filter(file => fs.existsSync(file));
}

describe("the recorder's reach into the Lua that describes a build", () => {
    const files = recorderFiles();

    it("holds the files of the description, and the recorder's own files that are checked", () => {
        expect(fs.readdirSync(path.join(RECORDER, "scripts", "describe")).sort()).toEqual([
            "drop-merge.lua", "export.lua", "extraction.lua", "helpers.lua", "pickup-supply.lua", "suggested-target.lua", "types.lua",
        ]);
        expect(files.map(file => path.relative(RECORDER, file)).sort()).toEqual(
            ["control.lua", "data.lua", "scripts/harness.lua", "scripts/recorder.lua", "settings.lua"]);
    });

    it("is checked against a recorder.lua that does reach the folder, so a wrong path cannot pass for no reach", () => {
        const recorder = fs.readFileSync(path.join(RECORDER, "scripts", "recorder.lua"), "utf8");
        const required = [...withoutComments(recorder).matchAll(/require\s*\(\s*["']([^"']+)["']/g)].map(match => match[1]);
        expect(required.filter(module => module.startsWith(DESCRIBE_PREFIX)).sort()).toEqual(
            [`${DESCRIBE_PREFIX}export`, `${DESCRIBE_PREFIX}extraction`, `${DESCRIBE_PREFIX}types`]);
    });

    it("is reached from recorder.lua only, and only through the entry points of recorder.describe", () => {
        const found = files.flatMap(file => trespasses(path.relative(RECORDER, file), fs.readFileSync(file, "utf8"), path.basename(file) === "recorder.lua"));
        expect(found).toEqual([]);
    });

    it("sees a require from another file, a call to anything else, a module taken as a value, and ignores a comment", () => {
        const header = `require("${DESCRIBE_PREFIX}types")\nlocal extraction = require("${DESCRIBE_PREFIX}extraction")\nlocal export = require("${DESCRIBE_PREFIX}export")\n`;
        expect(trespasses("recorder.lua", `${header}local a = export.to_table(r) + extraction.extract_all_entities(e, f)\n-- export.drop_marks\n`, true)).toEqual([]);
        expect(trespasses("recorder.lua", `${header}local a = export.drop_marks(r)\n`, true)).toEqual([expect.stringContaining("export.drop_marks")]);
        expect(trespasses("recorder.lua", `${header}local a = extraction.extract_group(r)\n`, true)).toEqual([expect.stringContaining("extraction.extract_group")]);
        expect(trespasses("recorder.lua", `${header}helper(export)\n`, true)).toEqual([expect.stringContaining("as a value")]);
        expect(trespasses("recorder.lua", `${header}local h = require("${DESCRIBE_PREFIX}helpers")\n`, true)).toEqual([expect.stringContaining("helpers")]);
        expect(trespasses("harness.lua", `local export = require("${DESCRIBE_PREFIX}export")\n`, false)).toEqual([expect.stringContaining("only recorder.lua may")]);
        expect(trespasses("harness.lua", `local recorder = require("scripts.recorder")\nrecorder.describe()\n`, false)).toEqual([]);
    });
});
