import fs from "fs";
import path from "path";
import pako from "pako";
import { describe, expect, it } from "vitest";
import { BlueprintBookBuilder, FactorioBlueprint, FactorioBlueprintFile } from "../blueprints/blueprint";
import { decodeBlueprintFileBrowser, encodeBlueprintFileBrowser } from "../blueprints/serde-browser";
import { BlueprintEntityRead } from "./blueprint-entities";
import { decodeBlueprint, DecodeOutcome } from "./decode";

const ENGINE = path.resolve(__dirname, "../..");

type Counts = Record<string, number>;
type CensusEntry = {
    entities: number;
    version: { major: number; minor: number; patch: number; build: number };
    prototypes: Record<string, Counts>;
};

/** What each of the repository's scaffolds holds, counted from the blueprint text itself and not by this decoder */
const census = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "decode", "decode-census.json"), "utf8")) as Record<string, CensusEntry>;
const SCAFFOLDS = Object.keys(census).sort();

const scaffoldText = (scaffold: string) => fs.readFileSync(path.join(ENGINE, scaffold), "utf8");

/** The blueprint a decoded string holds, or a failure of the test when it holds none */
function read(text: string): Extract<DecodeOutcome, { kind: "blueprint" }> {
    const outcome = decodeBlueprint(text);
    if (outcome.kind !== "blueprint") throw new Error(`expected a blueprint, got the problem ${outcome.problem}`);
    return outcome;
}

const problemOf = (text: string): string => {
    const outcome = decodeBlueprint(text);
    return outcome.kind === "problem" ? outcome.problem : "none";
};

/** The census's counts, taken from the decoded entities: a count of 0 is left out, as the census leaves it out */
function countsOf(entities: BlueprintEntityRead[]): Record<string, Counts> {
    const out: Record<string, Counts> = {};
    for (const e of entities) {
        const counts = (out[e.name] ??= {});
        const add = (key: string, n: number) => {
            if (n > 0) counts[key] = (counts[key] ?? 0) + n;
        };
        const has = (value: unknown) => (value !== undefined ? 1 : 0);
        add("entities", 1);
        add("direction", e.direction !== 0 ? 1 : 0);
        add("mirror", e.mirror ? 1 : 0);
        add("quality", e.quality !== "normal" ? 1 : 0);
        add("recipe", has(e.recipe));
        add("recipe_quality", has(e.recipe_quality));
        add("requests", e.requests.length > 0 ? 1 : 0);
        add("request_rows", e.requests.length);
        add("filters", e.filters.length > 0 ? 1 : 0);
        add("filter_rows", e.filters.length);
        add("use_filters", e.use_filters ? 1 : 0);
        add("filter_mode", has(e.filter_mode));
        add("override_stack_size", has(e.override_stack_size));
        add("bar", has(e.bar));
        add("infinity", has(e.infinity));
        add("infinity_rows", e.infinity?.filters.length ?? 0);
        add("inventory", has(e.inventory));
        add("inventory_rows", e.inventory?.filters.length ?? 0);
        add("orientation", has(e.orientation));
        add("type", has(e.type));
        add("input_priority", has(e.input_priority));
        add("output_priority", has(e.output_priority));
        add("filter", has(e.filter));
        add("control_behavior", has(e.control_behavior));
    }
    return out;
}

const compare = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every list of an entity is in the order its read type states */
function expectSorted(entities: BlueprintEntityRead[]) {
    expect(entities.map(e => e.entity_number)).toStrictEqual(entities.map(e => e.entity_number).sort(compare));
    for (const e of entities) {
        const request = (r: BlueprintEntityRead["requests"][number]) => [r.inventory, r.stack, r.item] as const;
        const sortedRequests = [...e.requests].sort((a, b) => compare(a.inventory, b.inventory) || compare(a.stack, b.stack) || compareText(a.item, b.item));
        expect(e.requests.map(request)).toStrictEqual(sortedRequests.map(request));
        expect(e.filters.map(f => f.index)).toStrictEqual(e.filters.map(f => f.index).sort(compare));
        expect((e.inventory?.filters ?? []).map(f => f.index)).toStrictEqual((e.inventory?.filters ?? []).map(f => f.index).sort(compare));
        const rows = e.infinity?.filters ?? [];
        const firstUnindexed = rows.findIndex(r => r.index === undefined);
        if (firstUnindexed >= 0) expect(rows.slice(firstUnindexed).every(r => r.index === undefined)).toBe(true);
        const indexed = rows.filter(r => r.index !== undefined).map(r => r.index as number);
        expect(indexed).toStrictEqual([...indexed].sort(compare));
    }
}

describe("the scaffolds of the repository", () => {
    it("are the census's scaffolds", () => {
        const dir = path.join(ENGINE, "resources", "config-samples");
        const folders = (parent: string) => fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
        const onDisk = folders(dir).flatMap(group => folders(path.join(dir, group)).flatMap(sample =>
            fs.readdirSync(path.join(dir, group, sample)).filter(file => file.endsWith(".scaffold")).map(file => path.posix.join("resources", "config-samples", group, sample, file))));
        expect(SCAFFOLDS.length).toBe(34);
        expect(onDisk.sort()).toStrictEqual(SCAFFOLDS);
    });

    it.each(SCAFFOLDS)("%s is read as the census counts it", scaffold => {
        const text = scaffoldText(scaffold);
        const outcome = decodeBlueprint(text);
        expect(outcome.kind).toBe("blueprint");
        const blueprint = read(text);
        expect(blueprint.entities.length).toBe(census[scaffold].entities);
        expect(blueprint.version).toStrictEqual(census[scaffold].version);
        expect(countsOf(blueprint.entities)).toStrictEqual(census[scaffold].prototypes);
        expectSorted(blueprint.entities);
        // no throw, and the same text gives the same outcome
        expect(decodeBlueprint(text)).toStrictEqual(outcome);
    });
});

/** One entity of the repository's scaffolds for each thing the read type holds: the first entity that has it */
const SPOTS: { predicate: string; scaffold: string; number: number; expected: BlueprintEntityRead }[] = [
    // resources/config-samples/intermediates/electronic-circuit/electronic-circuit-2-belt-chest.scaffold, entity 16
    {
        predicate: "bar",
        scaffold: "resources/config-samples/intermediates/electronic-circuit/electronic-circuit-2-belt-chest.scaffold",
        number: 16,
        expected: {
            bar: 4,
            direction: 0,
            entity_number: 16,
            filters: [],
            mirror: false,
            name: "steel-chest",
            position: { x: 6.5, y: -1.5 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 22
    {
        predicate: "control_behavior",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 22,
        expected: {
            control_behavior: {
                circuit_condition: { comparator: ">", constant: 0, first_signal: { name: "signal-anything", type: "virtual" } },
                circuit_enabled: true,
            },
            direction: 8,
            entity_number: 22,
            filters: [],
            mirror: true,
            name: "stack-inserter",
            position: { x: -323.5, y: -185.5 },
            quality: "legendary",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 1
    {
        predicate: "direction",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 1,
        expected: {
            direction: 4,
            entity_number: 1,
            filters: [],
            mirror: false,
            name: "turbo-transport-belt",
            position: { x: -332.5, y: -184.5 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 50
    {
        predicate: "filter",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 50,
        expected: {
            direction: 4,
            entity_number: 50,
            filter: { comparator: "=", item: "nutrients", quality: "normal" },
            filters: [],
            mirror: false,
            name: "turbo-splitter",
            output_priority: "right",
            position: { x: -311.5, y: -184 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/rocket-fuel/rocket-fuel-60.scaffold, entity 47
    {
        predicate: "filters",
        scaffold: "resources/config-samples/gleba/rocket-fuel/rocket-fuel-60.scaffold",
        number: 47,
        expected: {
            control_behavior: {
                circuit_condition: { comparator: ">", constant: 0, first_signal: { name: "signal-anything", type: "virtual" } },
                circuit_enabled: true,
            },
            direction: 0,
            entity_number: 47,
            filters: [{ comparator: "=", index: 1, item: "jellynut-seed", quality: "normal" }],
            mirror: true,
            name: "stack-inserter",
            position: { x: -142.5, y: -196.5 },
            quality: "legendary",
            requests: [],
            use_filters: true,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 3
    {
        predicate: "infinity",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 3,
        expected: {
            direction: 0,
            entity_number: 3,
            filters: [],
            infinity: {
                filters: [{ count: 100, index: 1, item: "bioflux", mode: "at-least", quality: "normal" }],
                remove_unfiltered_items: false,
            },
            mirror: false,
            name: "infinity-chest",
            position: { x: -332.5, y: -182.5 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/science/automation/automation-240.scaffold, entity 193
    {
        predicate: "input_priority",
        scaffold: "resources/config-samples/science/automation/automation-240.scaffold",
        number: 193,
        expected: {
            direction: 4,
            entity_number: 193,
            filters: [],
            input_priority: "right",
            mirror: false,
            name: "turbo-splitter",
            output_priority: "right",
            position: { x: -105.5, y: -439 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/smelting/steel-plate/steel-plate-26-wagon-chest.scaffold, entity 5
    {
        predicate: "inventory",
        scaffold: "resources/config-samples/smelting/steel-plate/steel-plate-26-wagon-chest.scaffold",
        number: 5,
        expected: {
            direction: 0,
            entity_number: 5,
            filters: [],
            inventory: {
                filters: [
                    { comparator: "=", index: 1, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 2, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 3, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 4, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 5, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 6, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 7, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 8, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 9, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 10, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 11, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 12, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 13, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 14, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 15, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 16, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 17, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 18, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 19, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 20, item: "iron-ore", quality: "normal" },
                    { comparator: "=", index: 21, item: "iron-plate", quality: "normal" },
                    { comparator: "=", index: 22, item: "iron-plate", quality: "normal" },
                    { comparator: "=", index: 23, item: "iron-plate", quality: "normal" },
                    { comparator: "=", index: 24, item: "iron-plate", quality: "normal" },
                    { comparator: "=", index: 25, item: "iron-plate", quality: "normal" },
                    { comparator: "=", index: 26, item: "steel-plate", quality: "normal" },
                    { comparator: "=", index: 27, item: "steel-plate", quality: "normal" },
                    { comparator: "=", index: 28, item: "steel-plate", quality: "normal" },
                    { comparator: "=", index: 29, item: "steel-plate", quality: "normal" },
                    { comparator: "=", index: 30, item: "steel-plate", quality: "normal" },
                    { comparator: "=", index: 31, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 32, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 33, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 34, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 35, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 36, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 37, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 38, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 39, item: "deconstruction-planner", quality: "normal" },
                    { comparator: "=", index: 40, item: "deconstruction-planner", quality: "normal" },
                ],
            },
            mirror: false,
            name: "cargo-wagon",
            orientation: 0.5,
            position: { x: -353, y: -622 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 2
    {
        predicate: "mirror",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 2,
        expected: {
            direction: 8,
            entity_number: 2,
            filters: [],
            mirror: true,
            name: "stack-inserter",
            position: { x: -332.5, y: -183.5 },
            quality: "epic",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/recycling/iron-ore/iron-ore-voider-400-exact-speed.scaffold, entity 4
    {
        predicate: "orientation",
        scaffold: "resources/config-samples/recycling/iron-ore/iron-ore-voider-400-exact-speed.scaffold",
        number: 4,
        expected: {
            direction: 0,
            entity_number: 4,
            filters: [],
            mirror: false,
            name: "car",
            orientation: 0.25,
            position: { x: -528.50390625, y: -82.39453125 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 50
    {
        predicate: "output_priority",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 50,
        expected: {
            direction: 4,
            entity_number: 50,
            filter: { comparator: "=", item: "nutrients", quality: "normal" },
            filters: [],
            mirror: false,
            name: "turbo-splitter",
            output_priority: "right",
            position: { x: -311.5, y: -184 },
            quality: "normal",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/intermediates/electronic-circuit/electronic-circuit-2-belt-chest.scaffold, entity 19
    {
        predicate: "override_stack_size",
        scaffold: "resources/config-samples/intermediates/electronic-circuit/electronic-circuit-2-belt-chest.scaffold",
        number: 19,
        expected: {
            direction: 12,
            entity_number: 19,
            filters: [{ comparator: "=", index: 1, item: "copper-cable", quality: "normal" }],
            mirror: false,
            name: "stack-inserter",
            override_stack_size: 6,
            position: { x: 4.5, y: -4.5 },
            quality: "legendary",
            requests: [],
            use_filters: true,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 2
    {
        predicate: "quality",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 2,
        expected: {
            direction: 8,
            entity_number: 2,
            filters: [],
            mirror: true,
            name: "stack-inserter",
            position: { x: -332.5, y: -183.5 },
            quality: "epic",
            requests: [],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 21
    {
        predicate: "recipe",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 21,
        expected: {
            direction: 0,
            entity_number: 21,
            filters: [],
            mirror: false,
            name: "biochamber",
            position: { x: -323.5, y: -187.5 },
            quality: "legendary",
            recipe: "iron-bacteria-cultivation",
            recipe_quality: "normal",
            requests: [
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 0 },
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 1 },
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 2 },
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 3 },
            ],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 21
    {
        predicate: "recipe_quality",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 21,
        expected: {
            direction: 0,
            entity_number: 21,
            filters: [],
            mirror: false,
            name: "biochamber",
            position: { x: -323.5, y: -187.5 },
            quality: "legendary",
            recipe: "iron-bacteria-cultivation",
            recipe_quality: "normal",
            requests: [
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 0 },
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 1 },
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 2 },
                { inventory: 4, item: "productivity-module-3", quality: "legendary", stack: 3 },
            ],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 10
    {
        predicate: "requests",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 10,
        expected: {
            direction: 0,
            entity_number: 10,
            filters: [],
            mirror: false,
            name: "beacon",
            position: { x: -328.5, y: -192.5 },
            quality: "legendary",
            requests: [
                { inventory: 1, item: "speed-module-3", quality: "legendary", stack: 0 },
                { inventory: 1, item: "speed-module-3", quality: "legendary", stack: 1 },
            ],
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold, entity 9
    {
        predicate: "type",
        scaffold: "resources/config-samples/gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold",
        number: 9,
        expected: {
            direction: 4,
            entity_number: 9,
            filters: [],
            mirror: false,
            name: "turbo-underground-belt",
            position: { x: -330.5, y: -184.5 },
            quality: "normal",
            requests: [],
            type: "input",
            use_filters: false,
        },
    },
    // resources/config-samples/gleba/rocket-fuel/rocket-fuel-60.scaffold, entity 47
    {
        predicate: "use_filters",
        scaffold: "resources/config-samples/gleba/rocket-fuel/rocket-fuel-60.scaffold",
        number: 47,
        expected: {
            control_behavior: {
                circuit_condition: { comparator: ">", constant: 0, first_signal: { name: "signal-anything", type: "virtual" } },
                circuit_enabled: true,
            },
            direction: 0,
            entity_number: 47,
            filters: [{ comparator: "=", index: 1, item: "jellynut-seed", quality: "normal" }],
            mirror: true,
            name: "stack-inserter",
            position: { x: -142.5, y: -196.5 },
            quality: "legendary",
            requests: [],
            use_filters: true,
        },
    },
];

describe("an entity of a scaffold", () => {
    it.each(SPOTS)("with $predicate is read whole", ({ scaffold, number, expected }) => {
        const entity = read(scaffoldText(scaffold)).entities.find(e => e.entity_number === number);
        expect(entity).toStrictEqual(expected);
    });

    it("with filter_mode keeps it, and the filters beside it", () => {
        const blueprint = {
            item: "blueprint", label: "filter mode", icons: [], wires: [], version: 562954250027018,
            entities: [{
                entity_number: 1, name: "stack-inserter", position: { x: 0.5, y: 0.5 }, use_filters: true, filter_mode: "blacklist",
                filters: [{ index: 2, name: "copper-plate", quality: "epic" }, { index: 1, name: "iron-plate" }],
            }],
        } as unknown as FactorioBlueprint;
        const entity = read(encodeBlueprintFileBrowser({ blueprint })).entities[0];
        expect(entity).toStrictEqual({
            entity_number: 1, name: "stack-inserter", position: { x: 0.5, y: 0.5 }, direction: 0, mirror: false, quality: "normal",
            requests: [],
            filters: [{ index: 1, item: "iron-plate", quality: "normal" }, { index: 2, item: "copper-plate", quality: "epic" }],
            use_filters: true, filter_mode: "blacklist",
        });
    });
});

/** A blueprint string for a JSON text, as the game writes them: a zero, then base64 of the deflated text */
const pack = (json: string): string => "0" + btoa(String.fromCharCode(...pako.deflate(new TextEncoder().encode(json))));

const VERSION_2_1_25_10 = 2 * 2 ** 48 + 1 * 2 ** 32 + 25 * 2 ** 16 + 10;
const VERSION_1_1 = 1 * 2 ** 48 + 1 * 2 ** 32;
const ENTITY = { entity_number: 1, name: "stack-inserter", position: { x: 0.5, y: -1.5 } };
const blueprintText = (blueprint: Record<string, unknown>) => pack(JSON.stringify({ blueprint }));
const withEntity = (extra: Record<string, unknown>) => blueprintText({ item: "blueprint", version: VERSION_2_1_25_10, entities: [{ ...ENTITY, ...extra }] });
const emptyBlueprint = (version: number): FactorioBlueprint => ({ item: "blueprint", label: "empty", entities: [], icons: [], wires: [], version });

describe("a string that is not a blueprint's one blueprint", () => {
    it("is a book when it holds a book", () => {
        const book = new BlueprintBookBuilder().setLabel("book").addBlueprint(emptyBlueprint(VERSION_2_1_25_10)).build();
        expect(decodeBlueprint(encodeBlueprintFileBrowser({ blueprint_book: book }))).toStrictEqual({ kind: "problem", problem: "book" });
        // a book is a book before its blueprint is read
        expect(problemOf(pack(JSON.stringify({ blueprint_book: { blueprints: [] }, blueprint: { entities: [] } })))).toBe("book");
    });

    it.each(["upgrade_planner", "deconstruction_planner"])("is a planner when it holds a %s", key => {
        expect(decodeBlueprint(pack(JSON.stringify({ [key]: { settings: {}, item: key } })))).toStrictEqual({ kind: "problem", problem: "planner" });
    });

    it("is a blueprint with no entities when its entity list is empty or missing", () => {
        const empty: FactorioBlueprintFile = { blueprint: emptyBlueprint(VERSION_2_1_25_10) };
        expect(decodeBlueprint(encodeBlueprintFileBrowser(empty))).toStrictEqual({ kind: "problem", problem: "no-entities" });
        expect(problemOf(blueprintText({ item: "blueprint", version: VERSION_2_1_25_10 }))).toBe("no-entities");
    });

    it("is of an older game when its version is 1.x, whatever else it holds", () => {
        const older: FactorioBlueprintFile = { blueprint: emptyBlueprint(VERSION_1_1) };
        expect(decodeBlueprint(encodeBlueprintFileBrowser(older))).toStrictEqual({ kind: "problem", problem: "game-version" });
        expect(problemOf(blueprintText({ version: VERSION_1_1, entities: [ENTITY] }))).toBe("game-version");
        // the version is read before the entities: an entity that would be refused does not matter
        expect(problemOf(blueprintText({ version: VERSION_1_1, entities: [{ entity_number: "x" }] }))).toBe("game-version");
    });

    it("is read when it is another 2.x version, or has none", () => {
        const another = 2 * 2 ** 48 + 0 * 2 ** 32 + 70 * 2 ** 16 + 1;
        expect(read(blueprintText({ version: another, entities: [ENTITY] })).version).toStrictEqual({ major: 2, minor: 0, patch: 70, build: 1 });
        expect(read(blueprintText({ entities: [ENTITY] })).version).toBeNull();
        expect(read(withEntity({})).version).toStrictEqual({ major: 2, minor: 1, patch: 25, build: 10 });
    });

    it("is not a blueprint when it is not a string of the game", () => {
        for (const text of ["", "  \n ", pack("{}").slice(1), "1" + pack("{}").slice(1)]) {
            expect(problemOf(text)).toBe("not-a-blueprint");
        }

        // the strings that start right and fail later fail at the step that is named: they do reach it
        const badBase64 = "0!!!! not base64";
        const badDeflate = "0" + btoa("text that is not deflated");
        for (const text of [badBase64, badDeflate]) {
            expect(text.startsWith("0")).toBe(true);
            expect(() => decodeBlueprintFileBrowser(text)).toThrow();
            expect(problemOf(text)).toBe("not-a-blueprint");
        }
        expect(problemOf("0" + btoa(String.fromCharCode(...pako.deflate(new TextEncoder().encode("{ not json"))))))
            .toBe("not-a-blueprint");
    });

    it.each([
        ["a string", '"text"'],
        ["a number", "42"],
        ["null", "null"],
        ["a boolean", "true"],
        ["an array", "[]"],
        ["an array of blueprints", '[{"blueprint":{"entities":[]}}]'],
        ["a record with no known key", '{"something":1}'],
        ["a blueprint that is null", '{"blueprint":null}'],
        ["a blueprint that is a list", '{"blueprint":[]}'],
        ["a blueprint that is text", '{"blueprint":"text"}'],
        ["a version that is text", '{"blueprint":{"version":"2.1","entities":[]}}'],
        ["a version that is null", '{"blueprint":{"version":null,"entities":[]}}'],
        ["a version that is not a whole number", '{"blueprint":{"version":2.5,"entities":[]}}'],
        ["a version below zero", '{"blueprint":{"version":-1,"entities":[]}}'],
        ["entities that are a record", '{"blueprint":{"entities":{}}}'],
        ["entities that are text", '{"blueprint":{"entities":"text"}}'],
        ["entities that are null", '{"blueprint":{"entities":null}}'],
        ["an entity that is a number", '{"blueprint":{"entities":[1]}}'],
        ["an entity that is null", '{"blueprint":{"entities":[null]}}'],
        ["an entity that is a list", '{"blueprint":{"entities":[[]]}}'],
        ["an entity with no number", '{"blueprint":{"entities":[{"name":"pipe","position":{"x":0,"y":0}}]}}'],
        ["an entity number that is text", '{"blueprint":{"entities":[{"entity_number":"1","name":"pipe","position":{"x":0,"y":0}}]}}'],
        ["an entity number that is not whole", '{"blueprint":{"entities":[{"entity_number":1.5,"name":"pipe","position":{"x":0,"y":0}}]}}'],
        ["an entity with no name", '{"blueprint":{"entities":[{"entity_number":1,"position":{"x":0,"y":0}}]}}'],
        ["an entity name that is a number", '{"blueprint":{"entities":[{"entity_number":1,"name":5,"position":{"x":0,"y":0}}]}}'],
        ["an entity with no position", '{"blueprint":{"entities":[{"entity_number":1,"name":"pipe"}]}}'],
        ["a position that is null", '{"blueprint":{"entities":[{"entity_number":1,"name":"pipe","position":null}]}}'],
        ["a position that is a list", '{"blueprint":{"entities":[{"entity_number":1,"name":"pipe","position":[0,0]}]}}'],
        ["a position with text", '{"blueprint":{"entities":[{"entity_number":1,"name":"pipe","position":{"x":"0","y":0}}]}}'],
        ["a position with one coordinate", '{"blueprint":{"entities":[{"entity_number":1,"name":"pipe","position":{"x":0}}]}}'],
        ["one good entity and one that is refused", '{"blueprint":{"entities":[{"entity_number":1,"name":"pipe","position":{"x":0,"y":0}},{"entity_number":2}]}}'],
    ])("is not a blueprint when it holds %s", (_what, json) => {
        expect(decodeBlueprint(pack(json))).toStrictEqual({ kind: "problem", problem: "not-a-blueprint" });
    });

    it.each<[string, Record<string, unknown>]>([
        ["a direction that is text", { direction: "4" }],
        ["a mirror that is a number", { mirror: 1 }],
        ["a quality that is a number", { quality: 1 }],
        ["a recipe that is a number", { recipe: 1 }],
        ["a recipe that is null", { recipe: null }],
        ["a recipe quality that is a boolean", { recipe_quality: true }],
        ["requests that are a record", { items: {} }],
        ["a request that is a number", { items: [1] }],
        ["a request with no item name", { items: [{ id: { quality: "legendary" } }] }],
        ["a request item that is a list", { items: [{ id: ["speed-module-3"] }] }],
        ["a request quality that is a number", { items: [{ id: { name: "speed-module-3", quality: 3 } }] }],
        ["request slots that are a record", { items: [{ id: { name: "speed-module-3" }, items: { in_inventory: {} } }] }],
        ["a request slot that is a number", { items: [{ id: { name: "speed-module-3" }, items: { in_inventory: [1] } }] }],
        ["a request slot with no stack", { items: [{ id: { name: "speed-module-3" }, items: { in_inventory: [{ inventory: 4 }] } }] }],
        ["a request inventory that is text", { items: [{ id: { name: "speed-module-3" }, items: { in_inventory: [{ inventory: "4", stack: 0 }] } }] }],
        ["a request count that is text", { items: [{ id: { name: "speed-module-3" }, items: { in_inventory: [{ inventory: 4, stack: 0, count: "2" }] } }] }],
        ["filters that are a record", { filters: {} }],
        ["a filter that is text", { filters: ["iron-plate"] }],
        ["a filter with no index", { filters: [{ name: "iron-plate" }] }],
        ["a filter comparator that is a number", { filters: [{ index: 1, name: "iron-plate", comparator: 1 }] }],
        ["a filter quality that is a number", { filters: [{ index: 1, name: "iron-plate", quality: 1 }] }],
        ["use_filters that is text", { use_filters: "true" }],
        ["a filter mode that is a boolean", { filter_mode: true }],
        ["an override stack size that is text", { override_stack_size: "3" }],
        ["a bar that is text", { bar: "4" }],
        ["infinity settings that are a list", { infinity_settings: [] }],
        ["infinity settings that are null", { infinity_settings: null }],
        ["infinity filters that are a record", { infinity_settings: { filters: {} } }],
        ["an infinity filter with no name", { infinity_settings: { filters: [{ index: 1 }] } }],
        ["an infinity filter index that is text", { infinity_settings: { filters: [{ index: "1", name: "iron-plate" }] } }],
        ["an infinity filter count that is text", { infinity_settings: { filters: [{ name: "iron-plate", count: "5" }] } }],
        ["an infinity filter mode that is a number", { infinity_settings: { filters: [{ name: "iron-plate", mode: 1 }] } }],
        ["a remove_unfiltered_items that is text", { infinity_settings: { remove_unfiltered_items: "yes" } }],
        ["an inventory that is a number", { inventory: 5 }],
        ["an inventory that is a list", { inventory: [] }],
        ["a trunk inventory that is text", { trunk_inventory: "full" }],
        ["inventory filters that are a record", { inventory: { filters: {} } }],
        ["an inventory bar that is text", { inventory: { bar: "4" } }],
        ["an orientation that is text", { orientation: "0.5" }],
        ["a type that is a number", { type: 1 }],
        ["an input priority that is a number", { input_priority: 1 }],
        ["an output priority that is a boolean", { output_priority: true }],
        ["a filter that is a string", { filter: "iron-plate" }],
        ["a splitter filter comparator that is a number", { filter: { name: "iron-plate", comparator: 1 } }],
        ["a control behavior that is a list", { control_behavior: [] }],
        ["a control behavior that is null", { control_behavior: null }],
    ])("is not a blueprint when an entity holds %s", (_what, extra) => {
        expect(decodeBlueprint(withEntity(extra))).toStrictEqual({ kind: "problem", problem: "not-a-blueprint" });
    });

    it("is read when it has spaces or a newline around it", () => {
        const text = withEntity({});
        const entities = read(text).entities;
        expect(entities.length).toBe(1);
        expect(read("  " + text + " \n").entities).toStrictEqual(entities);
        expect(read("\n" + text + "\n\n").entities).toStrictEqual(entities);
    });

    it("gives a problem and no throw for anything but text", () => {
        for (const value of [undefined, null, 5, {}, []]) {
            expect(decodeBlueprint(value as unknown as string)).toStrictEqual({ kind: "problem", problem: "not-a-blueprint" });
        }
    });
});

describe("an entity of a blueprint", () => {
    it("has the defaults the game leaves out, and no key it does not give", () => {
        expect(read(withEntity({})).entities).toStrictEqual([{
            entity_number: 1, name: "stack-inserter", position: { x: 0.5, y: -1.5 }, direction: 0, mirror: false, quality: "normal",
            requests: [], filters: [], use_filters: false,
        }]);
    });

    it("keeps the keys it does not read out of the entity, and ignores a key it does not know", () => {
        const entity = read(withEntity({ drop_position: "far", color: 7, tags: { any: 1 }, unknown_key: [], wires: 5 })).entities[0];
        expect(Object.keys(entity).sort()).toStrictEqual(["direction", "entity_number", "filters", "mirror", "name", "position", "quality", "requests", "use_filters"]);
    });

    it("has no inventory when the blueprint gives it as null, and keeps a trunk or wagon inventory", () => {
        expect(read(withEntity({ trunk_inventory: null, inventory: null })).entities[0].inventory).toBeUndefined();
        const wagon = read(withEntity({ inventory: { bar: 3, filters: [{ index: 2, name: "coal" }, { index: 1, name: "iron-ore", quality: "rare", comparator: "=" }] } })).entities[0];
        expect(wagon.inventory).toStrictEqual({
            bar: 3,
            filters: [{ index: 1, item: "iron-ore", quality: "rare", comparator: "=" }, { index: 2, item: "coal", quality: "normal" }],
        });
        const car = read(withEntity({ trunk_inventory: { filters: [] } })).entities[0];
        expect(car.inventory).toStrictEqual({ filters: [] });
    });

    it("keeps a filter row with no name, with its quality and comparator, on an inserter", () => {
        const entity = read(withEntity({ use_filters: true, filters: [{ index: 2, quality: "rare", comparator: ">" }, { index: 1, name: "coal" }] })).entities[0];
        expect(entity.filters).toStrictEqual([
            { index: 1, item: "coal", quality: "normal" },
            { index: 2, quality: "rare", comparator: ">" },
        ]);
    });

    it("keeps a filter row with no name, with its quality and comparator, in a wagon's inventory", () => {
        const wagon = read(withEntity({ name: "cargo-wagon", inventory: { filters: [{ index: 1, quality: "epic", comparator: "<" }] } })).entities[0];
        expect(wagon.inventory).toStrictEqual({ filters: [{ index: 1, quality: "epic", comparator: "<" }] });
    });

    it("keeps a splitter filter with no name, with its quality and comparator", () => {
        const splitter = read(withEntity({ name: "turbo-splitter", output_priority: "left", filter: { quality: "legendary", comparator: "=" } })).entities[0];
        expect(splitter.filter).toStrictEqual({ quality: "legendary", comparator: "=" });
    });

    it("has no infinity settings when they are the fluid shape of an infinity pipe, whatever they hold", () => {
        const pipe = read(withEntity({ name: "infinity-pipe", infinity_settings: { name: "water", percentage: "full", temperature: [], mode: 4 } })).entities[0];
        expect("infinity" in pipe).toBe(false);
    });

    it("has infinity filters with the rows that have an index first, by index, and the rest in the order given", () => {
        const chest = read(withEntity({
            name: "infinity-chest",
            infinity_settings: { filters: [{ name: "a" }, { index: 3, name: "c", count: 5, mode: "exactly" }, { name: "b", quality: "epic" }, { index: 1, name: "d", mode: "at-most" }] },
        })).entities[0];
        expect(chest.infinity).toStrictEqual({
            remove_unfiltered_items: false,
            filters: [
                { index: 1, item: "d", quality: "normal", mode: "at-most" },
                { index: 3, item: "c", quality: "normal", count: 5, mode: "exactly" },
                { item: "a", quality: "normal" },
                { item: "b", quality: "epic" },
            ],
        });
        expect(read(withEntity({ infinity_settings: { remove_unfiltered_items: true } })).entities[0].infinity)
            .toStrictEqual({ filters: [], remove_unfiltered_items: true });
    });

    it("has one request for each slot, sorted by inventory, stack and item, with the count as given", () => {
        const slot = (inventory: number, stack: number, count?: number) => ({ inventory, stack, ...(count === undefined ? {} : { count }) });
        const entity = read(withEntity({
            items: [
                { id: { name: "speed-module-3", quality: "legendary" }, items: { in_inventory: [slot(4, 2), slot(1, 0, 2)] } },
                { id: { name: "efficiency-module" }, items: { in_inventory: [slot(4, 2), slot(4, 0)] } },
                { id: { name: "coal" }, items: { grid_count: 1 } },
            ],
        })).entities[0];
        expect(entity.requests).toStrictEqual([
            { item: "speed-module-3", quality: "legendary", inventory: 1, stack: 0, count: 2 },
            { item: "efficiency-module", quality: "normal", inventory: 4, stack: 0 },
            { item: "efficiency-module", quality: "normal", inventory: 4, stack: 2 },
            { item: "speed-module-3", quality: "legendary", inventory: 4, stack: 2 },
        ]);
    });

    it("comes in the order of its entity number", () => {
        const at = (n: number) => ({ ...ENTITY, entity_number: n });
        const text = blueprintText({ version: VERSION_2_1_25_10, entities: [at(3), at(1), at(10), at(2)] });
        expect(read(text).entities.map(e => e.entity_number)).toStrictEqual([1, 2, 3, 10]);
    });

    it("keeps the control behavior as given, and the splitter filter with the priorities", () => {
        const behavior = { circuit_condition: { comparator: ">", constant: 0 }, nested: { list: [1, { deep: true }] } };
        const splitter = read(withEntity({
            name: "turbo-splitter", control_behavior: behavior, input_priority: "left", output_priority: "right",
            filter: { name: "iron-plate", quality: "uncommon", comparator: "≥" }, orientation: 0.25, type: "output",
        })).entities[0];
        expect(splitter.control_behavior).toStrictEqual(behavior);
        expect(splitter).toMatchObject({
            input_priority: "left", output_priority: "right", orientation: 0.25, type: "output",
            filter: { item: "iron-plate", quality: "uncommon", comparator: "≥" },
        });
    });
});

describe("the outcome of a text", () => {
    it("is deep-equal on two calls, for every kind of outcome", () => {
        const texts = [withEntity({}), "", "0", pack("[]"), pack('{"blueprint_book":{}}'), pack('{"upgrade_planner":{}}'), blueprintText({ entities: [] })];
        for (const text of texts) {
            const first: DecodeOutcome = decodeBlueprint(text);
            expect(decodeBlueprint(text)).toStrictEqual(first);
        }
    });

    it("is a fresh entity on each call, so that changing one does not change the next", () => {
        const text = withEntity({ control_behavior: { a: 1 } });
        const first = read(text);
        first.entities[0].control_behavior = { changed: true };
        expect(read(text).entities[0].control_behavior).toStrictEqual({ a: 1 });
    });
});
