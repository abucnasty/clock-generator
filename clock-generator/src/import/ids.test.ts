import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BlueprintEntityRead } from "./blueprint-entities";
import { decodeBlueprint } from "./decode";
import { BuildFlows, FlowsData, FlowsInputs, LaneFlow, PieceLane, flowsOf } from "./flows";
import { Frame, FrameRead, candidateFrames, entityUnderRead } from "./frames";
import { GeometryData, GeometryRow, BeltLine, BuildGeometry, EndEntity, InserterEnds, geometryOf } from "./geometry";
import { BuildIds, IdsData, IdsMachineData, idsOf, numbersMachine } from "./ids";
import { BuildWorld, PrototypeRow, WorldData, WorldEntity, worldOf } from "./world";

const ENGINE = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures", "ids");
const SAMPLES = path.join(ENGINE, "resources", "config-samples");
const read = (file: string) => fs.readFileSync(file, "utf8");

// ---------------------------------------------------------------- the crafting machines of the game data

type MachineFixture = { source: string; machines: Record<string, IdsMachineData> };
const MACHINES = JSON.parse(read(path.join(FIXTURES, "crafting-machines.json"))) as MachineFixture;
const IDS_DATA: IdsData = { crafting_machines: MACHINES.machines };

/** The 14 of the 16 crafting machines that the export numbers: all but the crusher and the captive biter spawner */
const NUMBERED_MACHINES = [
    "assembling-machine-1", "assembling-machine-2", "assembling-machine-3", "biochamber", "centrifuge", "chemical-plant", "cryogenic-plant",
    "electric-furnace", "electromagnetic-plant", "foundry", "oil-refinery", "recycler", "steel-furnace", "stone-furnace",
];

describe("the data gate", () => {
    it("numbers 14 of the 16 crafting machines and leaves out the crusher and the captive biter spawner", () => {
        const names = Object.keys(MACHINES.machines);
        expect(names).toHaveLength(16);
        const gated = names.filter((name) => numbersMachine(MACHINES.machines[name]));
        expect(gated).toEqual(NUMBERED_MACHINES);
        expect(names.filter((name) => !gated.includes(name))).toEqual(["captive-biter-spawner", "crusher"]);
    });

    it("keeps only the fields of the slice, and the subgroup of the repository's data is the cut's", () => {
        const raw = JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as { crafting_machine: Record<string, IdsMachineData> };
        for (const [name, row] of Object.entries(MACHINES.machines)) {
            expect(Object.keys(row).sort()).toEqual(["burner_fuel_categories", "subgroup", "type"]);
            expect({ name, subgroup: raw.crafting_machine[name].subgroup, type: raw.crafting_machine[name].type, burner: raw.crafting_machine[name].burner_fuel_categories }).toEqual({
                name,
                subgroup: row.subgroup,
                type: row.type,
                burner: row.burner_fuel_categories,
            });
        }
    });

    it("numbers an agriculture machine only where it burns nutrients, and a lab never", () => {
        expect(numbersMachine({ type: "assembling-machine", subgroup: "agriculture", burner_fuel_categories: ["nutrients"] })).toBe(true);
        expect(numbersMachine({ type: "assembling-machine", subgroup: "agriculture", burner_fuel_categories: ["food"] })).toBe(false);
        expect(numbersMachine({ type: "lab", subgroup: "production-machine", burner_fuel_categories: [] })).toBe(false);
        expect(numbersMachine({ type: "furnace", subgroup: "space-platform", burner_fuel_categories: [] })).toBe(false);
    });
});

// ---------------------------------------------------------------- inputs built in the test, with no blueprint

const UNIT_ROWS: Record<string, PrototypeRow> = {
    "assembling-machine-2": { type: "assembling-machine", tile_width: 3, tile_height: 3 },
    "electric-furnace": { type: "furnace", tile_width: 3, tile_height: 3 },
    recycler: { type: "furnace", tile_width: 2, tile_height: 4 },
    lab: { type: "lab", tile_width: 3, tile_height: 3 },
    "captive-biter-spawner": { type: "assembling-machine", tile_width: 3, tile_height: 3 },
    crusher: { type: "assembling-machine", tile_width: 3, tile_height: 3 },
    biochamber: { type: "assembling-machine", tile_width: 3, tile_height: 3 },
    "steel-chest": { type: "container", tile_width: 1, tile_height: 1 },
    "logistic-chest": { type: "logistic-container", tile_width: 1, tile_height: 1 },
    "linked-chest": { type: "linked-container", tile_width: 1, tile_height: 1 },
    "infinity-chest": { type: "infinity-container", tile_width: 1, tile_height: 1 },
    car: { type: "car" },
    tank: { type: "car" },
    "cargo-wagon": { type: "cargo-wagon" },
    "rocket-silo": { type: "rocket-silo", tile_width: 9, tile_height: 9 },
    "turbo-transport-belt": { type: "transport-belt", tile_width: 1, tile_height: 1 },
    "turbo-underground-belt": { type: "underground-belt", tile_width: 1, tile_height: 1, max_distance: 10 },
    "turbo-splitter": { type: "splitter", tile_width: 2, tile_height: 1 },
    "turbo-loader": { type: "loader", tile_width: 1, tile_height: 2 },
    "big-mining-drill": { type: "mining-drill", tile_width: 5, tile_height: 5 },
    beacon: { type: "beacon", tile_width: 3, tile_height: 3 },
    "stack-inserter": { type: "inserter", tile_width: 1, tile_height: 1 },
};

const spot = (n: number, name: string, x: number, y: number, extra: Partial<WorldEntity> = {}): WorldEntity => ({ entity_number: n, name, position: { x, y }, ...extra });

function reads(list: { n: number; name: string; recipe?: string }[]): BlueprintEntityRead[] {
    return list.map(({ n, name, recipe }) => ({ entity_number: n, name, position: { x: 0, y: 0 }, direction: 0, mirror: false, quality: "normal", requests: [], filters: [], use_filters: false, ...(recipe ? { recipe } : {}) }));
}

const targetOf = (world: BuildWorld, n: number): EndEntity | null => {
    const e = world.entity(n);
    if (!e || e.kind === "none") return null;
    return { entity_number: n, name: e.name, target: e.kind, vehicle: e.prototype === "car" || e.prototype === "cargo-wagon" };
};

/** An inserter whose ends are the entities with the given numbers (null: nothing there) */
const ends = (world: BuildWorld, inserter: number, source: number | null, sink: number | null): InserterEnds => ({
    inserter,
    pickup: { x: 0, y: 0 },
    drop: { x: 0, y: 0 },
    source: source === null ? null : targetOf(world, source),
    sink: sink === null ? null : targetOf(world, sink),
    source_candidates: source === null ? [] : [source],
    sink_candidates: sink === null ? [] : [sink],
    basis: "game",
});

const line = (first: number, pieces: number[]): BeltLine => ({
    first,
    pieces,
    belt_type: { value: "turbo-transport-belt", basis: "game" },
    pickups: [],
    flow_direction: null,
    sharing: [
        { value: "shared", basis: "default" },
        { value: "shared", basis: "default" },
    ],
});

const geometryWith = (endList: InserterEnds[], lines: BeltLine[] = []): BuildGeometry => ({
    ends: endList,
    pickups: [],
    drops: [],
    lines,
    copy_offset: { value: null, basis: "default" },
    vehicles: [],
    problems: [],
});

type FlowsPart = Partial<BuildFlows>;
const flowsWith = (part: FlowsPart = {}): BuildFlows => ({
    lanes: [],
    pieces: [],
    machines: [],
    chests: [],
    drills: [],
    left_out_drills: [],
    recyclers: [],
    circuit_set: [],
    unread: [],
    questions: [],
    ...part,
});

const laneOf = (lineFirst: number, lane: 1 | 2, items: string[], source: LaneFlow["source"] = "drops", waiting = false): LaneFlow => ({ line: lineFirst, lane, items, source, waiting, read_at: "whole-line" });
const onPiece = (piece: number, lane: 1 | 2, items: string[]): PieceLane => ({ piece, lane, items });
const question = (lineFirst: number, lane: 1 | 2, candidates: string[]): BuildFlows["questions"][number] => ({
    type: "lane-item",
    key: `lane-item:${lineFirst}:${lane}`,
    subject: { entity_number: lineFirst, lane },
    candidates,
});

const withWorld = (list: WorldEntity[]) => worldOf(list, UNIT_ROWS);

describe("machines", () => {
    // 10 assembling machine with a recipe, 4 furnace with a recipe (from the flows), 12 lab, 13 spawner, 14 crusher, 15 biochamber, 16 assembling machine with no recipe, 17 furnace with no recipe, 18 assembling machine whose recipe a circuit sets
    const list = [
        spot(10, "assembling-machine-2", 1.5, 1.5),
        spot(4, "electric-furnace", 5.5, 1.5),
        spot(12, "lab", 9.5, 1.5),
        spot(13, "captive-biter-spawner", 13.5, 1.5),
        spot(14, "crusher", 17.5, 1.5),
        spot(15, "biochamber", 21.5, 1.5),
        spot(16, "assembling-machine-2", 25.5, 1.5),
        spot(17, "electric-furnace", 29.5, 1.5),
        spot(18, "assembling-machine-2", 33.5, 1.5),
    ];
    const world = withWorld(list);
    const entities = reads([
        { n: 10, name: "assembling-machine-2", recipe: "iron-gear-wheel" },
        { n: 12, name: "lab" },
        { n: 13, name: "captive-biter-spawner", recipe: "biter-egg" },
        { n: 14, name: "crusher", recipe: "ice-melting" },
        { n: 15, name: "biochamber", recipe: "nutrients-from-spoilage" },
        { n: 16, name: "assembling-machine-2" },
        { n: 18, name: "assembling-machine-2", recipe: "copper-cable" },
    ]);
    const flows = flowsWith({
        machines: [
            { entity_number: 4, recipe: "iron-plate", how: "input" },
            { entity_number: 17, recipe: null, how: null },
        ],
        circuit_set: [{ entity_number: 18, sets: "recipe" }],
    });
    const ids = idsOf(world, entities, geometryWith([]), flows, IDS_DATA);

    it("numbers an assembling machine with a recipe and a furnace with a recipe from the flows, by entity number", () => {
        expect(ids.machines.map((m) => [m.id, m.entity_number])).toEqual([
            [1, 4],
            [2, 10],
            [3, 15],
        ]);
    });

    it("numbers none for a machine with no recipe, a recipe a circuit sets, a furnace with no recipe, a lab, a spawner and a crusher", () => {
        const numbered = ids.machines.map((m) => m.entity_number);
        for (const n of [16, 18, 17, 12, 13, 14]) expect(numbered).not.toContain(n);
        expect(ids.problems).toEqual([]);
    });

    it("numbers a biochamber with a recipe", () => {
        expect(ids.machines.find((m) => m.entity_number === 15)?.name).toBe("biochamber");
    });

    it("lists a machine whose name the data has no row for, and numbers it not", () => {
        const w = withWorld([spot(1, "assembling-machine-2", 1.5, 1.5)]);
        const result = idsOf(w, reads([{ n: 1, name: "assembling-machine-2", recipe: "iron-gear-wheel" }]), geometryWith([]), flowsWith(), { crafting_machines: {} });
        expect(result.machines).toEqual([]);
        expect(result.problems).toEqual([{ code: "no-machine-data", entity_number: 1, name: "assembling-machine-2" }]);
    });
});

describe("result targets", () => {
    // 1 recycler, 2 recycler, 3 recycler, 4 furnace with a recipe, 5 chest with an item, 6 lab
    const world = withWorld([
        spot(1, "recycler", 1, 2),
        spot(2, "recycler", 4, 2),
        spot(3, "recycler", 7, 2),
        spot(4, "electric-furnace", 12.5, 2.5),
        spot(5, "steel-chest", 16.5, 2.5),
        spot(6, "lab", 20.5, 2.5),
    ]);
    const flows = flowsWith({
        machines: [
            { entity_number: 1, recipe: "iron-plate-recycling", how: "input" },
            { entity_number: 2, recipe: "iron-plate-recycling", how: "input" },
            { entity_number: 3, recipe: "iron-plate-recycling", how: "input" },
            { entity_number: 4, recipe: "iron-plate", how: "input" },
        ],
        chests: [{ entity_number: 5, items: ["iron-plate"] }],
        recyclers: [
            { entity_number: 1, mirrored: false, target: { kind: "machine", entity_number: 4 }, reason: null },
            { entity_number: 2, mirrored: false, target: { kind: "chest", entity_number: 5 }, reason: null },
            { entity_number: 3, mirrored: false, target: { kind: "machine", entity_number: 6 }, reason: null },
        ],
    });
    const ids = idsOf(world, [], geometryWith([]), flows, IDS_DATA);

    it("gives a recycler that puts onto a numbered machine a machine target, onto a chest a chest target, and onto a machine with no id none", () => {
        expect(ids.machines.map((m) => [m.entity_number, m.result_target])).toEqual([
            [1, { type: "machine", id: 4 }],
            [2, { type: "chest", id: 1 }],
            [3, null],
            [4, null],
        ]);
    });
});

describe("belts", () => {
    // belts 1 to 3, 11 to 13 and 31 to 33 stand in a row each; 20 and 22 are splitters, 21 and 23 loaders, 24 a belt
    const rowOf = (first: number, y: number) => [1, 2, 3].map((i) => spot(first + i - 1, "turbo-transport-belt", i + 0.5, y + 0.5, { direction: 4 }));
    const world = withWorld([...rowOf(1, 0), ...rowOf(11, 2), ...rowOf(31, 4), spot(20, "turbo-splitter", 8, 10.5, { direction: 4 }), spot(21, "turbo-loader", 12.5, 10, { direction: 4 }), spot(22, "turbo-splitter", 8, 14.5, { direction: 4 }), spot(23, "turbo-loader", 12.5, 14, { direction: 4 }), spot(24, "turbo-transport-belt", 4.5, 14.5, { direction: 4 })]);
    const lines = [line(1, [1, 2, 3]), line(11, [11, 12, 13]), line(31, [31, 32, 33])];
    const idsFor = (flows: BuildFlows, lineList = lines) => idsOf(world, [], geometryWith([], lineList), flows, IDS_DATA);
    const both = (first: number, pieces: number[], l1: string, l2: string): [LaneFlow[], PieceLane[]] => [
        [laneOf(first, 1, [l1]), laneOf(first, 2, [l2])],
        pieces.flatMap((p) => [onPiece(p, 1, [l1]), onPiece(p, 2, [l2])]),
    ];

    it("gives two lines with the same items on the same lanes two ids, in the order of their first pieces", () => {
        const [la, pa] = both(1, [1, 2, 3], "iron-plate", "copper-plate");
        const [lb, pb] = both(11, [11, 12, 13], "iron-plate", "copper-plate");
        const result = idsFor(flowsWith({ lanes: [...lb, ...la], pieces: [...pb, ...pa] }));
        expect(result.belts.map((b) => [b.id, b.first_line, b.lines, b.signature])).toEqual([
            [1, 1, [1], "copper-plate|iron-plate#iron-plate|copper-plate"],
            [2, 11, [11], "copper-plate|iron-plate#iron-plate|copper-plate"],
        ]);
        expect(result.lines.map((l) => [l.line, l.belt])).toEqual([
            [1, 1],
            [11, 2],
            [31, null],
        ]);
    });

    it("gives the same items on opposite lanes two ids", () => {
        const [la, pa] = both(1, [1, 2, 3], "iron-plate", "copper-plate");
        const [lb, pb] = both(11, [11, 12, 13], "copper-plate", "iron-plate");
        const result = idsFor(flowsWith({ lanes: [...la, ...lb], pieces: [...pa, ...pb] }));
        expect(result.belts.map((b) => [b.id, b.first_line, b.signature])).toEqual([
            [1, 1, "copper-plate|iron-plate#iron-plate|copper-plate"],
            [2, 11, "copper-plate|iron-plate#copper-plate|iron-plate"],
        ]);
    });

    it("gives one lane per item and no lane lines where both lanes' items stand at splitter or loader pieces only, and keeps them in the set", () => {
        const l = [line(22, [22, 23, 24])];
        const flows = flowsWith({
            lanes: [laneOf(22, 1, ["iron-plate"]), laneOf(22, 2, ["copper-plate"])],
            pieces: [onPiece(22, 1, ["iron-plate"]), onPiece(23, 2, ["copper-plate"])],
        });
        const result = idsFor(flows, l);
        expect(result.belts[0]).toMatchObject({ items: ["copper-plate", "iron-plate"], lanes: [{ ingredient: "copper-plate" }, { ingredient: "iron-plate" }], lane_lines: null, signature: "copper-plate|iron-plate#|" });
        expect(result.differences).toEqual([
            { code: "splitter-or-loader-lane", entity_number: 22, lane: 1 },
            { code: "splitter-or-loader-lane", entity_number: 22, lane: 2 },
        ]);
    });

    it("drops only the lane whose item stands at splitter pieces alone, and lists lane 2 with lane lines [2]", () => {
        const l = [line(22, [22, 23, 24])];
        const flows = flowsWith({
            lanes: [laneOf(22, 1, ["iron-plate"]), laneOf(22, 2, ["copper-plate"])],
            pieces: [onPiece(22, 1, ["iron-plate"]), onPiece(24, 2, ["copper-plate"])],
        });
        const result = idsFor(flows, l);
        expect(result.belts[0]).toMatchObject({ lanes: [{ ingredient: "copper-plate" }], lane_lines: [2], signature: "copper-plate|iron-plate#|copper-plate" });
        expect(result.differences).toEqual([{ code: "splitter-or-loader-lane", entity_number: 22, lane: 1 }]);
    });

    it("keeps an item that stands at a loader piece and at a belt piece as the lane's item", () => {
        const l = [line(22, [22, 23, 24])];
        const flows = flowsWith({
            lanes: [laneOf(22, 1, ["iron-plate"]), laneOf(22, 2, ["iron-plate"])],
            pieces: [onPiece(23, 1, ["iron-plate"]), onPiece(24, 1, ["iron-plate"]), onPiece(24, 2, ["iron-plate"])],
        });
        const result = idsFor(flows, l);
        expect(result.belts[0]).toMatchObject({ lanes: [{ ingredient: "iron-plate" }, { ingredient: "iron-plate" }], lane_lines: [1, 2] });
        expect(result.differences).toEqual([]);
    });

    it("keeps an answered lane value that no piece shows as the lane's item", () => {
        const flows = flowsWith({ lanes: [laneOf(1, 1, ["iron-plate"], "answered"), laneOf(1, 2, [], "other-lane")] });
        const result = idsFor(flows);
        expect(result.belts[0]).toMatchObject({ items: ["iron-plate"], lanes: [{ ingredient: "iron-plate" }, { ingredient: "" }], lane_lines: [1, 2], signature: "iron-plate#iron-plate|" });
    });

    it("numbers a line that only the takers' items name, with no item on any piece", () => {
        const flows = flowsWith({ lanes: [laneOf(1, 1, ["iron-plate"], "takers"), laneOf(1, 2, ["iron-plate"], "takers")] });
        const result = idsFor(flows);
        expect(result.belts[0]).toMatchObject({ items: ["iron-plate"], lane_lines: [1, 2] });
    });

    it("lists lane 2 alone with lane lines [2], and both lanes with [1, 2]", () => {
        const one = idsFor(flowsWith({ lanes: [laneOf(1, 1, [], "other-lane"), laneOf(1, 2, ["iron-plate"])], pieces: [onPiece(2, 2, ["iron-plate"])] }));
        expect(one.belts[0]).toMatchObject({ lanes: [{ ingredient: "iron-plate" }], lane_lines: [2], signature: "iron-plate#|iron-plate" });
        const two = idsFor(flowsWith({ lanes: [laneOf(1, 1, ["iron-plate"]), laneOf(1, 2, ["copper-plate"])], pieces: [onPiece(2, 1, ["iron-plate"]), onPiece(2, 2, ["copper-plate"])] }));
        expect(two.belts[0]).toMatchObject({ lanes: [{ ingredient: "iron-plate" }, { ingredient: "copper-plate" }], lane_lines: [1, 2] });
    });

    it("gives a line with no item none, and a line the flows give no value none", () => {
        const flows = flowsWith({ lanes: [laneOf(1, 1, [], "other-lane"), laneOf(1, 2, [], "other-lane")] });
        const result = idsFor(flows);
        expect(result.belts).toEqual([]);
        expect(result.lines.map((l) => [l.line, l.belt, l.why])).toEqual([
            [1, null, "no-item"],
            [11, null, "no-value"],
            [31, null, "no-value"],
        ]);
    });

    it("gives a line whose lane item is an open question none, nor the inserters at it, and an answer moves the later ids", () => {
        // inserters 40 and 41: a chest with an item onto line 1 and onto line 11
        const w = withWorld([...rowOf(1, 0), ...rowOf(11, 2), spot(50, "steel-chest", 20.5, 20.5), spot(40, "stack-inserter", 20.5, 22.5), spot(41, "stack-inserter", 20.5, 24.5)]);
        const geometry = geometryWith([ends(w, 40, 50, 1), ends(w, 41, 50, 11)], [line(1, [1, 2, 3]), line(11, [11, 12, 13])]);
        const openFlows = flowsWith({
            chests: [{ entity_number: 50, items: ["iron-plate"] }],
            lanes: [laneOf(1, 1, ["a-item", "b-item"]), laneOf(1, 2, ["b-item"]), laneOf(11, 1, ["copper-plate"]), laneOf(11, 2, ["copper-plate"])],
            pieces: [onPiece(11, 1, ["copper-plate"]), onPiece(11, 2, ["copper-plate"])],
            questions: [question(1, 1, ["a-item", "b-item"])],
        });
        const open = idsOf(w, [], geometry, openFlows, IDS_DATA);
        expect(open.belts.map((b) => [b.id, b.first_line])).toEqual([[1, 11]]);
        expect(open.final).toBe(false);
        expect(open.inserters.map((i) => [i.id, i.entity_number])).toEqual([[1, 41]]);
        expect(open.left_out_inserters).toEqual([{ entity_number: 40, end: "drop" }]);
        const answered = idsOf(
            w,
            [],
            geometry,
            flowsWith({
                chests: [{ entity_number: 50, items: ["iron-plate"] }],
                lanes: [laneOf(1, 1, ["a-item"], "answered"), laneOf(1, 2, ["b-item"]), laneOf(11, 1, ["copper-plate"]), laneOf(11, 2, ["copper-plate"])],
                pieces: [onPiece(1, 1, ["a-item"]), onPiece(1, 2, ["b-item"]), onPiece(11, 1, ["copper-plate"]), onPiece(11, 2, ["copper-plate"])],
            }),
            IDS_DATA,
        );
        expect(answered.final).toBe(true);
        expect(answered.inserters.map((i) => [i.id, i.entity_number, i.sink.id])).toEqual([
            [1, 40, 1],
            [2, 41, 2],
        ]);
        expect(answered.belts.map((b) => [b.id, b.first_line])).toEqual([
            [1, 1],
            [2, 11],
        ]);
    });

    it("treats a lane that waits on a drill's ore as open", () => {
        const flows = flowsWith({ lanes: [laneOf(1, 1, ["iron-plate"], "takers", true), laneOf(1, 2, ["iron-plate"], "takers", true)] });
        expect(idsFor(flows).lines[0]).toEqual({ line: 1, belt: null, why: "open" });
    });
});

describe("chests", () => {
    const world = withWorld([
        spot(1, "infinity-chest", 0.5, 0.5),
        spot(2, "car", 5, 5),
        spot(3, "tank", 8, 5),
        spot(4, "cargo-wagon", 11, 5),
        spot(5, "rocket-silo", 20.5, 20.5),
        spot(6, "steel-chest", 30.5, 0.5),
        spot(7, "steel-chest", 32.5, 0.5),
        spot(8, "linked-chest", 34.5, 0.5),
        spot(9, "logistic-chest", 36.5, 0.5),
        spot(10, "steel-chest", 38.5, 0.5),
    ]);
    const flows = flowsWith({
        chests: [
            { entity_number: 7, items: ["iron-plate"] },
            { entity_number: 8, items: ["iron-plate"] },
            { entity_number: 9, items: ["copper-plate"] },
            { entity_number: 10, items: ["copper-plate", "iron-plate"] },
        ],
    });
    const ids = idsOf(world, [], geometryWith([]), flows, IDS_DATA);

    it("numbers an infinity chest, a car, a tank, a wagon and a rocket silo with no item and no recipe, in entity order", () => {
        expect(ids.chests.map((c) => [c.id, c.entity_number, c.chest_type])).toEqual([
            [1, 1, "infinity-chest"],
            [2, 2, "car"],
            [3, 3, "tank"],
            [4, 4, "cargo-wagon"],
            [5, 5, "rocket-silo"],
            [6, 7, "buffer-chest"],
            [7, 9, "buffer-chest"],
        ]);
    });

    it("gives a steel chest with no item none, and leaves its inserter out at that end", () => {
        expect(ids.chests.map((c) => c.entity_number)).not.toContain(6);
        const w = withWorld([spot(6, "steel-chest", 0.5, 0.5), spot(7, "assembling-machine-2", 5.5, 0.5), spot(8, "stack-inserter", 2.5, 0.5)]);
        const result = idsOf(w, reads([{ n: 7, name: "assembling-machine-2", recipe: "iron-gear-wheel" }]), geometryWith([ends(w, 8, 6, 7)]), flowsWith(), IDS_DATA);
        expect(result.left_out_inserters).toEqual([{ entity_number: 8, end: "pickup" }]);
    });

    it("gives a chest that the flows give two items none: the export's chest has one item", () => {
        expect(ids.chests.map((c) => c.entity_number)).not.toContain(10);
    });

    it("gives a linked chest none: the export infers an item only for a container and a logistic container", () => {
        expect(ids.chests.map((c) => c.entity_number)).not.toContain(8);
    });
});

describe("drills", () => {
    // 1 drill with an ore onto a machine, 2 drill with no ore, 3 drill onto a lab, 4 drill onto a chest with no item, 5 drill onto a chest; 10 furnace with a recipe, 11 lab, 12 steel chest, 13 steel chest with an item
    const world = withWorld([
        spot(10, "electric-furnace", 0.5, 0.5),
        spot(11, "lab", 5.5, 0.5),
        spot(12, "steel-chest", 9.5, 0.5),
        spot(13, "steel-chest", 11.5, 0.5),
        spot(1, "big-mining-drill", 20.5, 0.5),
        spot(2, "big-mining-drill", 30.5, 0.5),
        spot(3, "big-mining-drill", 40.5, 0.5),
        spot(4, "big-mining-drill", 50.5, 0.5),
        spot(5, "big-mining-drill", 60.5, 0.5),
    ]);
    const drill = (n: number, target: number, kind: "machine" | "chest", ore: string | null) => ({
        entity_number: n,
        name: "big-mining-drill",
        target: { kind, entity_number: target },
        candidates: ["iron-ore"],
        ore: ore === null ? null : { item: ore, steps: ["setpoint" as const] },
    });
    const flows = flowsWith({
        machines: [{ entity_number: 10, recipe: "iron-plate", how: "ore", via: "iron-ore" }],
        chests: [{ entity_number: 13, items: ["iron-ore"] }],
        drills: [drill(5, 13, "chest", "iron-ore"), drill(4, 12, "chest", "iron-ore"), drill(3, 11, "machine", "iron-ore"), drill(2, 10, "machine", null), drill(1, 10, "machine", "iron-ore")],
    });
    const ids = idsOf(world, [], geometryWith([]), flows, IDS_DATA);

    it("numbers the drills that have an ore and a target with an id, by entity number, with the target", () => {
        expect(ids.drills).toEqual([
            { id: 1, entity_number: 1, name: "big-mining-drill", target: { type: "machine", id: 1 } },
            { id: 2, entity_number: 5, name: "big-mining-drill", target: { type: "chest", id: 1 } },
        ]);
    });

    it("lists a drill with no ore and a drill whose target has no id as left out", () => {
        expect(ids.left_out_drills).toEqual([
            { entity_number: 2, name: "big-mining-drill", reason: "no-ore" },
            { entity_number: 3, name: "big-mining-drill", reason: "target-has-no-id" },
            { entity_number: 4, name: "big-mining-drill", reason: "target-has-no-id" },
        ]);
    });
});

describe("inserters", () => {
    // machine 1 with a recipe, machine 2 with a recipe, a lab 3, a drill 4, a beacon 5, belt line of 6, chest 7 with an item; inserters 20 to 26
    const world = withWorld([
        spot(1, "assembling-machine-2", 1.5, 1.5),
        spot(2, "assembling-machine-2", 5.5, 1.5),
        spot(3, "lab", 9.5, 1.5),
        spot(4, "big-mining-drill", 15.5, 1.5),
        spot(5, "beacon", 21.5, 1.5),
        spot(6, "turbo-transport-belt", 26.5, 1.5, { direction: 4 }),
        spot(7, "steel-chest", 28.5, 1.5),
    ]);
    const entities = reads([
        { n: 1, name: "assembling-machine-2", recipe: "iron-gear-wheel" },
        { n: 2, name: "assembling-machine-2", recipe: "copper-cable" },
    ]);
    const flows = flowsWith({
        chests: [{ entity_number: 7, items: ["iron-plate"] }],
        lanes: [laneOf(6, 1, ["iron-plate"]), laneOf(6, 2, ["iron-plate"])],
        pieces: [onPiece(6, 1, ["iron-plate"]), onPiece(6, 2, ["iron-plate"])],
    });
    const idsWith = (list: InserterEnds[]) => idsOf(world, entities, geometryWith(list, [line(6, [6])]), flows, IDS_DATA);

    it("numbers an inserter whose two ends have an id, with its source and sink", () => {
        const result = idsWith([ends(world, 21, 7, 1), ends(world, 20, 1, 6)]);
        expect(result.inserters).toEqual([
            { id: 1, entity_number: 20, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 } },
            { id: 2, entity_number: 21, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 } },
        ]);
        expect(result.left_out_inserters).toEqual([]);
    });

    it("leaves an inserter out with the end named, the pickup first, for a lab, a drill, a beacon and nothing", () => {
        const result = idsWith([ends(world, 20, 3, 1), ends(world, 21, 4, 1), ends(world, 22, 5, 1), ends(world, 23, null, 1), ends(world, 24, 1, 3), ends(world, 25, 1, null), ends(world, 26, 3, 5)]);
        expect(result.left_out_inserters).toEqual([
            { entity_number: 20, end: "pickup" },
            { entity_number: 21, end: "pickup" },
            { entity_number: 22, end: "pickup" },
            { entity_number: 23, end: "pickup" },
            { entity_number: 24, end: "drop" },
            { entity_number: 25, end: "drop" },
            { entity_number: 26, end: "pickup" },
        ]);
        expect(result.inserters).toEqual([]);
    });

    it("moves the later ids when an earlier inserter is left out", () => {
        const kept = idsWith([ends(world, 20, 1, 2), ends(world, 21, 1, 2)]);
        const shifted = idsWith([ends(world, 20, 3, 2), ends(world, 21, 1, 2)]);
        expect(kept.inserters.map((i) => [i.id, i.entity_number])).toEqual([
            [1, 20],
            [2, 21],
        ]);
        expect(shifted.inserters.map((i) => [i.id, i.entity_number])).toEqual([[1, 21]]);
    });
});

describe("differences from the export", () => {
    const world = withWorld([
        spot(1, "crusher", 1.5, 1.5),
        spot(2, "assembling-machine-2", 5.5, 1.5),
        spot(3, "captive-biter-spawner", 9.5, 1.5),
        spot(4, "turbo-splitter", 12, 20.5, { direction: 4 }),
        spot(5, "stack-inserter", 14.5, 1.5),
        spot(6, "turbo-transport-belt", 16.5, 20.5, { direction: 4 }),
        spot(7, "stack-inserter", 18.5, 1.5),
    ]);

    it("gives a crusher with a recipe its code, and a captive biter spawner none", () => {
        const result = idsOf(world, reads([{ n: 1, name: "crusher", recipe: "ice-melting" }, { n: 3, name: "captive-biter-spawner", recipe: "biter-egg" }]), geometryWith([]), flowsWith(), IDS_DATA);
        expect(result.machines).toEqual([]);
        expect(result.differences).toEqual([{ code: "crusher", entity_number: 1 }]);
    });

    it("gives a crusher with no recipe no difference", () => {
        const result = idsOf(world, reads([{ n: 1, name: "crusher" }]), geometryWith([]), flowsWith(), IDS_DATA);
        expect(result.differences).toEqual([]);
    });

    it("gives an inserter whose drop entity is a splitter its code, and the splitter's line no item from it", () => {
        const flows = flowsWith({ lanes: [laneOf(4, 1, [], "other-lane"), laneOf(4, 2, [], "other-lane")] });
        const result = idsOf(world, reads([{ n: 2, name: "assembling-machine-2", recipe: "iron-gear-wheel" }]), geometryWith([ends(world, 5, 2, 4)], [line(4, [4, 6])]), flows, IDS_DATA);
        expect(result.differences).toEqual([{ code: "splitter-drop", entity_number: 5 }]);
        expect(result.belts).toEqual([]);
        expect(result.left_out_inserters).toEqual([{ entity_number: 5, end: "drop" }]);
    });

    it("gives a machine whose recipe a circuit sets none, and a build with none an empty list", () => {
        const flows = flowsWith({ circuit_set: [{ entity_number: 2, sets: "recipe" }] });
        const result = idsOf(world, reads([{ n: 2, name: "assembling-machine-2", recipe: "iron-gear-wheel" }]), geometryWith([]), flows, IDS_DATA);
        expect(result.machines).toEqual([]);
        expect(result.differences).toEqual([]);
        expect(idsOf(world, [], geometryWith([]), flowsWith(), IDS_DATA).differences).toEqual([]);
    });
});

describe("purity and malformed input", () => {
    const world = withWorld([
        spot(1, "assembling-machine-2", 1.5, 1.5),
        spot(2, "electric-furnace", 5.5, 1.5),
        spot(3, "steel-chest", 9.5, 1.5),
        spot(4, "turbo-transport-belt", 11.5, 1.5, { direction: 4 }),
        spot(5, "turbo-transport-belt", 12.5, 1.5, { direction: 4 }),
        spot(6, "turbo-transport-belt", 11.5, 4.5, { direction: 4 }),
        spot(7, "stack-inserter", 3.5, 1.5),
        spot(8, "stack-inserter", 7.5, 1.5),
        spot(9, "big-mining-drill", 30.5, 1.5),
        spot(10, "infinity-chest", 20.5, 1.5),
    ]);
    const entities = reads([{ n: 1, name: "assembling-machine-2", recipe: "iron-gear-wheel" }]);
    const geometry = geometryWith([ends(world, 7, 1, 2), ends(world, 8, 2, 4)], [line(4, [4, 5]), line(6, [6])]);
    const flows = flowsWith({
        machines: [{ entity_number: 2, recipe: "iron-plate", how: "input" }],
        chests: [{ entity_number: 3, items: ["iron-plate"] }],
        lanes: [laneOf(4, 1, ["iron-plate"]), laneOf(4, 2, ["iron-plate"]), laneOf(6, 1, ["iron-plate"]), laneOf(6, 2, ["iron-plate"])],
        pieces: [onPiece(4, 1, ["iron-plate"]), onPiece(4, 2, ["iron-plate"]), onPiece(6, 1, ["iron-plate"]), onPiece(6, 2, ["iron-plate"])],
        drills: [{ entity_number: 9, name: "big-mining-drill", target: { kind: "chest", entity_number: 3 }, candidates: [], ore: { item: "iron-ore", steps: ["answered"] } }],
    });
    const reference = idsOf(world, entities, geometry, flows, IDS_DATA);

    it("gives deep-equal output for the input's lists in another order", () => {
        const reversed = <T>(list: readonly T[]) => [...list].reverse();
        const shuffledWorld: BuildWorld = { ...world, entities: reversed(world.entities) };
        const shuffled = idsOf(
            shuffledWorld,
            reversed(entities),
            { ...geometry, ends: reversed(geometry.ends), lines: reversed(geometry.lines) },
            { ...flows, lanes: reversed(flows.lanes), pieces: reversed(flows.pieces), machines: reversed(flows.machines), chests: reversed(flows.chests), drills: reversed(flows.drills) },
            IDS_DATA,
        );
        expect(shuffled).toEqual(reference);
        expect(reference.belts.map((b) => b.lines)).toEqual([[4], [6]]);
    });

    it("sorts every list by its stated key", () => {
        const sorted = (list: { entity_number: number }[]) => list.map((e) => e.entity_number);
        for (const list of [reference.machines, reference.chests, reference.drills, reference.inserters, reference.left_out_inserters, reference.left_out_drills]) {
            expect(sorted(list)).toEqual([...sorted(list)].sort((a, b) => a - b));
        }
        expect(reference.belts.map((b) => b.id)).toEqual([1, 2]);
        expect(reference.lines.map((l) => l.line)).toEqual([4, 6]);
    });

    const ask = (...args: unknown[]) => (idsOf as (...a: unknown[]) => BuildIds)(...args);

    it("lists an argument that is missing or no record or list as a problem, with empty lists", () => {
        const cases: [string, unknown[]][] = [
            ["world", [null, entities, geometry, flows, IDS_DATA]],
            ["entities", [world, null, geometry, flows, IDS_DATA]],
            ["geometry", [world, entities, {}, flows, IDS_DATA]],
            ["flows", [world, entities, geometry, { lanes: [] }, IDS_DATA]],
            ["data", [world, entities, geometry, flows, null]],
        ];
        for (const [name, args] of cases) {
            const result = ask(...args);
            expect(result.problems, name).toEqual([{ code: "bad-input", name }]);
            expect([result.machines, result.belts, result.chests, result.drills, result.inserters, result.lines, result.differences], name).toEqual([[], [], [], [], [], [], []]);
            expect(result.final, name).toBe(false);
        }
        expect(ask(undefined, undefined, undefined, undefined, undefined).problems.map((p) => p.name)).toEqual(["data", "entities", "flows", "geometry", "world"]);
    });

    it("leaves out a malformed entry of a list, lists it with its list and entity number, and gives the rest as before", () => {
        const cases: [string, unknown[], { code: string; name: string; entity_number?: number }][] = [
            ["an end that is no record", [world, entities, { ...geometry, ends: [...geometry.ends, { inserter: 70, source: 5, sink: null }] }, flows, IDS_DATA], { code: "bad-entry", name: "geometry.ends" }],
            ["a line with no pieces", [world, entities, { ...geometry, lines: [...geometry.lines, { first: 90 }] }, flows, IDS_DATA], { code: "bad-entry", name: "geometry.lines" }],
            ["an entity that is null", [world, [...entities, null], geometry, flows, IDS_DATA], { code: "bad-entry", name: "entities" }],
            ["an entity that is a number", [world, [...entities, 3], geometry, flows, IDS_DATA], { code: "bad-entry", name: "entities" }],
            ["an entity whose number is a text", [world, [...entities, { entity_number: "x" }], geometry, flows, IDS_DATA], { code: "bad-entry", name: "entities" }],
            ["a drill with no target", [world, entities, geometry, { ...flows, drills: [...flows.drills, { entity_number: 91 }] }, IDS_DATA], { code: "bad-entry", name: "flows.drills", entity_number: 91 }],
            ["a lane that is no lane", [world, entities, geometry, { ...flows, lanes: [...flows.lanes, { line: 4, lane: 3, items: [] }] }, IDS_DATA], { code: "bad-entry", name: "flows.lanes" }],
            ["a piece with items that are no list", [world, entities, geometry, { ...flows, pieces: [...flows.pieces, { piece: 4, lane: 1, items: 5 }] }, IDS_DATA], { code: "bad-entry", name: "flows.pieces" }],
            ["a world entity with no number", [{ ...world, entities: [...world.entities, { name: "x" }] }, entities, geometry, flows, IDS_DATA], { code: "bad-entry", name: "world.entities" }],
        ];
        for (const [what, args, problem] of cases) {
            const result = ask(...args);
            expect(result.problems, what).toEqual([problem.entity_number === undefined ? { code: problem.code, name: problem.name } : { ...problem }]);
            expect({ ...result, problems: [] }, what).toEqual({ ...reference, problems: [] });
        }
    });

    it("reads a data slice with no crafting machines as no data, and lists it", () => {
        const result = ask(world, entities, geometry, flows, {});
        expect(result.problems).toContainEqual({ code: "bad-input", name: "data.crafting_machines" });
        expect(result.machines).toEqual([]);
    });
});

// ---------------------------------------------------------------- the seven sample builds whose reads hold positions

type ReadEnd = { type: string; id: number };
type ReadFile = {
    machines?: { id: number; prototype?: string; position?: { x: number; y: number }; result_target?: ReadEnd }[];
    belts?: { id: number; lanes?: { ingredient?: string }[] }[];
    chests?: { id: number; type: string; prototype?: string; position?: { x: number; y: number } }[];
    drills?: { configs?: { id: number; type: string; mined_item_name?: string; position?: { x: number; y: number }; target?: ReadEnd }[] };
    inserters?: { prototype?: string; position?: { x: number; y: number }; direction?: number; source: ReadEnd; sink: ReadEnd }[];
    setpoint?: { item?: string };
};

/** The drills of a read: a read with none holds an empty record where the list would be */
const drillsOf = (file: ReadFile) => (Array.isArray(file.drills?.configs) ? file.drills!.configs : []);

const BUILDS: { name: string; stem: string; ext: string }[] = [
    { name: "iron", stem: "smelting/iron-plate/iron-plate-80-car-chest", ext: ".sidecar-export.json" },
    { name: "lithium", stem: "smelting/lithium-plate/lithium-plate-80-silo-chest", ext: ".sidecar-export.json" },
    { name: "steel", stem: "smelting/steel-plate/steel-plate-26-wagon-chest", ext: ".sidecar-export.json" },
    { name: "logistic-240", stem: "science/logistic/logistic-240", ext: ".json" },
    { name: "stone-brick-120", stem: "smelting/stone-brick/stone-brick-120-drill-direct-insert", ext: ".json" },
    { name: "electromagnetic-240", stem: "science/electromagnetic/electromagnetic-240-recycler-belt-fed", ext: ".json" },
    { name: "productivity-module-80", stem: "intermediates/productivity-module/productivity-module-80-chest-chain", ext: ".json" },
];
const EXPECTED_READ_COUNTS = { machines: 27, chests: 15, drills: 3, inserters: 54 };

// the data slice: the repository's game data, as the tests of the world, geometry and flows take it
type Raw = Record<string, Record<string, any>>;
const RAW = JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as Raw;
const GEOMETRY_SLICE = JSON.parse(read(path.join(__dirname, "fixtures", "geometry", "data-slice.json"))) as { rows: Record<string, GeometryRow & PrototypeRow> };
type Row = GeometryRow & PrototypeRow;

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
    rows["boiler"] = { type: "boiler", tile_width: 3, tile_height: 2 };
    rows["locomotive"] = { type: "locomotive" };
    return rows;
}
const ROWS = rowsOf();
const WORLD_DATA: WorldData = ROWS;
const GEOMETRY_DATA: GeometryData = ROWS;
const FLOWS_DATA: FlowsData = {
    entity_types: Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [name, row.type])),
    mining_drills: Object.fromEntries(Object.entries(RAW["mining-drill"]).map(([name, row]) => [name, { resource_categories: row.resource_categories, vector_to_place_result: row.vector_to_place_result }])),
    resources: Object.fromEntries(Object.entries(RAW.resource).map(([name, row]) => [name, { ...(row.category ? { category: row.category } : {}), minable: row.minable }])),
    recipes: Object.fromEntries(Object.entries(RAW.recipe).map(([name, row]) => [name, { categories: row.categories, ingredients: row.ingredients, results: row.results }])),
    crafting_machines: Object.fromEntries(
        Object.entries(RAW.crafting_machine).map(([name, row]) => [name, { type: row.type, crafting_categories: row.crafting_categories, ...(row.vector_to_place_result ? { vector_to_place_result: row.vector_to_place_result } : {}) }]),
    ),
    items: Object.keys(RAW.item),
};

function decoded(file: string): BlueprintEntityRead[] {
    const outcome = decodeBlueprint(read(file).trim());
    if (outcome.kind !== "blueprint") throw new Error(`not a blueprint: ${file}`);
    return outcome.entities;
}

/** The entities of a read that have a position, named as the frame rule names them: machines, drills, chests and inserters */
function frameReadsOf(file: ReadFile): (FrameRead & { list: "machines" | "drills" | "chests" | "inserters"; index: number })[] {
    const out: (FrameRead & { list: "machines" | "drills" | "chests" | "inserters"; index: number })[] = [];
    (file.machines ?? []).forEach((r, index) => r.position && out.push({ list: "machines", index, kind: "machine", name: r.prototype as string, position: r.position }));
    (drillsOf(file)).forEach((r, index) => r.position && out.push({ list: "drills", index, kind: "drill", name: r.type, position: r.position }));
    (file.chests ?? []).forEach((r, index) => r.position && out.push({ list: "chests", index, kind: "chest", name: (r.prototype || r.type) as string, position: r.position }));
    (file.inserters ?? []).forEach((r, index) => r.position && out.push({ list: "inserters", index, kind: "inserter", name: r.prototype as string, position: r.position, direction: r.direction }));
    return out;
}

type Pipeline = { entities: BlueprintEntityRead[]; world: BuildWorld; geometry: BuildGeometry; flows: BuildFlows; ids: BuildIds };
function pipelineOf(entities: BlueprintEntityRead[], inputs: FlowsInputs): Pipeline {
    const world = worldOf(entities, WORLD_DATA);
    const geometry = geometryOf(world, entities, GEOMETRY_DATA);
    const flows = flowsOf(world, geometry, entities, inputs, FLOWS_DATA);
    return { entities, world, geometry, flows, ids: idsOf(world, entities, geometry, flows, IDS_DATA) };
}

type Answered = { answers: Record<string, string>; fromRead: string[]; unanswered: string[]; frameNotes: string[] };

/**
 * The answers that the read gives to the questions of the flows, asked again after each round: a drill's ore from the read
 * drill that the frame places on it, a lane's item from the read belt that a paired read inserter names at its end on the line.
 */
function answersFrom(entities: BlueprintEntityRead[], file: ReadFile, frames: Frame[], setpoint: string | undefined): Answered & { pipeline: Pipeline } {
    const answers: Record<string, string> = {};
    const fromRead: string[] = [];
    const unanswered = new Set<string>();
    const frameNotes: string[] = [];
    const readsList = frameReadsOf(file);
    for (let round = 0; round < 12; round += 1) {
        const pipeline = pipelineOf(entities, { answers, setpoint: { item: setpoint } });
        const fresh = pipeline.flows.questions.filter((q) => answers[q.key] === undefined);
        if (fresh.length === 0) return { answers, fromRead, unanswered: [...unanswered], frameNotes, pipeline };
        let added = 0;
        for (const q of fresh) {
            let value: string | undefined;
            for (const [k, frame] of frames.entries()) {
                const hit = (list: string, number: number) => readsList.find((r) => r.list === list && entityUnderRead(entities, frame, r)?.entity_number === number);
                if (q.type === "drill-ore") {
                    const r = hit("drills", q.subject.entity_number);
                    value = r === undefined ? undefined : drillsOf(file)[r.index]?.mined_item_name;
                } else {
                    const lineOfQuestion = pipeline.geometry.lines.find((l) => l.first === q.subject.entity_number);
                    for (const end of [...pipeline.geometry.ends].sort((a, b) => a.inserter - b.inserter)) {
                        for (const side of ["source", "sink"] as const) {
                            const e = end[side];
                            if (value !== undefined || !e || e.target !== "belt" || !lineOfQuestion?.pieces.includes(e.entity_number)) continue;
                            const r = hit("inserters", end.inserter);
                            const readEnd = r === undefined ? undefined : file.inserters?.[r.index][side];
                            const belt = readEnd?.type === "belt" ? file.belts?.find((b) => b.id === readEnd.id) : undefined;
                            if (belt?.lanes?.length === 2) value = belt.lanes[(q.subject.lane as number) - 1].ingredient;
                        }
                    }
                }
                if (value !== undefined) {
                    if (k > 0) frameNotes.push(`${q.key}: tied frame ${k} (${frame.transform} ${frame.translation.x}, ${frame.translation.y})`);
                    break;
                }
            }
            if (value === undefined) unanswered.add(q.key);
            else {
                answers[q.key] = value;
                fromRead.push(q.key);
                added += 1;
            }
        }
        if (added === 0) return { answers, fromRead, unanswered: [...unanswered], frameNotes, pipeline };
    }
    throw new Error("answers did not settle");
}

type EndKind = "inserter" | "drill" | "result";
type Check = { problems: string[]; counts: Record<string, { read: number; paired: number; imported: number; outside: number; idsEqual: number }>; beltPairs: number; ends: Record<EndKind, { agree: number; total: number }>; beltLanesEqual: { equal: number; total: number } };

/** Pairs the read with the import under a frame, and lists what differs */
function checkUnder(entities: BlueprintEntityRead[], file: ReadFile, frame: Frame, ids: BuildIds): Check {
    const problems: string[] = [];
    const readsList = frameReadsOf(file);
    const pairedOf = new Map<string, number>(); // `${list}:${index}` -> blueprint entity number
    for (const r of readsList) {
        const e = entityUnderRead(entities, frame, r);
        if (e) pairedOf.set(`${r.list}:${r.index}`, e.entity_number);
    }
    const counts: Check["counts"] = {};
    const maps: Record<string, Map<number, number>> = { machines: new Map(), chests: new Map(), drills: new Map(), inserters: new Map() };
    const importOf: Record<string, Map<number, { id: number }>> = {
        machines: new Map(ids.machines.map((m) => [m.entity_number, m])),
        chests: new Map(ids.chests.map((m) => [m.entity_number, m])),
        drills: new Map(ids.drills.map((m) => [m.entity_number, m])),
        inserters: new Map(ids.inserters.map((m) => [m.entity_number, m])),
    };
    const readIdOf = (list: string, index: number): number => {
        if (list === "machines") return file.machines![index].id;
        if (list === "chests") return file.chests![index].id;
        if (list === "drills") return drillsOf(file)[index].id;
        return index + 1;
    };
    const readTotals: Record<string, number> = { machines: file.machines?.length ?? 0, chests: file.chests?.length ?? 0, drills: drillsOf(file).length, inserters: file.inserters?.length ?? 0 };
    for (const list of ["machines", "chests", "drills", "inserters"]) {
        let paired = 0;
        let idsEqual = 0;
        const seenImport = new Set<number>();
        for (let index = 0; index < readTotals[list]; index += 1) {
            const n = pairedOf.get(`${list}:${index}`);
            if (n === undefined) {
                problems.push(`${list} ${readIdOf(list, index)}: no blueprint entity under the frame`);
                continue;
            }
            const imported = importOf[list].get(n);
            if (!imported) {
                problems.push(`${list} ${readIdOf(list, index)}: blueprint entity ${n} has no id`);
                continue;
            }
            if (seenImport.has(n)) problems.push(`${list} ${readIdOf(list, index)}: entity ${n} paired twice`);
            seenImport.add(n);
            paired += 1;
            maps[list].set(readIdOf(list, index), imported.id);
            if (imported.id === readIdOf(list, index)) idsEqual += 1;
        }
        const imports = [...importOf[list].keys()].length;
        if (new Set(maps[list].values()).size !== maps[list].size) problems.push(`${list}: the map from read id to import id is not one to one`);
        counts[list] = { read: readTotals[list], paired, imported: imports, outside: imports - paired, idsEqual };
    }
    // chest types
    for (const [index, c] of (file.chests ?? []).entries()) {
        const n = pairedOf.get(`chests:${index}`);
        const imported = n === undefined ? undefined : ids.chests.find((x) => x.entity_number === n);
        if (imported && c.type !== imported.chest_type) problems.push(`chest ${c.id}: type ${c.type} against ${imported.chest_type}`);
    }
    // the ends of each inserter, a drill's target and a result target, under the maps
    const beltMap = new Map<number, number>();
    const ends: Check["ends"] = { inserter: { agree: 0, total: 0 }, drill: { agree: 0, total: 0 }, result: { agree: 0, total: 0 } };
    const mapped = (kind: EndKind, end: ReadEnd, importEnd: { type: string; id: number }, what: string): boolean => {
        ends[kind].total += 1;
        const mine = end.type === "machine" ? maps.machines : end.type === "chest" ? maps.chests : null;
        if (end.type !== importEnd.type) {
            problems.push(`${what}: type ${end.type} against ${importEnd.type}`);
            return false;
        }
        if (mine === null) {
            const known = beltMap.get(end.id);
            if (known !== undefined && known !== importEnd.id) {
                problems.push(`${what}: belt ${end.id} is import belt ${known} and ${importEnd.id}`);
                return false;
            }
            beltMap.set(end.id, importEnd.id);
        } else if (mine.get(end.id) !== importEnd.id) {
            problems.push(`${what}: ${end.type} ${end.id} is import ${mine.get(end.id)} against ${importEnd.id}`);
            return false;
        }
        ends[kind].agree += 1;
        return true;
    };
    (file.inserters ?? []).forEach((r, index) => {
        const n = pairedOf.get(`inserters:${index}`);
        const imported = n === undefined ? undefined : ids.inserters.find((x) => x.entity_number === n);
        if (!imported) return;
        mapped("inserter", r.source, imported.source, `inserter ${index + 1} pickup`);
        mapped("inserter", r.sink, imported.sink, `inserter ${index + 1} drop`);
    });
    (drillsOf(file)).forEach((r, index) => {
        const n = pairedOf.get(`drills:${index}`);
        const imported = n === undefined ? undefined : ids.drills.find((x) => x.entity_number === n);
        if (imported && r.target) mapped("drill", r.target, imported.target, `drill ${r.id} target`);
    });
    (file.machines ?? []).forEach((r, index) => {
        const n = pairedOf.get(`machines:${index}`);
        const imported = n === undefined ? undefined : ids.machines.find((x) => x.entity_number === n);
        if (!imported || !r.result_target) return;
        if (imported.result_target === null) problems.push(`machine ${r.id}: result target ${r.result_target.type} ${r.result_target.id} against none`);
        else mapped("result", r.result_target, imported.result_target, `machine ${r.id} result target`);
    });
    if (new Set(beltMap.values()).size !== beltMap.size) problems.push("the belt map is not one to one");
    let lanesEqual = 0;
    for (const [readBelt, importBelt] of beltMap) {
        const r = file.belts?.find((b) => b.id === readBelt)?.lanes?.map((l) => l.ingredient ?? "") ?? [];
        const i = ids.belts.find((b) => b.id === importBelt)?.lanes.map((l) => l.ingredient) ?? [];
        if (JSON.stringify(r) === JSON.stringify(i)) lanesEqual += 1;
        else problems.push(`belt ${readBelt}: lanes ${JSON.stringify(r)} against ${JSON.stringify(i)}`);
    }
    return { problems, counts, beltPairs: beltMap.size, ends, beltLanesEqual: { equal: lanesEqual, total: beltMap.size } };
}

type BuildRun = { name: string; entities: BlueprintEntityRead[]; file: ReadFile; frames: Frame[]; answered: Answered; pipeline: Pipeline; check: Check; tied: { frame: Frame; problems: string[]; answers: Record<string, string>; unanswered: string[]; check: Check }[] };

function runBuild(build: (typeof BUILDS)[number]): BuildRun {
    const entities = decoded(path.join(SAMPLES, build.stem + ".scaffold"));
    const file = JSON.parse(read(path.join(SAMPLES, build.stem + build.ext))) as ReadFile;
    const config = JSON.parse(read(path.join(SAMPLES, build.stem + ".json"))) as ReadFile;
    const setpoint = config.setpoint?.item;
    const candidates = candidateFrames(entities, frameReadsOf(file));
    const best = candidates[0];
    const tiedFrames = candidates.slice(0, best.tie_count);
    const sameTransform = tiedFrames.filter((c) => c.transform === best.transform);
    const answered = answersFrom(entities, file, sameTransform, setpoint);
    const check = checkUnder(entities, file, best, answered.pipeline.ids);
    const tied = tiedFrames.map((frame) => {
        const a = answersFrom(entities, file, [frame], setpoint);
        return { frame, problems: [] as string[], answers: a.answers, unanswered: a.unanswered, check: checkUnder(entities, file, frame, a.pipeline.ids) };
    });
    return { name: build.name, entities, file, frames: [best], answered, pipeline: answered.pipeline, check, tied };
}

const RUNS = BUILDS.map(runBuild);

describe("the ids of the 7 sample builds under their frame", () => {
    it("pairs every read machine, chest, drill and inserter with one import entry: 27, 15, 3 and 54 in all", () => {
        const totals = { machines: 0, chests: 0, drills: 0, inserters: 0 };
        for (const run of RUNS) {
            for (const list of ["machines", "chests", "drills", "inserters"] as const) {
                expect(run.check.counts[list].paired, `${run.name} ${list}`).toBe(run.check.counts[list].read);
                totals[list] += run.check.counts[list].paired;
            }
        }
        expect(totals).toEqual(EXPECTED_READ_COUNTS);
    });

    it("answers every open question from the read", () => {
        for (const run of RUNS) expect(run.answered.unanswered, run.name).toEqual([]);
    });

    it("agrees, under the maps from read id to import id, on every inserter's ends, every drill's target and every result target", () => {
        for (const run of RUNS) expect(run.check.problems, run.name).toEqual([]);
    });

    it("leaves no question open after the answers, so the ids are final", () => {
        for (const run of RUNS) expect(run.pipeline.ids.final, run.name).toBe(true);
    });

    it("agrees on 108 inserter ends, 3 drill targets and the one result target of the recycler of electromagnetic 240", () => {
        const sum = (kind: EndKind) => RUNS.reduce((t, run) => ({ agree: t.agree + run.check.ends[kind].agree, total: t.total + run.check.ends[kind].total }), { agree: 0, total: 0 });
        expect(sum("inserter")).toEqual({ agree: 108, total: 108 });
        expect(sum("drill")).toEqual({ agree: 3, total: 3 });
        expect(sum("result")).toEqual({ agree: 1, total: 1 });
        expect(RUNS.find((r) => r.name === "electromagnetic-240")!.check.ends.result).toEqual({ agree: 1, total: 1 });
    });

    it("pairs the 13 belts that the inserter ends name one to one, with the read's lanes", () => {
        expect(RUNS.map((run) => [run.name, run.check.beltPairs, run.check.beltLanesEqual])).toEqual([
            ["iron", 1, { equal: 1, total: 1 }],
            ["lithium", 1, { equal: 1, total: 1 }],
            ["steel", 1, { equal: 1, total: 1 }],
            ["logistic-240", 2, { equal: 2, total: 2 }],
            ["stone-brick-120", 1, { equal: 1, total: 1 }],
            ["electromagnetic-240", 5, { equal: 5, total: 5 }],
            ["productivity-module-80", 2, { equal: 2, total: 2 }],
        ]);
    });

    it("takes from the read the ore of iron's drill, and asks nothing of the others: logistic 240's row lanes hold one item each past the splitters", () => {
        const answers = (name: string) => RUNS.find((r) => r.name === name)!.answered.answers;
        expect(answers("iron")).toEqual({ "drill-ore:1": "iron-ore" });
        for (const name of ["lithium", "steel", "logistic-240", "stone-brick-120", "electromagnetic-240", "productivity-module-80"]) expect(answers(name), name).toEqual({});
    });
});

// ---------------------------------------------------------------- witnesses, written where a folder is named

const WITNESS = process.env.IDS_WITNESS_DIRECTORY;
describe("witnesses", () => {
    it.skipIf(!WITNESS)("writes the id check, the tied frames and the order", () => {
        const rows: string[] = ["build\tlist\tread\tpaired\timport entries\toutside the read\tcheck problems\tanswers"];
        for (const run of RUNS) {
            for (const list of ["machines", "chests", "drills", "inserters"]) {
                const c = run.check.counts[list];
                rows.push([run.name, list, c.read, c.paired, c.imported, c.outside, run.check.problems.length, "-"].join("\t"));
            }
            rows.push([run.name, "belts (by the inserter ends)", run.file.belts?.length ?? 0, run.check.beltPairs, run.pipeline.ids.belts.length, run.pipeline.ids.belts.length - run.check.beltPairs, run.check.problems.length, `lanes equal ${run.check.beltLanesEqual.equal} of ${run.check.beltLanesEqual.total}`].join("\t"));
            rows.push([run.name, "inserter ends, drill targets, result targets", `${run.check.ends.inserter.total}, ${run.check.ends.drill.total}, ${run.check.ends.result.total}`, `${run.check.ends.inserter.agree}, ${run.check.ends.drill.agree}, ${run.check.ends.result.agree}`, "-", "-", run.check.problems.length, (run.answered.fromRead.length > 0 ? `answered from the read: ${run.answered.fromRead.join(" ")}` : "none answered from the read") + (run.answered.frameNotes.length > 0 ? `; ${run.answered.frameNotes.join("; ")}` : "")].join("\t"));
        }
        fs.writeFileSync(path.join(WITNESS!, "sample-builds-ids.tsv"), rows.join("\n") + "\n");

        const tied: string[] = ["build\tframe\ttranslation\tchosen\tpaired reads\tproblems\tanswers from the read\tunanswered\tfirst problem"];
        for (const run of RUNS) {
            for (const t of run.tied) {
                const chosen = t.frame.transform === run.tied[0].frame.transform && t.frame.translation.x === run.tied[0].frame.translation.x && t.frame.translation.y === run.tied[0].frame.translation.y;
                const pairedAll = Object.values(t.check.counts).reduce((s, c) => s + c.paired, 0);
                tied.push([run.name, t.frame.transform, `${t.frame.translation.x},${t.frame.translation.y}`, chosen ? "chosen" : "-", pairedAll, t.check.problems.length, Object.entries(t.answers).map(([key, value]) => `${key}=${value}`).join(" ") || "-", t.unanswered.join(" ") || "-", t.check.problems[0] ?? "-"].join("\t"));
            }
        }
        fs.writeFileSync(path.join(WITNESS!, "tied-frames.tsv"), tied.join("\n") + "\n");

        const order: string[] = ["build\tlist\tpaired\tids equal to the read's"];
        for (const run of RUNS) for (const list of ["machines", "chests", "drills", "inserters"]) order.push([run.name, list, run.check.counts[list].paired, run.check.counts[list].idsEqual].join("\t"));
        fs.writeFileSync(path.join(WITNESS!, "order.tsv"), order.join("\n") + "\n");
        expect(rows.length).toBeGreaterThan(1);
    });
});
