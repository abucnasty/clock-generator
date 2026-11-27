import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BlueprintEntityRead } from "./blueprint-entities";
import { decodeBlueprint } from "./decode";
import { BuildFlows, FlowsData, FlowsInputs, flowsOf } from "./flows";
import { GeometryData, GeometryRow, geometryOf } from "./geometry";
import { BuildWorld, PrototypeRow, WorldData, worldOf } from "./world";

const ENGINE = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures", "flows");
const SAMPLES = path.join(ENGINE, "resources", "config-samples");
const read = (file: string) => fs.readFileSync(file, "utf8");

// ---------------------------------------------------------------- the data slice, taken from the game data of the repository

type Raw = Record<string, Record<string, any>>;
const RAW = JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as Raw;
const GEOMETRY_SLICE = JSON.parse(read(path.join(__dirname, "fixtures", "geometry", "data-slice.json"))) as { rows: Record<string, GeometryRow & PrototypeRow> };

type Row = GeometryRow & PrototypeRow;

/**
 * One row for each entity name of the data's `entity_footprint` (its type, tile size and collision box), with the
 * `inserter` vectors, the belt `speed` and the underground belt's `max_distance` of the data's own sections. A name the
 * footprints leave out (a pole, a pipe, a combinator) takes the row of the geometry test's slice of the same game
 * version; two names no sample holds take a row written for the case that uses them.
 */
function rowsOf(): Record<string, Row> {
    const rows: Record<string, Row> = {};
    for (const [name, footprint] of Object.entries(RAW.entity_footprint)) {
        const row: Row = { type: footprint.type, tile_width: footprint.tile_width, tile_height: footprint.tile_height };
        if (footprint.collision_box) row.collision_box = footprint.collision_box;
        const inserter = RAW.inserter[name];
        if (inserter) {
            row.pickup_position = inserter.pickup_position;
            row.insert_position = inserter.insert_position;
        }
        for (const section of ["transport_belt", "underground_belt", "splitter", "loader"]) {
            const belt = RAW[section][name];
            if (belt?.speed !== undefined) row.speed = belt.speed;
            if (belt?.max_distance !== undefined) row.max_distance = belt.max_distance;
        }
        rows[name] = row;
    }
    for (const [name, row] of Object.entries(GEOMETRY_SLICE.rows)) {
        if (!(name in rows)) rows[name] = { type: row.type, tile_width: row.tile_width, tile_height: row.tile_height };
    }
    // written for the cases of a drill into a boiler and a locomotive: the game's type names and tile sizes
    rows["boiler"] = { type: "boiler", tile_width: 3, tile_height: 2 };
    rows["locomotive"] = { type: "locomotive" };
    return rows;
}

const ROWS = rowsOf();
const WORLD_DATA: WorldData = ROWS;
const GEOMETRY_DATA: GeometryData = ROWS;

const DATA: FlowsData = {
    entity_types: Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [name, row.type])),
    mining_drills: Object.fromEntries(
        Object.entries(RAW["mining-drill"]).map(([name, row]) => [name, { resource_categories: row.resource_categories, vector_to_place_result: row.vector_to_place_result }]),
    ),
    resources: Object.fromEntries(Object.entries(RAW.resource).map(([name, row]) => [name, { ...(row.category ? { category: row.category } : {}), minable: row.minable }])),
    recipes: Object.fromEntries(Object.entries(RAW.recipe).map(([name, row]) => [name, { categories: row.categories, ingredients: row.ingredients, results: row.results }])),
    crafting_machines: Object.fromEntries(
        Object.entries(RAW.crafting_machine).map(([name, row]) => [
            name,
            { type: row.type, crafting_categories: row.crafting_categories, ...(row.vector_to_place_result ? { vector_to_place_result: row.vector_to_place_result } : {}) },
        ]),
    ),
    items: Object.keys(RAW.item),
};

// ---------------------------------------------------------------- building a world, a geometry and the flows

function decoded(file: string): BlueprintEntityRead[] {
    const outcome = decodeBlueprint(read(file).trim());
    if (outcome.kind !== "blueprint") throw new Error(`not a blueprint: ${file}`);
    return outcome.entities;
}

function flowsFor(entities: BlueprintEntityRead[], inputs: FlowsInputs = { answers: {} }): BuildFlows {
    const world = worldOf(entities, WORLD_DATA);
    return flowsOf(world, geometryOf(world, entities, GEOMETRY_DATA), entities, inputs, DATA);
}

/** The entities with every infinity chest's filters taken out, as a build cut out of a factory and fed from outside */
const withoutFeeds = (entities: BlueprintEntityRead[]): BlueprintEntityRead[] =>
    entities.map((e) => (e.infinity ? { ...e, infinity: { ...e.infinity, filters: [] } } : e));

// ---------------------------------------------------------------- the fixture

type FixtureRow = {
    build: string;
    variant: "as-built" | "ores" | "no-feeds";
    label: string;
    source: string;
    items: string[];
    kind: "lane" | "chest" | "furnace";
    line?: number;
    lane?: 1 | 2;
    read_at?: "pickup-pieces" | "whole-line";
    pieces?: number[];
    waits_on_drill?: boolean;
    entity?: number;
    recipe?: string | null;
    via?: string;
    registered_difference?: string;
};
type FixtureDrill = {
    build: string;
    entity: number;
    prototype: string;
    target: number;
    target_prototype: string;
    step1_candidates: string[];
    ore: string | null;
};
type Fixture = {
    builds: Record<string, { scaffold: string; setpoint_item: string; ores: Record<string, string> }>;
    ores_source: string;
    drills: FixtureDrill[];
    rows: FixtureRow[];
};
const FIXTURE = JSON.parse(read(path.join(FIXTURES, "flows-rows.json"))) as Fixture;
const BUILD_NAMES = [...new Set(FIXTURE.rows.map((r) => r.build))];
const SCAFFOLD_ENTITIES = new Map(Object.entries(FIXTURE.builds).map(([name, build]) => [name, decoded(path.join(SAMPLES, build.scaffold))]));
const rowsOf2 = (variant: FixtureRow["variant"], build?: string) => FIXTURE.rows.filter((r) => r.variant === variant && (build === undefined || r.build === build));

/** What the port gives for one fixture row: the items of a lane or chest, or the recipe of a furnace */
function portValue(flows: BuildFlows, row: FixtureRow): string[] | string | null {
    if (row.kind === "lane") {
        const lane = flows.lanes.find((l) => l.line === row.line && l.lane === row.lane);
        if (!lane) throw new Error(`no lane ${row.build} ${row.label}`);
        return lane.items;
    }
    if (row.kind === "chest") return flows.chests.find((c) => c.entity_number === row.entity)?.items ?? [];
    return flows.machines.find((m) => m.entity_number === row.entity)?.recipe ?? null;
}

function expectedValue(row: FixtureRow): string[] | string | null {
    return row.kind === "furnace" ? row.recipe ?? null : row.items;
}

const answersOfOres = (build: string): Record<string, string> =>
    Object.fromEntries(Object.entries(FIXTURE.builds[build].ores).map(([drill, ore]) => [`drill-ore:${drill}`, ore]));

function flowsOfBuild(build: string, answers: Record<string, string> = {}, entities = SCAFFOLD_ENTITIES.get(build)!): BuildFlows {
    return flowsFor(entities, { answers, setpoint: { item: FIXTURE.builds[build].setpoint_item } });
}

const questionKeys = (flows: BuildFlows) => flows.questions.map((q) => q.key);

describe("the fixture", () => {
    it("holds 43 rows a variant, on 7 builds, and 7 drills", () => {
        for (const variant of ["as-built", "ores", "no-feeds"] as const) expect(rowsOf2(variant)).toHaveLength(43);
        expect(BUILD_NAMES).toHaveLength(7);
        expect(FIXTURE.drills).toHaveLength(7);
    });
});

// ---------------------------------------------------------------- as built

describe("the rows as built, with each build's setpoint item", () => {
    it("gives the expected items, recipe or chest items of all 43 rows", () => {
        const differ: string[] = [];
        for (const build of BUILD_NAMES) {
            const flows = flowsOfBuild(build);
            for (const row of rowsOf2("as-built", build)) {
                if (JSON.stringify(portValue(flows, row)) !== JSON.stringify(expectedValue(row))) differ.push(`${build} ${row.label}: ${JSON.stringify(portValue(flows, row))} against ${JSON.stringify(expectedValue(row))}`);
            }
        }
        expect(differ).toEqual([]);
    });

    it("asks exactly three questions: the ore of the iron build's drill and the two lanes of logistic 240's belt 2", () => {
        const asked = BUILD_NAMES.flatMap((build) => flowsOfBuild(build).questions.map((q) => ({ build, key: q.key, candidates: q.candidates })));
        expect(asked).toEqual([
            { build: "iron", key: "drill-ore:1", candidates: ["calcite", "coal", "copper-ore", "iron-ore", "scrap", "stone", "tungsten-ore", "uranium-ore"] },
            { build: "logistic-240", key: "lane-item:3:1", candidates: ["inserter", "transport-belt"] },
            { build: "logistic-240", key: "lane-item:3:2", candidates: ["inserter", "transport-belt"] },
        ]);
    });

    it("keeps iron's 4 rows waiting on the drill's question, with no lane question", () => {
        const flows = flowsOfBuild("iron");
        expect(questionKeys(flows)).toEqual(["drill-ore:1"]);
        const lanes = flows.lanes.filter((l) => l.line === 9);
        expect(lanes.map((l) => [l.lane, l.waiting, l.items])).toEqual([
            [1, true, []],
            [2, true, []],
        ]);
        expect(flows.machines.filter((m) => m.recipe !== null)).toEqual([]);
    });

    it("gives each row the source of its value", () => {
        const differ: string[] = [];
        for (const build of BUILD_NAMES) {
            const flows = flowsOfBuild(build);
            for (const row of rowsOf2("as-built", build)) {
                if (row.kind === "lane") {
                    const lane = flows.lanes.find((l) => l.line === row.line && l.lane === row.lane)!;
                    if (lane.source !== row.source) differ.push(`${build} ${row.label}: ${lane.source} against ${row.source}`);
                    if (lane.waiting !== row.waits_on_drill) differ.push(`${build} ${row.label}: waiting ${lane.waiting}`);
                    if (lane.read_at !== row.read_at) differ.push(`${build} ${row.label}: read at ${lane.read_at}`);
                } else if (row.kind === "furnace") {
                    const how = flows.machines.find((m) => m.entity_number === row.entity)!;
                    const expected = row.source === "drill-ore" ? "ore" : row.source === "input" ? "input" : null;
                    if (how.how !== expected || how.via !== row.via) differ.push(`${build} ${row.label}: ${how.how} ${how.via}`);
                }
            }
        }
        expect(differ).toEqual([]);
    });
});

describe("iron answered", () => {
    it("gives iron's 4 rows the rows with the ore typed, once drill-ore:1 is iron-ore", () => {
        const flows = flowsOfBuild("iron", { "drill-ore:1": "iron-ore" });
        expect(flows.questions).toEqual([]);
        for (const row of rowsOf2("ores", "iron")) expect(portValue(flows, row)).toEqual(expectedValue(row));
        expect(flows.drills.map((d) => d.ore)).toEqual([{ item: "iron-ore", steps: ["answered"] }]);
    });

    it("gives all 43 rows the rows with the ore typed, every drill's ore given as an answer", () => {
        const differ: string[] = [];
        for (const build of BUILD_NAMES) {
            const flows = flowsOfBuild(build, answersOfOres(build));
            for (const row of rowsOf2("ores", build)) {
                if (JSON.stringify(portValue(flows, row)) !== JSON.stringify(expectedValue(row))) differ.push(`${build} ${row.label}`);
            }
        }
        expect(differ).toEqual([]);
    });
});

// ---------------------------------------------------------------- no feeds

describe("the rows with the infinity chests giving nothing", () => {
    it("gives the expected items, recipe or chest items of all 43 rows", () => {
        const differ: string[] = [];
        for (const build of BUILD_NAMES) {
            const flows = flowsOfBuild(build, {}, withoutFeeds(SCAFFOLD_ENTITIES.get(build)!));
            for (const row of rowsOf2("no-feeds", build)) {
                if (JSON.stringify(portValue(flows, row)) !== JSON.stringify(expectedValue(row))) differ.push(`${build} ${row.label}: ${JSON.stringify(portValue(flows, row))} against ${JSON.stringify(expectedValue(row))}`);
            }
        }
        expect(differ).toEqual([]);
    });

    it("asks the ore of iron's drill, a lane question for each of the 6 rows with more than one candidate, and logistic 240's belt 2 from the takers", () => {
        const asked = BUILD_NAMES.flatMap((build) => flowsOfBuild(build, {}, withoutFeeds(SCAFFOLD_ENTITIES.get(build)!)).questions.map((q) => ({ build, key: q.key, candidates: q.candidates })));
        const more = ["accumulator", "supercapacitor"];
        const four = ["battery", "electronic-circuit", "holmium-plate", "superconductor"];
        expect(asked).toEqual([
            { build: "iron", key: "drill-ore:1", candidates: ["calcite", "coal", "copper-ore", "iron-ore", "scrap", "stone", "tungsten-ore", "uranium-ore"] },
            { build: "logistic-240", key: "lane-item:3:1", candidates: ["inserter", "transport-belt"] },
            { build: "logistic-240", key: "lane-item:3:2", candidates: ["inserter", "transport-belt"] },
            { build: "electromagnetic-240", key: "lane-item:3:1", candidates: more },
            { build: "electromagnetic-240", key: "lane-item:3:2", candidates: more },
            { build: "electromagnetic-240", key: "lane-item:10:1", candidates: four },
            { build: "electromagnetic-240", key: "lane-item:10:2", candidates: four },
            { build: "electromagnetic-240", key: "lane-item:20:1", candidates: four },
            { build: "electromagnetic-240", key: "lane-item:20:2", candidates: four },
        ]);
    });

    it("registers the one differing row: electromagnetic 240's belt 2 lane 2, where the sample config holds no item", () => {
        const registered = FIXTURE.rows.filter((r) => r.registered_difference);
        expect(registered.map((r) => [r.build, r.variant, r.label])).toEqual([["electromagnetic-240", "no-feeds", "belt 2 lane 2"]]);
        const flows = flowsOfBuild("electromagnetic-240", {}, withoutFeeds(SCAFFOLD_ENTITIES.get("electromagnetic-240")!));
        expect(flows.lanes.find((l) => l.line === 19 && l.lane === 2)?.items).toEqual(["processing-unit"]);
    });
});

// ---------------------------------------------------------------- drills

describe("the 7 drills of the samples", () => {
    it("gives each its target and its ore as the rule gives it", () => {
        for (const drill of FIXTURE.drills) {
            const flows = flowsOfBuild(drill.build);
            const found = flows.drills.find((d) => d.entity_number === drill.entity);
            expect(found, `${drill.build} drill ${drill.entity}`).toBeDefined();
            expect(found!.name).toBe(drill.prototype);
            expect(found!.target.entity_number).toBe(drill.target);
            expect(found!.candidates).toEqual(drill.step1_candidates);
            expect(found!.ore?.item ?? null, `${drill.build} drill ${drill.entity}`).toBe(drill.ore);
            expect(flows.left_out_drills).toEqual([]);
        }
        expect(FIXTURE.drills.map((d) => [d.build, d.entity, d.target, d.target_prototype])).toEqual([
            ["iron", 1, 2, "car"],
            ["steel", 1, 5, "cargo-wagon"],
            ["stone-brick-120", 3, 6, "electric-furnace"],
            ["grenade-240", 31, 46, "assembling-machine-3"],
            ["grenade-240", 32, 47, "assembling-machine-3"],
            ["grenade-240", 75, 62, "assembling-machine-3"],
            ["grenade-240", 76, 64, "assembling-machine-3"],
        ]);
    });

    it("settles steel's drill by the filters as one source, the wagon's slot filters and an inserter's whitelist", () => {
        const flows = flowsOfBuild("steel");
        expect(flows.drills[0].ore).toEqual({ item: "iron-ore", steps: ["filters"] });
    });

    it("settles stone-brick-120's drill only by the setpoint, and asks when no setpoint is given", () => {
        const entities = SCAFFOLD_ENTITIES.get("stone-brick-120")!;
        expect(flowsOfBuild("stone-brick-120").drills[0].ore).toEqual({ item: "stone", steps: ["setpoint"] });
        const none = flowsFor(entities);
        expect(none.drills[0].ore).toBeNull();
        expect(questionKeys(none)).toEqual(["drill-ore:3"]);
        expect(none.questions[0].candidates).toEqual(["calcite", "coal", "copper-ore", "iron-ore", "scrap", "stone", "uranium-ore"]);
    });

    it("settles grenade-240's four drills by the recipe grenade, the mirrored drill 32 included", () => {
        const entities = SCAFFOLD_ENTITIES.get("grenade-240")!;
        expect(entities.find((e) => e.entity_number === 32)?.mirror).toBe(true);
        const flows = flowsOfBuild("grenade-240");
        expect(flows.drills.map((d) => [d.entity_number, d.ore])).toEqual([31, 32, 75, 76].map((n) => [n, { item: "coal", steps: ["set-recipe"] }]));
    });
});

// ---------------------------------------------------------------- recyclers

describe("the recyclers", () => {
    const scaffold = (stem: string) => decoded(path.join(SAMPLES, stem));

    it("gives electromagnetic 240's mirrored recyclers 68 and 154 their plants 88 and 174, and the voiders' recyclers the car", () => {
        const em = flowsFor(scaffold("science/electromagnetic/electromagnetic-240-recycler-belt-fed.scaffold"), { answers: {} });
        expect(em.recyclers.map((r) => [r.entity_number, r.mirrored, r.target])).toEqual([
            [68, true, { kind: "machine", entity_number: 88 }],
            [154, true, { kind: "machine", entity_number: 174 }],
        ]);
        const exact = flowsFor(scaffold("recycling/iron-ore/iron-ore-voider-400-exact-speed.scaffold"), { answers: {} });
        expect(exact.recyclers.map((r) => [r.entity_number, r.mirrored, r.target])).toEqual([[9, false, { kind: "chest", entity_number: 4 }]]);
        const over = flowsFor(scaffold("recycling/iron-ore/iron-ore-voider-400-overbeaconed.scaffold"), { answers: {} });
        expect(over.recyclers.map((r) => [r.entity_number, r.mirrored, r.target])).toEqual([[10, false, { kind: "chest", entity_number: 4 }]]);
    });

    it("lists mirrored-recycler for 68 and 154 and not for a plain recycler", () => {
        const em = flowsFor(scaffold("science/electromagnetic/electromagnetic-240-recycler-belt-fed.scaffold"), { answers: {} });
        expect(em.unread.filter((u) => u.code === "mirrored-recycler")).toEqual([
            { code: "mirrored-recycler", entity_number: 68 },
            { code: "mirrored-recycler", entity_number: 154 },
        ]);
        const exact = flowsFor(scaffold("recycling/iron-ore/iron-ore-voider-400-exact-speed.scaffold"), { answers: {} });
        expect(exact.unread.filter((u) => u.code === "mirrored-recycler")).toEqual([]);
    });
});

// ---------------------------------------------------------------- the rule's cases, with inline entities

const ent = (n: number, name: string, x: number, y: number, extra: Partial<BlueprintEntityRead> = {}): BlueprintEntityRead => ({
    entity_number: n,
    name,
    position: { x, y },
    direction: 0,
    mirror: false,
    quality: "normal",
    requests: [],
    filters: [],
    use_filters: false,
    ...extra,
});

/** An electric drill (entity 1) facing north whose drop falls on tile (1, 4) */
const drill = (name = "electric-mining-drill", extra: Partial<BlueprintEntityRead> = {}) =>
    name === "big-mining-drill" ? ent(1, name, 2.5, 7.5, extra) : name === "pumpjack" ? ent(1, name, 1.5, 6.5, extra) : ent(1, name, 1.5, 6.5, extra);
/** A 3 by 3 machine with its tile (1, 4) under the drill's drop */
const machine = (n: number, recipe?: string, name = "assembling-machine-3", extra: Partial<BlueprintEntityRead> = {}) => ent(n, name, 1.5, 3.5, { ...(recipe ? { recipe } : {}), ...extra });
const STEP1_ELECTRIC = ["calcite", "coal", "copper-ore", "iron-ore", "scrap", "stone", "uranium-ore"];
const filter = (item: string, index = 1) => ({ index, item, quality: "normal" });

/** The flows of the drill (entity 1) over these entities, and its one question where it has one */
function oreOf(entities: BlueprintEntityRead[], setpoint?: string, answers: Record<string, string> = {}) {
    const flows = flowsFor(entities, { answers, ...(setpoint ? { setpoint: { item: setpoint } } : {}) });
    const question = flows.questions.find((q) => q.key === "drill-ore:1");
    return { flows, ore: flows.drills.find((d) => d.entity_number === 1)?.ore?.item ?? null, candidates: question?.candidates ?? null, left: flows.left_out_drills };
}

const drillQuestions = (flows: BuildFlows) => flows.questions.filter((q) => q.type === "drill-ore");

describe("the rule's cases, each named by its title (7, a mixed patch, and 11, a car's fuel slot, hold nothing a blueprint shows)", () => {
    describe("a recipe with two mineable ingredients (cases 1 to 4): the user is asked, with the two candidates", () => {
        it.each([
            ["iron-ore-melting", ["calcite", "iron-ore"]],
            ["copper-ore-melting", ["calcite", "copper-ore"]],
            ["advanced-thruster-oxidizer", ["calcite", "iron-ore"]],
            ["simple-coal-liquefaction", ["calcite", "coal"]],
        ])("recipe %s", (recipe, candidates) => {
            const out = oreOf([drill(), machine(2, recipe)]);
            expect(out.ore).toBeNull();
            expect(out.candidates).toEqual(candidates);
        });
    });

    it("a drill onto a belt that leaves the blueprint, with no taker (5): left out with its reason, no question", () => {
        const out = oreOf([drill(), ent(2, "turbo-transport-belt", 1.5, 4.5)]);
        expect(out.left).toEqual([{ entity_number: 1, name: "electric-mining-drill", reason: "onto-belt" }]);
        expect(drillQuestions(out.flows)).toEqual([]);
    });

    it("a drill onto a belt inside the blueprint (6): left out with its reason, no question, though a taker stands on the belt", () => {
        const out = oreOf([drill(), ent(2, "turbo-transport-belt", 1.5, 4.5), ent(3, "stack-inserter", 2.5, 4.5, { direction: 12 }), ent(4, "steel-chest", 3.5, 4.5)]);
        expect(out.left).toEqual([{ entity_number: 1, name: "electric-mining-drill", reason: "onto-belt" }]);
        expect(drillQuestions(out.flows)).toEqual([]);
    });

    it("scrap into a recycler: product stone (8): asks with scrap and stone", () => {
        const out = oreOf([drill(), ent(2, "recycler", 2, 3)], "stone");
        expect(out.ore).toBeNull();
        expect(out.candidates).toEqual(["scrap", "stone"]);
    });

    it("a drill into a burner's fuel slot: stone furnace, steel furnace (9): the setpoint settles the ore, never coal", () => {
        for (const furnace of ["stone-furnace", "steel-furnace"]) {
            for (const [setpoint, ore] of [["iron-plate", "iron-ore"], ["copper-plate", "copper-ore"], ["stone-brick", "stone"]]) {
                const out = oreOf([drill(), ent(2, furnace, 2, 4)], setpoint);
                expect(out.ore, `${furnace} ${setpoint}`).toBe(ore);
                expect(out.ore).not.toBe("coal");
            }
        }
    });

    it("a drill into a burner's fuel slot: boiler, locomotive, burner drill (10): none of them is a drill target", () => {
        for (const target of [ent(2, "boiler", 1.5, 4), ent(2, "locomotive", 1.5, 4.5), ent(2, "burner-mining-drill", 1.5, 3.5, { direction: 8 })]) {
            const out = oreOf([drill(), target]);
            expect(out.left.filter((l) => l.entity_number === 1).map((l) => l.reason), target.name).toEqual(["no-target"]);
            expect(drillQuestions(out.flows)).toEqual([]);
        }
    });

    it("a chain of two machines with no recipe: the setpoint is two hops away (12): none, and a question with step 1's candidates", () => {
        const chain = [drill(), machine(2, undefined, "electric-furnace"), ent(3, "stack-inserter", 1.5, 1.5, { direction: 8 }), ent(4, "electric-furnace", 1.5, -0.5)];
        const out = oreOf(chain, "steel-plate");
        expect(out.ore).toBeNull();
        expect(out.candidates).toEqual(STEP1_ELECTRIC);
    });

    describe("a chest target (car, cargo wagon, infinity chest) (13)", () => {
        it("a cargo wagon with a slot filter and an inserter from it whitelisting the same item gives iron-ore", () => {
            const wagon = ent(2, "cargo-wagon", 1.5, 2.5, { orientation: 0, inventory: { filters: [filter("iron-ore")] } });
            const taker = ent(3, "stack-inserter", 3.5, 3.5, { direction: 12, use_filters: true, filters: [filter("iron-ore")] });
            expect(oreOf([drill(), wagon, taker, ent(4, "steel-chest", 4.5, 3.5)], "iron-plate").ore).toBe("iron-ore");
        });
        it("a car with no filter and the setpoint iron-plate gives none and asks", () => {
            const out = oreOf([drill(), ent(2, "car", 1.5, 3.5, { orientation: 0 })], "iron-plate");
            expect(out.ore).toBeNull();
            expect(out.candidates).toEqual(STEP1_ELECTRIC);
        });
    });

    it("a setpoint item that another chain makes (14): iron-ore, the wrong ore for a drill on copper (a wrong-ore case)", () => {
        expect(oreOf([drill(), machine(2, undefined, "electric-furnace")], "iron-plate").ore).toBe("iron-ore");
    });

    it("a setpoint given as a recipe name (15): none, and a question, because the item is taken as written", () => {
        const out = oreOf([drill(), ent(2, "recycler", 2, 3)], "scrap-recycling");
        expect(out.ore).toBeNull();
        expect(out.candidates).toEqual(STEP1_ELECTRIC);
    });

    it('counts is not an import input (16, counts: "destroyed"): a recycler with the setpoint iron-ore gives iron-ore by step 3', () => {
        const out = oreOf([drill(), ent(2, "recycler", 2, 3)], "iron-ore");
        expect(out.ore).toBe("iron-ore");
        expect(out.flows.drills[0].ore?.steps).toEqual(["setpoint"]);
    });

    it("uranium-ore, which needs sulfuric acid (17): the one ore, though the acid is not seen", () => {
        expect(oreOf([drill(), machine(2, "uranium-processing")]).ore).toBe("uranium-ore");
    });

    it("a candidate only the big drill mines (18): tungsten-ore for the big drill, a question for the electric drill", () => {
        expect(oreOf([drill("big-mining-drill"), ent(2, "assembling-machine-3", 2.5, 3.5, { recipe: "tungsten-plate" })]).ore).toBe("tungsten-ore");
        const electric = oreOf([drill(), machine(2, "tungsten-plate")]);
        expect(electric.ore).toBeNull();
        expect(electric.candidates).toEqual(STEP1_ELECTRIC);
    });

    it("a pumpjack, or any drill whose categories hold only fluid resources (19): left out, no question", () => {
        const out = oreOf([drill("pumpjack"), machine(2, "grenade")]);
        expect(out.left.map((l) => [l.name, l.reason])).toEqual([["pumpjack", "no-ore-item"]]);
        expect(out.flows.questions).toEqual([]);
    });

    it("a target machine with no recipe that is not a furnace or recycler (20): none, and a question with step 1's candidates", () => {
        const out = oreOf([drill(), machine(2)]);
        expect(out.ore).toBeNull();
        expect(out.candidates).toEqual(STEP1_ELECTRIC);
    });

    it("a set recipe with no mineable ingredient (21): none, and a question with step 1's candidates", () => {
        const out = oreOf([drill(), machine(2, "electronic-circuit")]);
        expect(out.ore).toBeNull();
        expect(out.candidates).toEqual(STEP1_ELECTRIC);
    });

    it("a set recipe with one mineable ingredient, the rule's good case (22): coal", () => {
        const out = oreOf([drill(), machine(2, "grenade")]);
        expect(out.ore).toBe("coal");
        expect(out.flows.drills[0].ore?.steps).toEqual(["set-recipe"]);
    });

    it("a drill that drops onto no entity (23): left out, no question", () => {
        const out = oreOf([drill()]);
        expect(out.left.map((l) => l.reason)).toEqual(["no-target"]);
        expect(out.flows.questions).toEqual([]);
    });
});

describe("answers and filters", () => {
    it("ignores an answer for a key that is not asked", () => {
        const entities = [drill(), machine(2, "electronic-circuit")];
        const plain = flowsFor(entities);
        const answered = flowsFor(entities, { answers: { "drill-ore:99": "coal", "lane-item:5:1": "stone", "other": "x" } });
        expect(answered).toEqual(plain);
        const settled = flowsFor([drill(), machine(2, "grenade")], { answers: { "drill-ore:1": "iron-ore" } });
        expect(settled.drills[0].ore).toEqual({ item: "coal", steps: ["set-recipe"] });
    });

    it("takes an answer for the key that is asked, and keeps every other key", () => {
        const two = [drill(), machine(2, "electronic-circuit"), ent(11, "big-mining-drill", 12.5, 7.5), ent(12, "assembling-machine-3", 12.5, 3.5, { recipe: "electronic-circuit" })];
        const both = flowsFor(two);
        expect(questionKeys(both)).toEqual(["drill-ore:1", "drill-ore:11"]);
        const one = flowsFor(two, { answers: { "drill-ore:1": "copper-ore" } });
        expect(questionKeys(one)).toEqual(["drill-ore:11"]);
        expect(one.drills.find((d) => d.entity_number === 1)?.ore).toEqual({ item: "copper-ore", steps: ["answered"] });
    });

    it("feeds the takers after an answered lane", () => {
        // a belt of two pieces with an inserter that takes from it into a chest: nothing puts an item on it
        const belt = [ent(10, "turbo-transport-belt", 20.5, 5.5, { direction: 8 }), ent(11, "turbo-transport-belt", 20.5, 6.5, { direction: 8 })];
        const taker = ent(12, "stack-inserter", 21.5, 5.5, { direction: 12 });
        const chest = ent(13, "steel-chest", 22.5, 5.5);
        const plain = flowsFor([...belt, taker, chest]);
        expect(plain.questions.map((q) => [q.key, q.candidates])).toEqual([["lane-item:10:1", []], ["lane-item:10:2", []]]);
        const answered = flowsFor([...belt, taker, chest], { answers: { "lane-item:10:1": "iron-plate" } });
        expect(answered.questions).toEqual([]);
        expect(answered.lanes.map((l) => [l.line, l.lane, l.items, l.source])).toEqual([
            [10, 1, ["iron-plate"], "answered"],
            [10, 2, [], "other-lane"],
        ]);
        expect(answered.chests).toEqual([{ entity_number: 13, items: ["iron-plate"] }]);
    });

    describe("a drill into a chest with an inserter taking from it", () => {
        const base = (taker: Partial<BlueprintEntityRead>) => [drill(), ent(2, "steel-chest", 1.5, 4.5), ent(3, "stack-inserter", 2.5, 4.5, { direction: 12, ...taker }), ent(4, "steel-chest", 4.5, 4.5)];
        it("counts a whitelist", () => {
            expect(oreOf(base({ use_filters: true, filters: [filter("iron-ore")] })).ore).toBe("iron-ore");
        });
        it.each<[string, Partial<BlueprintEntityRead>]>([
            ["use_filters false", { use_filters: false, filters: [filter("iron-ore")] }],
            ["a blacklist", { use_filters: true, filter_mode: "blacklist", filters: [filter("iron-ore")] }],
        ])("counts %s as no filter", (_, taker) => {
            const out = oreOf(base(taker));
            expect(out.ore).toBeNull();
            expect(out.candidates).toEqual(STEP1_ELECTRIC);
        });
    });

    it("counts a machine whose circuit sets its recipe, and an inserter whose circuit sets its filters, as having neither, and lists them (unmeasured: no sample holds one)", () => {
        const recipe = oreOf([drill(), machine(2, "grenade", "assembling-machine-3", { control_behavior: { set_recipe: true } })]);
        expect(recipe.ore).toBeNull();
        expect(recipe.flows.circuit_set).toEqual([{ entity_number: 2, sets: "recipe" }]);
        const taker = ent(3, "stack-inserter", 2.5, 4.5, { direction: 12, use_filters: true, filters: [filter("iron-ore")], control_behavior: { circuit_set_filters: true } });
        const filters = oreOf([drill(), ent(2, "steel-chest", 1.5, 4.5), taker, ent(4, "steel-chest", 4.5, 4.5)]);
        expect(filters.ore).toBeNull();
        expect(filters.flows.circuit_set).toEqual([{ entity_number: 3, sets: "filters" }]);
    });
});

describe("lanes, reach and sources, on small builds", () => {
    /** A machine making `recipe` at (23.5, y) with an inserter at (21.5, y) that drops onto the belt column at x 20.5 */
    const dropper = (n: number, y: number, recipe: string) => [ent(n, "assembling-machine-3", 23.5, y, { recipe }), ent(n + 1, "stack-inserter", 21.5, y, { direction: 4 })];
    const column = (first: number, ys: number[]) => ys.map((y, i) => ent(first + i, "turbo-transport-belt", 20.5, y, { direction: 8 }));

    it("puts nothing on a lane for a hand of two items", () => {
        const flows = flowsFor([...dropper(20, 10.5, "uranium-processing"), ...column(10, [10.5])]);
        expect(flows.lanes.map((l) => l.items)).toEqual([[], []]);
        expect(flows.pieces).toEqual([]);
    });

    it("reads a lane at the pieces inserters take from, not over the whole line", () => {
        // the first dropper's item passes the taker, the second dropper's item enters below it
        const entities = [
            ...column(10, [10.5, 11.5, 12.5, 13.5]),
            ...dropper(20, 10.5, "grenade"),
            ...dropper(30, 13.5, "iron-gear-wheel"),
            ent(40, "stack-inserter", 19.5, 11.5, { direction: 4 }),
            ent(41, "steel-chest", 18.5, 11.5),
        ];
        const flows = flowsFor(entities);
        const read = flows.lanes.filter((l) => l.items.length > 0);
        expect(read.map((l) => [l.items, l.read_at])).toEqual([[["grenade"], "pickup-pieces"]]);
        expect(flows.pieces.filter((p) => p.piece === 13).map((p) => p.items)).toEqual([["grenade", "iron-gear-wheel"]]);
    });

    it("keeps a drill's ore to the item that every source gives: a whitelist of two and the setpoint give one", () => {
        const chest = [drill(), ent(2, "steel-chest", 1.5, 4.5), ent(3, "stack-inserter", 2.5, 4.5, { direction: 12, use_filters: true, filters: [filter("iron-ore"), filter("coal", 2)] }), ent(4, "steel-chest", 4.5, 4.5)];
        expect(oreOf(chest, "iron-ore").ore).toBe("iron-ore");
        const two = oreOf(chest);
        expect(two.ore).toBeNull();
        expect(two.candidates).toEqual(["coal", "iron-ore"]);
    });

    it("counts a wagon's slot filters with no use_filters", () => {
        const wagon = ent(2, "cargo-wagon", 1.5, 2.5, { orientation: 0, inventory: { filters: [filter("iron-ore")] } });
        expect(oreOf([drill(), wagon]).ore).toBe("iron-ore");
    });

    it("drops into a car whose box reaches 12/256 of a tile into the drop tile and not into one that reaches 11/256", () => {
        // the car's lower edge is at y + 1: tile 4 starts at y 4
        const car = (y: number) => [drill(), ent(2, "car", 1.5, y, { orientation: 0 })];
        expect(oreOf(car(780 / 256)).flows.drills.map((d) => d.target)).toEqual([{ kind: "chest", entity_number: 2 }]);
        expect(oreOf(car(779 / 256)).left.map((l) => l.reason)).toEqual(["no-target"]);
    });
});

// ---------------------------------------------------------------- what no game read holds

describe("the lanes that rest on a value with no game read", () => {
    /** A machine making grenades whose inserter drops onto the tile (6, 5) from the east; the belt there is built by the case */
    const dropper = (mirror: boolean) => [ent(20, "assembling-machine-3", 9.5, 5.5, { recipe: "grenade" }), ent(21, "stack-inserter", 7.5, 5.5, { direction: 4, mirror })];

    it("gives drop-lane-outside-pin for a mirrored drop onto a curve", () => {
        // belt 10 runs east into belt 11, which faces north with nothing behind it: a curve
        const entities = [...dropper(true), ent(10, "turbo-transport-belt", 5.5, 5.5, { direction: 4 }), ent(11, "turbo-transport-belt", 6.5, 5.5, { direction: 0 }), ent(12, "turbo-transport-belt", 6.5, 4.5, { direction: 0 })];
        const flows = flowsFor(entities);
        expect(flows.unread.filter((u) => u.code === "drop-lane-outside-pin")).toEqual([{ code: "drop-lane-outside-pin", entity_number: 10, lane: 1 }]);
    });

    it("gives infinity-loader on both lanes that a loader out of an infinity chest feeds (no game read; the world's graph is stubbed, since it gives an output loader no belt to feed)", () => {
        const entities = [
            ent(1, "infinity-chest", 5.5, 3.5, { infinity: { filters: [{ item: "iron-plate", quality: "normal" }], remove_unfiltered_items: false } }),
            ent(2, "turbo-loader", 5.5, 5, { direction: 0, type: "output" }),
            ent(3, "turbo-transport-belt", 7.5, 5.5, { direction: 4 }),
            ent(4, "stack-inserter", 7.5, 4.5, { direction: 8 }),
            ent(5, "steel-chest", 7.5, 3.5),
        ];
        const world = worldOf(entities, WORLD_DATA);
        expect(world.piece(2)?.loader?.chest).toBe(1);
        const geometry = geometryOf(world, entities, GEOMETRY_DATA);
        const feeding: BuildWorld = { ...world, lineAfter: (piece) => (piece.entity_number === 2 ? [world.piece(3)!] : world.lineAfter(piece)) };
        const flows = flowsOf(feeding, geometry, entities, { answers: {} }, DATA);
        expect(flows.lanes.map((l) => [l.line, l.lane, l.items, l.source])).toEqual([[3, 1, ["iron-plate"], "drops"], [3, 2, ["iron-plate"], "drops"]]);
        expect(flows.unread).toEqual([{ code: "infinity-loader", entity_number: 3, lane: 1 }, { code: "infinity-loader", entity_number: 3, lane: 2 }]);
        expect(flows.chests).toEqual([{ entity_number: 5, items: ["iron-plate"] }]);
        // with no filters in the chest nothing is fed and nothing is marked
        const bare = entities.map((e) => (e.infinity ? { ...e, infinity: { ...e.infinity, filters: [] } } : e));
        const none = flowsOf(feeding, geometryOf(worldOf(bare, WORLD_DATA), bare, GEOMETRY_DATA), bare, { answers: {} }, DATA);
        expect(none.unread).toEqual([]);
    });

    it("gives no mark for an unmirrored in-line drop onto an entrance from behind", () => {
        const entities = [
            ent(20, "assembling-machine-3", 6.5, 8.5, { recipe: "grenade" }),
            ent(21, "stack-inserter", 6.5, 6.5, { direction: 8 }),
            ent(10, "turbo-underground-belt", 6.5, 5.5, { direction: 0, type: "input" }),
            ent(11, "turbo-underground-belt", 6.5, 1.5, { direction: 0, type: "output" }),
        ];
        const flows = flowsFor(entities);
        expect(flows.lanes.some((l) => l.items.includes("grenade"))).toBe(true);
        expect(flows.unread).toEqual([]);
    });
});

// ---------------------------------------------------------------- the samples' unread lanes, from the world and the drop bases

describe("the lanes of the samples that rest on a value with no game read", () => {
    type Pin = { inserter: number; piece: number; line: number; lane: number };
    /** The drops whose lane mark is not null and whose line basis the geometry gives as unread, read from the world and the geometry alone */
    function pinDrops(build: string): Pin[] {
        const entities = SCAFFOLD_ENTITIES.get(build)!;
        const world = worldOf(entities, WORLD_DATA);
        const geometry = geometryOf(world, entities, GEOMETRY_DATA);
        const lineOf = new Map(geometry.lines.flatMap((l) => l.pieces.map((p) => [p, l.first] as const)));
        return geometry.drops.flatMap((d) => {
            const end = geometry.ends.find((e) => e.inserter === d.inserter)!;
            const piece = world.piece(d.piece);
            const landing = piece ? world.laneOfDrop(end.drop, piece, world.entity(d.inserter)!.mirror) : null;
            return landing && landing.mark !== null && d.line.basis === "unread" ? [{ inserter: d.inserter, piece: d.piece, line: lineOf.get(d.piece)!, lane: landing.line }] : [];
        });
    }

    /** The output loaders of a build, and those whose chest is an infinity chest with filters */
    function loaders(build: string): { output: number; fed: number } {
        const entities = SCAFFOLD_ENTITIES.get(build)!;
        const world = worldOf(entities, WORLD_DATA);
        const output = world.pieces.filter((p) => p.kind === "loader" && p.end === "output");
        const fed = output.filter((p) => p.loader?.chest != null && world.entity(p.loader.chest)?.prototype === "infinity-container" && (entities.find((e) => e.entity_number === p.loader!.chest)?.infinity?.filters.length ?? 0) > 0);
        return { output: output.length, fed: fed.length };
    }

    // by build: the lines that a pin drop falls on (line, drop lane, inserters), and the lanes the flows mark as built
    const PIN_DROPS: Record<string, [number, number, number[]][]> = {
        iron: [[9, 1, [14]], [9, 2, [17]]],
        lithium: [[15, 1, [20, 37]], [15, 2, [17, 36]]],
        "logistic-240": [[3, 1, [9, 19]]],
    };
    const MARKED: Record<string, [number, number][]> = {
        lithium: [[15, 1], [15, 2]],
        "logistic-240": [[3, 1], [3, 2]],
    };

    it("lists, as built, the pin drops of each build and marks the lanes that rest on them", () => {
        const rows: string[] = ["build\tkind\tline\tlane\tdetail"];
        for (const build of BUILD_NAMES) {
            const pins = pinDrops(build);
            const grouped = new Map<string, number[]>();
            for (const p of pins) grouped.set(`${p.line},${p.lane}`, [...(grouped.get(`${p.line},${p.lane}`) ?? []), p.inserter]);
            const found = [...grouped.entries()].map(([k, v]) => [...k.split(",").map(Number), v] as [number, number, number[]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            expect(found, `${build} pin drops`).toEqual(PIN_DROPS[build] ?? []);
            const flows = flowsOfBuild(build);
            const unread = flows.unread.filter((u) => u.code !== "mirrored-recycler");
            expect(unread.map((u) => [u.code, u.entity_number, u.lane]), `${build} unread`).toEqual((MARKED[build] ?? []).map(([line, lane]) => ["drop-lane-outside-pin", line, lane]));
            for (const [line, lane, inserters] of found) rows.push(`${build}\tpin drop\t${line}\t${lane}\t${inserters.join(" ")}`);
            for (const u of unread) rows.push(`${build}\t${u.code}\t${u.entity_number}\t${u.lane}\tas built, no answer`);
            const answered = flowsOfBuild(build, answersOfOres(build)).unread.filter((u) => u.code !== "mirrored-recycler");
            for (const u of answered) rows.push(`${build}\t${u.code}\t${u.entity_number}\t${u.lane}\twith every drill's ore answered`);
        }
        if (process.env.FLOWS_WITNESS_DIRECTORY) fs.writeFileSync(path.join(process.env.FLOWS_WITNESS_DIRECTORY, "unread.tsv"), rows.join("\n") + "\n");
    });

    it("carries the mark to logistic 240's lane 2 over a side load: both pin drops land on lane 1", () => {
        const entities = SCAFFOLD_ENTITIES.get("logistic-240")!;
        const world = worldOf(entities, WORLD_DATA);
        const geometry = geometryOf(world, entities, GEOMETRY_DATA);
        const line = geometry.lines.find((l) => l.first === 3)!;
        const crossing = line.pieces.flatMap((n) => world.piece(n)!.side_loads.filter((s) => line.pieces.includes(s.receiver) && s.lane !== s.passing[0]).map((s) => [n, s.receiver, s.lane, s.passing] as const));
        expect(crossing.length).toBeGreaterThan(0);
        expect(flowsOfBuild("logistic-240").unread.map((u) => [u.entity_number, u.lane])).toEqual([[3, 1], [3, 2]]);
    });

    it("finds no output loader out of an infinity chest with filters on any of the 7 builds, so no lane is marked infinity-loader", () => {
        expect(Object.fromEntries(BUILD_NAMES.map((b) => [b, loaders(b)]))).toEqual(Object.fromEntries(BUILD_NAMES.map((b) => [b, { output: 0, fed: 0 }])));
        for (const build of BUILD_NAMES) expect(flowsOfBuild(build).unread.filter((u) => u.code === "infinity-loader")).toEqual([]);
    });
});

describe("the rows' lines against the geometry's", () => {
    it("reads each lane row at the pieces of one physical line: its first piece, its pickup pieces or the whole line", () => {
        const differ: string[] = [];
        for (const build of BUILD_NAMES) {
            const entities = SCAFFOLD_ENTITIES.get(build)!;
            const world = worldOf(entities, WORLD_DATA);
            const geometry = geometryOf(world, entities, GEOMETRY_DATA);
            for (const row of FIXTURE.rows.filter((r) => r.build === build && r.kind === "lane")) {
                const line = geometry.lines.filter((l) => l.pieces.includes(row.pieces![0]));
                if (line.length !== 1 || line[0].first !== row.line) {
                    differ.push(`${build} ${row.label}: line ${line.map((l) => l.first)}`);
                    continue;
                }
                const wanted = row.read_at === "pickup-pieces" ? line[0].pickups.map((p) => p.piece) : line[0].pieces;
                if (JSON.stringify([...wanted].sort((a, b) => a - b)) !== JSON.stringify(row.pieces)) differ.push(`${build} ${row.label}: pieces`);
                const inside = row.pieces!.every((p) => line[0].pieces.includes(p));
                if (!inside) differ.push(`${build} ${row.label}: a piece outside the line`);
            }
        }
        expect(differ).toEqual([]);
    });
});

describe("no throw", () => {
    it("takes the data's empty recipe, whose lists are empty objects, as a recipe of no item", () => {
        const empty = { categories: ["crafting"], ingredients: {}, results: {} } as unknown as FlowsData["recipes"][string];
        const world = worldOf([drill(), machine(2, "recipe-unknown")], WORLD_DATA);
        const entities = [drill(), machine(2, "recipe-unknown")];
        const flows = flowsOf(world, geometryOf(world, entities, GEOMETRY_DATA), entities, { answers: {} }, { ...DATA, recipes: { ...DATA.recipes, "recipe-unknown": empty } });
        expect(flows.questions.map((q) => q.key)).toEqual(["drill-ore:1"]);
    });

    it("gives a build with no data of the game a listed case, never a throw", () => {
        const none: FlowsData = { entity_types: {}, mining_drills: {}, resources: {}, recipes: {}, crafting_machines: {}, items: [] };
        const entities = SCAFFOLD_ENTITIES.get("steel")!;
        const world = worldOf(entities, {});
        const flows = flowsOf(world, geometryOf(world, entities, {}), entities, { answers: { "drill-ore:1": "iron-ore" } }, none);
        expect(flows.lanes).toEqual([]);
        expect(flows.questions).toEqual([]);
    });
});

// ---------------------------------------------------------------- keys, order, purity

describe("keys, order and purity", () => {
    it("gives the same flows for the same input, and sorts every list by its key", () => {
        const entities = SCAFFOLD_ENTITIES.get("electromagnetic-240")!;
        const a = flowsFor(entities, { answers: {}, setpoint: { item: FIXTURE.builds["electromagnetic-240"].setpoint_item } });
        const b = flowsFor(entities, { answers: {}, setpoint: { item: FIXTURE.builds["electromagnetic-240"].setpoint_item } });
        expect(b).toEqual(a);
        const sorted = <T,>(list: T[], key: (item: T) => number[]) => {
            const keys = list.map(key);
            return keys.every((k, i) => i === 0 || k.some((v, j) => v > keys[i - 1][j] && keys[i - 1].slice(0, j).every((w, m) => w === k[m])) || JSON.stringify(k) === JSON.stringify(keys[i - 1]));
        };
        expect(sorted(a.lanes, (l) => [l.line, l.lane])).toBe(true);
        expect(sorted(a.pieces, (p) => [p.piece, p.lane])).toBe(true);
        expect(sorted(a.machines, (m) => [m.entity_number])).toBe(true);
        expect(sorted(a.chests, (c) => [c.entity_number])).toBe(true);
        expect(sorted(a.unread, (u) => [u.entity_number, u.lane ?? 0])).toBe(true);
        for (const list of [a.lanes.map((l) => l.items), a.questions.map((q) => q.candidates)]) {
            for (const items of list) expect(items).toEqual([...items].sort());
        }
    });

    it("keys the questions by the drill's entity number and by the line's first piece and lane", () => {
        const flows = flowsOfBuild("logistic-240");
        expect(flows.questions.map((q) => [q.type, q.key, q.subject])).toEqual([
            ["lane-item", "lane-item:3:1", { entity_number: 3, lane: 1 }],
            ["lane-item", "lane-item:3:2", { entity_number: 3, lane: 2 }],
        ]);
        expect(flowsOfBuild("iron").questions.map((q) => [q.type, q.key, q.subject])).toEqual([["drill-ore", "drill-ore:1", { entity_number: 1 }]]);
    });

    it("keeps every other key when one answer is given", () => {
        const all = flowsOfBuild("logistic-240");
        const one = flowsOfBuild("logistic-240", { "lane-item:3:1": "transport-belt" });
        expect(questionKeys(all)).toEqual(["lane-item:3:1", "lane-item:3:2"]);
        expect(questionKeys(one)).toEqual(["lane-item:3:2"]);
    });
});
