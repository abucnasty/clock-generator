import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { BlueprintEntityRead } from "./blueprint-entities";
import { decodeBlueprint } from "./decode";
import { Basis, BuildGeometry, GeometryData, GeometryRow, geometryOf, lineLengthOf } from "./geometry";
import { ConfigSchema } from "../config/schema";
import { BuildWorld, Point, PrototypeRow, WorldData, worldOf } from "./world";

const ENGINE = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures", "geometry");
const SAMPLES = path.join(ENGINE, "resources", "config-samples");
const read = (file: string) => fs.readFileSync(file, "utf8");

// ---------------------------------------------------------------- the data slice and reading a blueprint

type SliceRow = GeometryRow & PrototypeRow & { source: string };
const slice = JSON.parse(read(path.join(FIXTURES, "data-slice.json"))) as { game_version: string; rows: Record<string, SliceRow> };
const DATA: GeometryData & WorldData = slice.rows;

type Built = { entities: BlueprintEntityRead[]; world: BuildWorld; geometry: BuildGeometry };

function buildOf(entities: BlueprintEntityRead[]): Built {
    const world = worldOf(entities, DATA);
    return { entities, world, geometry: geometryOf(world, entities, DATA) };
}

function decoded(text: string): BlueprintEntityRead[] {
    const outcome = decodeBlueprint(text);
    if (outcome.kind !== "blueprint") throw new Error(`not a blueprint: ${JSON.stringify(outcome)}`);
    return outcome.entities;
}

const built = (file: string): Built => buildOf(decoded(read(file).trim()));

type Row = Record<string, string>;
function table(file: string): Row[] {
    const [head, ...lines] = read(file).trimEnd().split("\n");
    const keys = head.split("\t");
    return lines.map((line) => Object.fromEntries(line.split("\t").map((value, i) => [keys[i], value])));
}

const nil = (value: unknown) => (value === null || value === undefined ? "nil" : String(value));
const countBy = <T,>(items: readonly T[], key: (item: T) => string) => {
    const counts: Record<string, number> = {};
    for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
    return counts;
};

// ---------------------------------------------------------------- fixture (a): the pickup rules against the game

describe("the pickup rules against the game's reads of 218 cells (measured, game 2.1.24)", () => {
    const build = built(path.join(FIXTURES, "pickup-rules.scaffold"));
    const { world, geometry, entities } = build;
    const expected = table(path.join(FIXTURES, "pickup-rules-expected.tsv"));
    const inputs = table(path.join(FIXTURES, "pickup-rules-inputs.tsv"));
    const points = JSON.parse(read(path.join(FIXTURES, "pickup-rules-points.json"))) as {
        entities: Record<string, [number, number]>;
        inserters: Record<string, { pickup: [number, number]; drop: [number, number] }>;
    };
    const ends = new Map(geometry.ends.map((e) => [e.inserter, e]));
    const pickups = new Map(geometry.pickups.map((p) => [p.inserter, p]));
    const sourceOf = (inserter: number) => ends.get(inserter)?.source?.entity_number;

    /** What the port gives for a row's field, written as the reads write it */
    function portValue(row: Row): string {
        const inserter = Number(row.inserter);
        const target = sourceOf(inserter);
        const piece = target === undefined ? undefined : world.piece(target);
        const pickup = pickups.get(inserter);
        const field = row.field;
        if (field === "pickup_target") return nil(target);
        if (field === "piece_shape") return nil(piece?.shape);
        if (field === "underground_pair") return nil(piece?.partner);
        if (field === "line_length_1" || field === "line_length_2") return nil(target === undefined ? null : lineLengthOf(world, target, field === "line_length_1" ? 1 : 2));
        if (field === "near_lane") return nil(pickup?.near_lane.value);
        if (field === "pickup_length") return nil(pickup?.pickup_length.value);
        if (field === "pickup_layout") return nil(pickup?.pickup_layout.value);
        if (field === "pickup_problem") return nil(pickup?.problem.value);
        if (field === "supply_problem") return nil(pickup?.supply_problem.value);
        throw new Error(`no port value for ${field}`);
    }

    /** Skipped: the tunnel lines of an underground end, a splitter's lines past its first two, and the in-line control's near lane */
    function skipOf(row: Row): string | null {
        const line = /^line_length_(\d)$/.exec(row.field);
        if (line && row.layout === "splitter" && Number(line[1]) > 2) return "a splitter's lines 3 to 8";
        if (line && Number(line[1]) > 2) return "an underground end's lines 3 and 4";
        if (row.field === "near_lane" && row.check === "no reference") return "the in-line control's near lane";
        return null;
    }

    const compared = expected.filter((row) => skipOf(row) === null);
    const skipped = expected.filter((row) => skipOf(row) !== null);

    it("decodes the scaffold of 1,144 entities and finds an inserter's ends for each of its 234 arms", () => {
        expect(entities).toHaveLength(1144);
        expect(geometry.ends).toHaveLength(234);
        expect(geometry.problems).toEqual([]);
    });

    it("compares every row that has a port value and skips only the three kinds of row that have none", () => {
        // a row with no game agreement is compared only where the game or the Sidecar gives the value
        const unreferenced = compared.filter((row) => row.check !== "agree").map((row) => (row.field === "supply_problem" ? "supply_problem" : `${row.layout} ${row.field}`));
        expect(countBy(unreferenced, (k) => k)).toEqual({ supply_problem: 32, "splitter line_length_1": 8, "splitter line_length_2": 8 });
        expect(compared).toHaveLength(1894);
        expect(skipped).toHaveLength(302);
        expect(skipped.length).toBe(350 - 32 - 16);
        expect(countBy(skipped, (row) => skipOf(row)!)).toEqual({
            "an underground end's lines 3 and 4": 252,
            "a splitter's lines 3 to 8": 48,
            "the in-line control's near lane": 2,
        });
        const per = (rows: Row[]) => countBy(rows, (row) => row.row);
        expect(per(compared)).toEqual({ "pickups-static": 1144, "pickups-behaviour": 142, "side-loaded-tile": 288, "underground-length": 320 });
        expect(per(expected)).toEqual({ "pickups-static": 1320, "pickups-behaviour": 172, "side-loaded-tile": 304, "underground-length": 400 });
    });

    it("gives the expected value on every compared row: ends, near lane, length, layout, problem, side load, line lengths and the world's shape and pairs", () => {
        const differ = compared
            .map((row) => ({ row, port: portValue(row) }))
            .filter(({ row, port }) => (row.field.startsWith("line_length") || row.field === "pickup_length" ? nil(Number(row.expected)) !== port && row.expected !== port : row.expected !== port))
            .map(({ row, port }) => `${row.cell} ${row.layout} inserter ${row.inserter} ${row.field}: expected ${row.expected}, port ${port}`);
        expect(differ).toEqual([]);
    });

    it("holds each cell to its inputs: the arm's mirroring, the piece's end and the pieces that feed it", () => {
        const heldOnly = ["supply_problem_raw", "first_lane_vs_fact"];
        const held = inputs.filter((row) => heldOnly.includes(row.field));
        const checked = inputs.filter((row) => !heldOnly.includes(row.field));
        expect(inputs).toHaveLength(427);
        expect(countBy(held, (row) => row.field)).toEqual({ supply_problem_raw: 32, first_lane_vs_fact: 3 });
        expect(checked).toHaveLength(392);
        const decodedOf = new Map(entities.map((e) => [e.entity_number, e]));
        const differ = checked.flatMap((row) => {
            const inserter = Number(row.inserter);
            const target = sourceOf(inserter);
            const piece = target === undefined ? undefined : world.piece(target);
            let port: string;
            if (row.field === "mirroring") port = decodedOf.get(inserter)?.mirror ? "True" : "False";
            else if (row.field === "piece_end") port = nil(piece?.end);
            else port = JSON.stringify(piece ? world.inputsOf(piece).map((p) => [p.entity_number, p.direction]) : null);
            return port === row.game ? [] : [`${row.cell} inserter ${row.inserter} ${row.field}: game ${row.game}, port ${port}`];
        });
        expect(differ).toEqual([]);
        expect(compared.length + skipped.length + checked.length + held.length).toBe(2623);
    });

    it("puts each arm's pickup and drop points where the game read them, after the one shift from the blueprint's frame", () => {
        const byNumber = new Map(entities.map((e) => [e.entity_number, e]));
        const shifts = new Set(Object.entries(points.entities).map(([n, [x, y]]) => `${x - byNumber.get(Number(n))!.position.x},${y - byNumber.get(Number(n))!.position.y}`));
        expect([...shifts]).toHaveLength(1);
        const [sx, sy] = [...shifts][0].split(",").map(Number);
        expect(Object.keys(points.entities)).toHaveLength(1142);
        const differ = Object.entries(points.inserters).flatMap(([n, read]) => {
            const end = ends.get(Number(n));
            const at = (p: Point | undefined) => (p ? [p.x + sx, p.y + sy] : null);
            const port = { pickup: at(end?.pickup), drop: at(end?.drop) };
            return JSON.stringify(port) === JSON.stringify({ pickup: read.pickup, drop: read.drop }) ? [] : [`inserter ${n}: read ${JSON.stringify(read)}, port ${JSON.stringify(port)}`];
        });
        expect(Object.keys(points.inserters)).toHaveLength(234);
        expect(differ).toEqual([]);
    });
});

describe("the drop points of the automation science 240 sample's output inserters (measured, game 2.1.24)", () => {
    const reads = JSON.parse(read(path.join(__dirname, "fixtures", "world", "output-line.json"))) as {
        frame_offset: Point;
        inserters: { unit: number; position: Point; drop_position: Point }[];
    };
    const { geometry, entities } = built(path.join(SAMPLES, "science", "automation", "automation-240.scaffold"));

    it("gives each of the 9 inserters the drop position the game read", () => {
        const { x: ox, y: oy } = reads.frame_offset;
        expect(reads.inserters).toHaveLength(9);
        for (const r of reads.inserters) {
            const e = entities.find((it) => it.position.x + ox === r.position.x && it.position.y + oy === r.position.y);
            expect(e, `inserter at ${JSON.stringify(r.position)}`).toBeDefined();
            const end = geometry.ends.find((it) => it.inserter === e!.entity_number)!;
            expect({ x: end.drop.x + ox, y: end.drop.y + oy }).toEqual(r.drop_position);
        }
    });
});

// ---------------------------------------------------------------- entities written by hand, and the witness tables

type Spec = { name: string; x: number; y: number; direction?: number; type?: "input" | "output"; mirror?: boolean; recipe?: string; orientation?: number; remove_unfiltered?: boolean };

/** Entities as a blueprint holds them, numbered in the order given */
function blueprintOf(specs: readonly Spec[]): BlueprintEntityRead[] {
    return specs.map((s, i) => ({
        entity_number: i + 1,
        name: s.name,
        position: { x: s.x, y: s.y },
        direction: s.direction ?? 0,
        mirror: s.mirror ?? false,
        quality: "normal",
        requests: [],
        filters: [],
        use_filters: false,
        ...(s.recipe !== undefined && { recipe: s.recipe }),
        ...(s.orientation !== undefined && { orientation: s.orientation }),
        ...(s.type !== undefined && { type: s.type }),
        ...(s.remove_unfiltered !== undefined && { infinity: { filters: [], remove_unfiltered_items: s.remove_unfiltered } }),
    }));
}

const N = 0, E = 4, S = 8, W = 12;
const STEP: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };

/** A small build written as the Sidecar's game tests place it: pieces by tile, an inserter beside a piece */
class Sketch {
    readonly specs: Spec[] = [];
    put(name: string, x: number, y: number, direction = N, extra: Partial<Spec> = {}): number {
        this.specs.push({ name, x, y, direction, ...extra });
        return this.specs.length;
    }
    /** `count` turbo belts from tile (x, y) the way they face; their entity numbers */
    line(x: number, y: number, direction: number, count: number): number[] {
        const [dx, dy] = STEP[direction];
        return Array.from({ length: count }, (_, i) => this.put("turbo-transport-belt", x + dx * i + 0.5, y + dy * i + 0.5, direction));
    }
    at(n: number): Point {
        return { x: this.specs[n - 1].x, y: this.specs[n - 1].y };
    }
    /** A stack inserter beside piece `n` on side (dx, dy) that takes from it, facing it */
    taker(n: number, dx: number, dy: number, extra: Partial<Spec> = {}): number {
        const p = this.at(n);
        return this.put("stack-inserter", p.x + dx, p.y + dy, dx === 1 ? W : dx === -1 ? E : dy === 1 ? N : S, extra);
    }
    /** A taker into a chest behind it */
    picker(n: number, dx: number, dy: number): number {
        const inserter = this.taker(n, dx, dy);
        const p = this.at(n);
        this.put("wooden-chest", p.x + 2 * dx, p.y + 2 * dy);
        return inserter;
    }
    /** A copy: a taker beside piece `n` into an assembler making gears beyond it */
    copy(n: number, dx: number, dy: number): { inserter: number; machine: number } {
        const p = this.at(n);
        const machine = this.put("assembling-machine-3", p.x + 3 * dx, p.y + 3 * dy, N, { recipe: "iron-gear-wheel" });
        return { inserter: this.taker(n, dx, dy), machine };
    }
    build(): Built {
        return buildOf(blueprintOf(this.specs));
    }
}

/** A build turned by quarter turns clockwise about the origin */
function turnedSpecs(specs: readonly Spec[], quarters: number): Spec[] {
    return specs.map((s) => {
        let { x, y } = s;
        for (let k = 0; k < quarters; k += 1) [x, y] = [-y, x];
        return { ...s, x: x + 0, y: y + 0, direction: ((s.direction ?? 0) + 4 * quarters) % 16 };
    });
}

/** The witness rows the tests write where GEOMETRY_WITNESS_DIRECTORY names a folder */
const witness: Record<string, string[]> = { "fixture-b.tsv": [], "fixture-c.tsv": [] };
function note(file: "fixture-b.tsv" | "fixture-c.tsv", group: string, item: string, derived: unknown, expected: unknown, verdict: string) {
    witness[file].push([group, item, JSON.stringify(derived), JSON.stringify(expected), verdict].join("\t"));
}
const verdictOf = (a: unknown, b: unknown) => (JSON.stringify(a) === JSON.stringify(b) ? "agree" : "differ");

afterAll(() => {
    const folder = process.env.GEOMETRY_WITNESS_DIRECTORY;
    if (!folder) return;
    for (const [file, rows] of Object.entries(witness)) fs.writeFileSync(path.join(folder, file), ["group\titem\tderived\texpected\tverdict", ...rows].join("\n") + "\n");
});

// ---------------------------------------------------------------- fixture (b): ends, drops and lane ends

type SampleInserter = { entity_number: number; id: number; source: { type: string; id?: number; near_lane?: number; pickup_length?: number; pickup_layout?: string }; sink: { type: string; id?: number; belt_direction?: number; drop_capture_tiles?: number } };
type SampleBuild = {
    name: string; scaffold: string; read: string; sidecar_version: string | null; hand: string[]; frame: Point;
    inserters: SampleInserter[]; belts: { id: number; type: string | null; lanes: (string | null)[]; flow_direction?: number; sharing: (string | null)[] }[];
};
type CopiesBuild = {
    name: string; blueprint: string; config: string; frame: Point; copies: number; copy_offset: Point;
    inserters: { entity_number: number; id: number; source: { type: string; id?: number }; sink: { type: string; id?: number } }[];
    belts: { id: number; flow_direction: number | null; sharing: (string | null)[] }[];
};
const samples = JSON.parse(read(path.join(FIXTURES, "sample-reads.json"))) as { builds: SampleBuild[]; lane_end_builds: SampleBuild[]; copies: CopiesBuild[] };
const sampleBuilt = new Map(samples.builds.map((b) => [b.name, built(path.join(SAMPLES, b.scaffold))]));
const version = (v: string | null) => (v === null ? null : v.split(".").map(Number));
const before = (v: string | null, since: string) => {
    const a = version(v), b = version(since)!;
    return a !== null && (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0;
};

/** The physical line of a piece */
const lineOf = (g: BuildGeometry, piece: number) => g.lines.find((l) => l.pieces.includes(piece));
/** One end for a lane that every pickup piece of the lines gives, else unknown */
function joinedEnds(lines: readonly BuildGeometry["lines"][number][]): [string, string] | null {
    const all = lines.flatMap((l) => l.pickups.map((p) => p.lane_ends.map((e) => e.value)));
    if (all.length === 0) return null;
    return [0, 1].map((i) => (all.every((e) => e[i] === all[0][i]) ? all[0][i] : "unknown")) as [string, string];
}

describe("inserter ends against the Sidecar reads of seven sample builds (derived rule, measured reads)", () => {
    for (const b of samples.builds) {
        it(`${b.name}: every inserter's source and sink type`, () => {
            const { geometry } = sampleBuilt.get(b.name)!;
            for (const ins of b.inserters) {
                const end = geometry.ends.find((e) => e.inserter === ins.entity_number);
                const got = { source: end?.source?.target ?? null, sink: end?.sink?.target ?? null };
                const want = { source: ins.source.type, sink: ins.sink.type };
                note("fixture-b.tsv", `${b.name} source type`, `inserter ${ins.entity_number}`, got.source, want.source, verdictOf(got.source, want.source));
                note("fixture-b.tsv", `${b.name} sink type`, `inserter ${ins.entity_number}`, got.sink, want.sink, verdictOf(got.sink, want.sink));
                expect(got, `${b.name} inserter ${ins.entity_number}`).toEqual(want);
            }
        });
    }
    it("counts 108 type rows on 54 inserters: iron 8, lithium 32, electromagnetic 24, logistic 4, productivity module 28, steel 10, stone brick 2", () => {
        expect(Object.fromEntries(samples.builds.map((b) => [b.name, 2 * b.inserters.length]))).toEqual({
            iron: 8, lithium: 32, steel: 10, "logistic-240": 4, "stone-brick-120": 2, "electromagnetic-240": 24, "productivity-module-80": 28,
        });
    });

    const endOf = (name: string, n: number) => sampleBuilt.get(name)!.geometry.ends.find((e) => e.inserter === n)!;
    it("iron's takers 7 and 8 take from the car, by the tile overlap of its turned collision box (derived)", () => {
        const { geometry } = sampleBuilt.get("iron")!;
        expect(geometry.vehicles).toHaveLength(1);
        for (const n of [7, 8]) expect(endOf("iron", n).source).toMatchObject({ entity_number: geometry.vehicles[0].entity_number, target: "chest", vehicle: true });
    });
    it("lithium's eight arms at the rocket silo end there (inserters 18, 19, 25, 26, 29, 31, 42, 43; derived)", () => {
        const { world } = sampleBuilt.get("lithium")!;
        for (const n of [18, 19, 25, 26, 29, 31, 42, 43]) {
            const end = endOf("lithium", n);
            const silo = [end.source, end.sink].find((x) => x && world.entity(x.entity_number)?.prototype === "rocket-silo");
            expect(silo, `inserter ${n}`).toBeDefined();
        }
    });
    it("steel's arms 8 to 12 end at the cargo wagon, the outer takers 8 and 12 among them (derived)", () => {
        const { geometry } = sampleBuilt.get("steel")!;
        expect(geometry.vehicles).toHaveLength(1);
        const wagon = geometry.vehicles[0].entity_number;
        for (const n of [8, 9, 10, 11, 12]) {
            const end = endOf("steel", n);
            expect([end.source?.entity_number, end.sink?.entity_number], `inserter ${n}`).toContain(wagon);
        }
    });
});

/** The collision box of a vehicle turned by its orientation about its position */
function expectedBox(e: BlueprintEntityRead): Point[] {
    const [[x0, y0], [x1, y1]] = DATA[e.name].collision_box as [[number, number], [number, number]];
    const a = 2 * Math.PI * (e.orientation ?? 0);
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ x: e.position.x + x * c - y * s, y: e.position.y + x * s + y * c }));
}
const closeTo = (a: readonly Point[] | null, b: readonly Point[]) => a !== null && a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9);

describe("vehicles, the box their ends are found by (derived)", () => {
    for (const [name, arms] of [["iron", [7, 8]], ["steel", [8, 9, 10, 11, 12]]] as const) {
        it(`${name}: the vehicle's box is its collision box turned by its orientation, and it is the box its arms reach`, () => {
            const { geometry, entities } = sampleBuilt.get(name)!;
            const [v] = geometry.vehicles;
            const e = entities.find((it) => it.entity_number === v.entity_number)!;
            expect(closeTo(v.box, expectedBox(e))).toBe(true);
            expect(Object.keys(v).sort()).toEqual(["box", "entity_number", "name"]);
            for (const n of arms) {
                const end = geometry.ends.find((it) => it.inserter === n)!;
                expect([end.source, end.sink].some((x) => x?.vehicle && x.entity_number === v.entity_number), `inserter ${n}`).toBe(true);
            }
        });
    }
    it("a tank, a car turned by 0.125 and a car no inserter reaches are all listed with their boxes", () => {
        const s = new Sketch();
        const tank = s.put("tank", 0, 0, N, { orientation: 0.25 });
        const car = s.put("car", 10, 0, N, { orientation: 0.125 });
        const lone = s.put("car", 20, 0, N, { orientation: 0 });
        // an inserter north of the tank that drops into it (the tank, turned a quarter, is 2.6 wide along x and 1.8 along y)
        const arm = s.put("stack-inserter", 0.5, -1.5, N);
        // an inserter that drops into the turned car
        const arm2 = s.put("stack-inserter", 10.5, -1.5, N);
        const { geometry, entities } = s.build();
        expect(geometry.vehicles.map((v) => v.entity_number)).toEqual([tank, car, lone]);
        for (const v of geometry.vehicles) expect(closeTo(v.box, expectedBox(entities.find((e) => e.entity_number === v.entity_number)!)), v.name).toBe(true);
        const end = (n: number) => geometry.ends.find((e) => e.inserter === n)!;
        expect(end(arm).sink).toMatchObject({ entity_number: tank, vehicle: true });
        expect(end(arm).basis).toBe("game");
        expect(end(arm2).sink).toMatchObject({ entity_number: car, vehicle: true });
        // the car turned by an eighth: no read holds that case
        expect(end(arm2).basis).toBe("unread");
    });
});

const reporting = built(path.join(FIXTURES, "drop-and-lane-reads.scaffold"));
const reportingRows = table(path.join(FIXTURES, "drop-and-lane-reads-expected.tsv"));

describe("drop lanes, side loads, lane ends and flow against the game's reads of 88 cells (measured, game 2.1.24)", () => {
    const { world, geometry } = reporting;
    const end = (n: number) => geometry.ends.find((e) => e.inserter === n);
    const pickup = (n: number) => geometry.pickups.find((p) => p.inserter === n);
    function portValue(row: Row): string {
        const n = Number(row.entity);
        const target = end(n)?.source?.entity_number;
        switch (row.field) {
            case "pickup_target": return nil(target);
            case "piece_shape": return nil(target === undefined ? null : world.piece(target)?.shape);
            case "line_length_1": case "line_length_2": return nil(target === undefined ? null : lineLengthOf(world, target, row.field === "line_length_1" ? 1 : 2));
            case "near_lane": return nil(pickup(n)?.near_lane.value);
            case "pickup_length": return nil(pickup(n)?.pickup_length.value);
            case "pickup_layout": return nil(pickup(n)?.pickup_layout.value);
            case "pickup_problem": return nil(pickup(n)?.problem.value);
            case "drop_line_index": return nil(geometry.drops.find((d) => d.inserter === n)?.line.value);
            case "lane_ends": {
                const line = target === undefined ? undefined : lineOf(geometry, target);
                const ends = line?.pickups.find((p) => p.piece === target)?.lane_ends.map((e) => e.value);
                return ends ? `[${ends.join(",")}]` : "nil";
            }
            case "flow_direction": return nil(target === undefined ? null : lineOf(geometry, target)?.flow_direction?.value);
            case "sender_lane_1_landing": case "sender_lane_2_landing": {
                const lane = row.field === "sender_lane_1_landing" ? 1 : 2;
                const load = world.piece(n)?.side_loads[0];
                return load === undefined ? "nil" : load.passing.includes(lane) ? String(load.lane) : "blocked";
            }
        }
        throw new Error(`no port value for ${row.field}`);
    }
    it("gives the expected value on all 278 rows that the reads give", () => {
        expect(reportingRows).toHaveLength(278);
        const differ: string[] = [];
        for (const row of reportingRows) {
            const port = portValue(row);
            const numeric = (row.field.startsWith("line_length") || row.field === "pickup_length") && row.expected !== "nil" && port !== "nil";
            const ok = numeric ? Number(row.expected) === Number(port) : row.expected === port;
            note("fixture-b.tsv", `game check ${row.row} ${row.field}`, `${row.cell} ${row.layout} ${row.subject} ${row.entity}`, port, row.expected, ok ? "agree" : "differ");
            if (!ok) differ.push(`${row.cell} ${row.layout} ${row.subject} ${row.entity} ${row.field}: expected ${row.expected}, port ${port}`);
        }
        expect(differ).toEqual([]);
    });
    it("marks every drop of the drop-lane cells game, and a loader into a voiding chest unread (its game read was not taken)", () => {
        const dropRows = reportingRows.filter((r) => r.field === "drop_line_index");
        expect(dropRows).toHaveLength(72);
        for (const r of dropRows) expect(geometry.drops.find((d) => d.inserter === Number(r.entity))!.line.basis, `${r.cell} ${r.layout}`).toBe("game");
        const r085 = reportingRows.find((r) => r.cell === "R085" && r.field === "lane_ends")!;
        expect(r085.read).toBe("sidecar");
        const target = end(Number(r085.entity))!.source!.entity_number;
        expect(lineOf(geometry, target)!.pickups.find((p) => p.piece === target)!.lane_ends.map((e) => e.basis)).toEqual(["unread", "unread"]);
    });
});

describe("drops, belt direction, lane ends and physical lines against the Sidecar reads of the sample builds (measured)", () => {
    /** The two drops whose blueprint walk runs past the export's selection to a side load (registered): build, inserter, tiles */
    const SELECTION = [["logistic-240", 67, 28], ["electromagnetic-240", 61, 7]];
    it("gives each drop's belt direction and side-load tiles as the read does, where the read has the field", () => {
        const registered: [string, number, number][] = [];
        for (const b of samples.builds) {
            const { geometry } = sampleBuilt.get(b.name)!;
            for (const ins of b.inserters) {
                if (ins.sink.type !== "belt") continue;
                const drop = geometry.drops.find((d) => d.inserter === ins.entity_number)!;
                expect(drop, `${b.name} inserter ${ins.entity_number}`).toBeDefined();
                const item = `inserter ${ins.entity_number}`;
                if (ins.sink.belt_direction !== undefined) {
                    note("fixture-b.tsv", `${b.name} belt_direction`, item, drop.belt_direction.value, ins.sink.belt_direction, verdictOf(drop.belt_direction.value, ins.sink.belt_direction));
                    expect(drop.belt_direction.value).toBe(ins.sink.belt_direction);
                } else {
                    expect(before(b.sidecar_version, "0.14.0"), `${b.name}: a read with no belt direction is older than the field`).toBe(true);
                    note("fixture-b.tsv", `${b.name} belt_direction`, item, drop.belt_direction.value, null, `not in the read (Sidecar ${b.sidecar_version})`);
                }
                const tiles = drop.side_load_tiles.value;
                if (ins.sink.drop_capture_tiles !== undefined) {
                    note("fixture-b.tsv", `${b.name} drop_capture.tiles`, item, tiles, ins.sink.drop_capture_tiles, verdictOf(tiles, ins.sink.drop_capture_tiles));
                    expect(tiles).toBe(ins.sink.drop_capture_tiles);
                } else if (before(b.sidecar_version, "0.13.0")) {
                    note("fixture-b.tsv", `${b.name} drop_capture.tiles`, item, tiles, null, `not in the read (Sidecar ${b.sidecar_version})`);
                } else if (tiles === null) {
                    note("fixture-b.tsv", `${b.name} drop_capture.tiles`, item, tiles, null, "agree (both none)");
                } else {
                    // the blueprint is walked whole; the export walked only the pieces it was given
                    note("fixture-b.tsv", `${b.name} drop_capture.tiles`, item, tiles, null, "registered: the export's selection stopped the walk");
                    registered.push([b.name, ins.entity_number, tiles]);
                }
            }
        }
        expect(registered).toEqual(SELECTION);
    });
    it("makes each read belt one physical line, and gives its lane ends where the read has them (hand values listed)", () => {
        let lines = 0;
        for (const b of samples.builds) {
            const { geometry } = sampleBuilt.get(b.name)!;
            for (const belt of b.belts) {
                const pieces = b.inserters.flatMap((ins) => {
                    const end = geometry.ends.find((e) => e.inserter === ins.entity_number)!;
                    return [ins.source.type === "belt" && ins.source.id === belt.id ? end.source?.entity_number : undefined,
                        ins.sink.type === "belt" && ins.sink.id === belt.id ? end.sink?.entity_number : undefined].filter((n): n is number => n !== undefined);
                });
                const physical = [...new Set(pieces.map((p) => lineOf(geometry, p)!.first))];
                note("fixture-b.tsv", `${b.name} physical lines`, `belt ${belt.id}`, physical.length, 1, verdictOf(physical.length, 1));
                expect(physical, `${b.name} belt ${belt.id}`).toHaveLength(1);
                const type = geometry.lines.find((l) => l.first === physical[0])!.belt_type.value;
                note("fixture-b.tsv", `${b.name} belt type`, `belt ${belt.id}`, type, belt.type, verdictOf(type, belt.type));
                expect(type, `${b.name} belt ${belt.id} type`).toBe(belt.type);
                lines += 1;
                const ends = joinedEnds(physical.map((first) => geometry.lines.find((l) => l.first === first)!));
                const laneLines = belt.lanes.length === 2 ? [1, 2] : [2];
                belt.lanes.forEach((kind, i) => {
                    const derived = ends ? ends[laneLines[i] - 1] : null;
                    const item = `belt ${belt.id} line ${laneLines[i]}`;
                    if (kind === null) note("fixture-b.tsv", `${b.name} lane_end`, item, derived, null, "not in the read");
                    else if (b.hand.includes("lane_end")) {
                        note("fixture-b.tsv", `${b.name} lane_end`, item, derived, kind, `hand value (${derived === kind ? "fits" : "differs"})`);
                        expect(derived, `${b.name} ${item}, a hand value`).toBe(kind);
                    } else {
                        note("fixture-b.tsv", `${b.name} lane_end`, item, derived, kind, verdictOf(derived, kind));
                        expect(derived, `${b.name} ${item}`).toBe(kind);
                    }
                });
            }
        }
        expect(lines).toBe(13);
    });
    it("gives each belt pickup's near lane, pickup length and layout as the read does (underground lengths: the 0.5 was fitted from these reads)", () => {
        let pickups = 0;
        for (const b of samples.builds) {
            const { geometry } = sampleBuilt.get(b.name)!;
            for (const ins of b.inserters) {
                if (ins.source.type !== "belt") continue;
                const p = geometry.pickups.find((it) => it.inserter === ins.entity_number)!;
                const got = { near_lane: p.near_lane.value, pickup_length: p.pickup_length.value, pickup_layout: p.pickup_layout.value };
                const want = { near_lane: ins.source.near_lane, pickup_length: ins.source.pickup_length, pickup_layout: ins.source.pickup_layout };
                for (const k of ["near_lane", "pickup_length", "pickup_layout"] as const) {
                    const fitted = k === "pickup_length" && want[k] === 0.5;
                    note("fixture-b.tsv", `${b.name} ${k}`, `inserter ${ins.entity_number}`, got[k], want[k], got[k] === want[k] ? (fitted ? "agree (fitted from the reads)" : "agree") : "differ");
                }
                expect(got, `${b.name} inserter ${ins.entity_number}`).toEqual(want);
                pickups += 1;
            }
        }
        expect(pickups).toBe(7);
    });
});

describe("the lane ends and inserter ends of the utility science 320 sample, whose config was read by Sidecar 0.16.0 (measured read)", () => {
    const [b] = samples.lane_end_builds;
    const { geometry } = built(path.join(SAMPLES, b.scaffold));
    it("gives every inserter's source and sink type as its config does", () => {
        for (const ins of b.inserters) {
            const end = geometry.ends.find((e) => e.inserter === ins.entity_number)!;
            expect({ source: end.source?.target, sink: end.sink?.target }, `inserter ${ins.entity_number}`).toEqual({ source: ins.source.type, sink: ins.sink.type });
        }
        expect(b.inserters).toHaveLength(21);
    });
    it("gives the lane ends the config states: dead ends on belts 1, 2 and 5", () => {
        let lanes = 0;
        for (const belt of b.belts) {
            if (belt.lanes.every((kind) => kind === null)) continue;
            const pieces = b.inserters.flatMap((ins) => {
                const end = geometry.ends.find((e) => e.inserter === ins.entity_number)!;
                return ins.source.type === "belt" && ins.source.id === belt.id && end.source ? [end.source.entity_number] : [];
            });
            const belts = [...new Set(pieces.map((p) => lineOf(geometry, p)!))];
            for (const l of belts) expect(l.belt_type.value, `belt ${belt.id} type`).toBe(belt.type);
            const ends = joinedEnds(belts);
            belt.lanes.forEach((kind, i) => {
                note("fixture-b.tsv", "utility-320 lane_end", `belt ${belt.id} line ${i + 1}`, ends?.[i] ?? null, kind, verdictOf(ends?.[i] ?? null, kind));
                expect(ends?.[i], `belt ${belt.id} line ${i + 1}`).toBe(kind);
                lanes += 1;
            });
        }
        expect(lanes).toBe(6);
    });
});

describe("the lane ends and flow of the Sidecar's own lane-end game test, written as blueprint entities (measured)", () => {
    type Case = { ends: [string, string] | null; flow: number | null; make: (s: Sketch) => number };
    const CASES: Record<string, Case> = {
        "dead-end": { ends: ["dead_end", "dead_end"], flow: E, make: (s) => { const a = s.line(0, 0, E, 5); s.picker(a[1], 0, 1); return a[0]; } },
        "runs-on-into-a-loader-that-takes-everything": { ends: ["infinite", "infinite"], flow: E, make: (s) => {
            const a = s.line(0, 0, E, 4); s.put("turbo-loader", 5, 0.5, E, { type: "input" }); s.put("infinity-chest", 6.5, 0.5, N, { remove_unfiltered: true }); s.picker(a[1], 0, 1); return a[0]; } },
        "runs-on-into-a-loader-that-fills-a-chest": { ends: ["unknown", "unknown"], flow: E, make: (s) => {
            const a = s.line(0, 0, E, 4); s.put("turbo-loader", 5, 0.5, E, { type: "input" }); s.put("steel-chest", 6.5, 0.5); s.picker(a[1], 0, 1); return a[0]; } },
        "entrance-without-exit": { ends: ["dead_end", "dead_end"], flow: E, make: (s) => { const a = s.line(0, 0, E, 3); s.put("turbo-underground-belt", 3.5, 0.5, E, { type: "input" }); s.picker(a[1], 0, 1); return a[0]; } },
        "side-load-into-an-entrance-from-the-north": { ends: ["dead_end", "unknown"], flow: S, make: (s) => {
            const a = s.line(0, -4, S, 4); s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "input" }); s.put("turbo-underground-belt", 3.5, 0.5, E, { type: "output" }); s.line(4, 0, E, 3); s.picker(a[0], 1, 0); return a[0]; } },
        "side-load-into-an-entrance-from-the-south": { ends: ["unknown", "dead_end"], flow: N, make: (s) => {
            const a = s.line(0, 4, N, 4); s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "input" }); s.put("turbo-underground-belt", 3.5, 0.5, E, { type: "output" }); s.line(4, 0, E, 3); s.picker(a[0], 1, 0); return a[0]; } },
        "side-load-into-an-exit-from-the-north": { ends: ["unknown", "dead_end"], flow: S, make: (s) => {
            const a = s.line(0, -4, S, 4); s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "output" }); s.line(1, 0, E, 3); s.picker(a[0], 1, 0); return a[0]; } },
        "side-load-into-an-exit-from-the-south": { ends: ["dead_end", "unknown"], flow: N, make: (s) => {
            const a = s.line(0, 4, N, 4); s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "output" }); s.line(1, 0, E, 3); s.picker(a[0], 1, 0); return a[0]; } },
        "side-load-into-an-exit-fed-through-its-tunnel": { ends: ["unknown", "dead_end"], flow: S, make: (s) => {
            const a = s.line(0, -4, S, 4); s.line(-5, 0, E, 1); s.put("turbo-underground-belt", -3.5, 0.5, E, { type: "input" }); s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "output" }); s.line(1, 0, E, 3); s.picker(a[0], 1, 0); return a[0]; } },
        "into-a-splitter": { ends: ["unknown", "unknown"], flow: E, make: (s) => { const a = s.line(0, 0, E, 3); s.put("turbo-splitter", 3.5, 1, E); s.line(4, 0, E, 2); s.picker(a[0], 0, 1); return a[0]; } },
        "merge-onto-the-line-past-the-pickup": { ends: ["unknown", "unknown"], flow: E, make: (s) => { const a = s.line(0, 0, E, 6); s.line(3, 1, N, 1); s.picker(a[0], 0, -1); return a[0]; } },
        "pickups-either-side-of-a-curve": { ends: ["dead_end", "dead_end"], flow: null, make: (s) => { const a = s.line(0, 0, E, 3); const b = s.line(3, 0, S, 3); s.picker(a[0], 0, -1); s.picker(b[1], 1, 0); return a[0]; } },
        "export-belt-dropped-onto": { ends: null, flow: null, make: (s) => {
            const a = s.line(0, 0, E, 4); s.put("stack-inserter", 1.5, 1.5, S); s.put("infinity-chest", 1.5, 2.5, N, { remove_unfiltered: false }); return a[0]; } },
    };
    it("has the 13 cases that a blueprint can hold (a line that runs past the selection has no blueprint form)", () => {
        expect(Object.keys(CASES)).toHaveLength(13);
        note("fixture-b.tsv", "lane-end game test", "runs-past-the-selection ends", null, ["unknown", "unknown"], "registered: no blueprint form (the selection is the blueprint; such a lane reads dead_end with basis default)");
    });
    for (const [name, c] of Object.entries(CASES)) {
        it(name, () => {
            const s = new Sketch();
            const first = c.make(s);
            const { geometry } = s.build();
            const line = lineOf(geometry, first)!;
            const ends = joinedEnds([line]);
            const flow = line.flow_direction?.value ?? null;
            note("fixture-b.tsv", "lane-end game test", `${name} ends`, ends, c.ends, verdictOf(ends, c.ends));
            note("fixture-c.tsv", "lane-end game test", `${name} flow_direction`, flow, c.flow, verdictOf(flow, c.flow));
            expect({ ends, flow }).toEqual({ ends: c.ends, flow: c.flow });
            // a lane that stops at the blueprint's edge is a dead end the blueprint cannot see past
            if (["dead-end", "entrance-without-exit", "pickups-either-side-of-a-curve"].includes(name)) {
                for (const p of line.pickups) expect(p.lane_ends.map((e) => e.basis)).toEqual(["default", "default"]);
            }
        });
    }
});

describe("the physical lines at a splitter and an underground pair", () => {
    it("gives two belts into one splitter and a belt out of each output 5 lines: each belt, and the splitter alone", () => {
        const s = new Sketch();
        const upper = s.line(0, 0, E, 3);
        const lower = s.line(0, 1, E, 3);
        const splitter = s.put("turbo-splitter", 3.5, 1, E);
        const outUpper = s.line(4, 0, E, 2);
        const outLower = s.line(4, 1, E, 2);
        const { world, geometry } = s.build();
        // the world joins them: the splitter takes from both belts and gives to both
        expect([...world.piece(splitter)!.inputs].sort((a, b) => a - b)).toEqual([upper[2], lower[2]]);
        expect([...world.piece(splitter)!.outputs].sort((a, b) => a - b)).toEqual([outUpper[0], outLower[0]]);
        expect(geometry.lines.map((l) => l.pieces)).toEqual([upper, lower, [splitter], outUpper, outLower]);
    });

    it("keeps an underground pair and the belts on either side one line", () => {
        const s = new Sketch();
        const before = s.line(0, 0, E, 2);
        const entrance = s.put("turbo-underground-belt", 2.5, 0.5, E, { type: "input" });
        const exit = s.put("turbo-underground-belt", 6.5, 0.5, E, { type: "output" });
        const after = s.line(7, 0, E, 2);
        const { geometry } = s.build();
        expect(geometry.lines.map((l) => l.pieces)).toEqual([[...before, entrance, exit, ...after]]);
    });
});

describe("a drop onto a splitter's near half, 77/256 tile off its centre line, in four facings (measured, game 2.1.24)", () => {
    for (let quarters = 0; quarters < 4; quarters += 1) {
        it(`facing ${4 * quarters}: line 2 from the left side, line 3 from the right side`, () => {
            // the splitter faces north at (0, 0.5) over tiles x -1 and 0; the arms stand beside it and face away from it
            const specs: Spec[] = [
                { name: "turbo-splitter", x: 0, y: 0.5, direction: N },
                { name: "stack-inserter", x: -1.5, y: 0.5, direction: W },
                { name: "stack-inserter", x: 1.5, y: 0.5, direction: E },
            ];
            const { geometry } = buildOf(blueprintOf(turnedSpecs(specs, quarters)));
            const line = (n: number) => geometry.drops.find((d) => d.inserter === n)?.line;
            const drop = geometry.ends.find((e) => e.inserter === 2)!.drop;
            const centre = turnedSpecs(specs, quarters)[0];
            expect(Math.abs(drop.x - centre.x) + Math.abs(drop.y - centre.y)).toBe(77 / 256);
            note("fixture-b.tsv", "splitter drop", `facing ${4 * quarters} left side`, line(2)?.value, 2, verdictOf(line(2)?.value, 2));
            note("fixture-b.tsv", "splitter drop", `facing ${4 * quarters} right side`, line(3)?.value, 3, verdictOf(line(3)?.value, 3));
            expect([line(2), line(3)]).toEqual([{ value: 2, basis: "game" }, { value: 3, basis: "game" }]);
        });
    }
});

describe("the basis of a drop's line on a curve, an underground end and a splitter: game only on the cases the game check read (derived from those cells)", () => {
    type DropCase = { name: string; basis: Basis; make: (s: Sketch) => number };
    const arm = (s: Sketch, x: number, y: number, direction: number, mirror = false) => s.put("stack-inserter", x, y, direction, { mirror });
    /** A right curve facing south on tile (1, 0), fed from the west by a belt on tile (0, 0) */
    const curve = (s: Sketch) => { s.line(0, 0, E, 1); s.line(1, 0, S, 1); };
    const CASES: DropCase[] = [
        { name: "a curve from behind, unmirrored", basis: "game", make: (s) => { curve(s); return arm(s, 1.5, -0.5, N); } },
        { name: "a curve from the side away from its feeder, unmirrored", basis: "game", make: (s) => { curve(s); return arm(s, 2.5, 0.5, E); } },
        { name: "a curve from behind, mirrored", basis: "unread", make: (s) => { curve(s); return arm(s, 1.5, -0.5, N, true); } },
        { name: "a curve from the tile its output points to", basis: "unread", make: (s) => { curve(s); return arm(s, 1.5, 1.5, S); } },
        { name: "an entrance from its side, unmirrored", basis: "game", make: (s) => { s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "input" }); return arm(s, 0.5, -0.5, N); } },
        { name: "an entrance from its side, mirrored", basis: "unread", make: (s) => { s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "input" }); return arm(s, 0.5, -0.5, N, true); } },
        { name: "an entrance in line from behind, mirrored", basis: "game", make: (s) => { s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "input" }); return arm(s, -0.5, 0.5, W, true); } },
        { name: "an entrance in line over its hood", basis: "unread", make: (s) => { s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "input" }); return arm(s, 1.5, 0.5, E); } },
        { name: "an exit in line from in front", basis: "game", make: (s) => { s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "output" }); return arm(s, 1.5, 0.5, E); } },
        { name: "an exit in line over its hood", basis: "unread", make: (s) => { s.put("turbo-underground-belt", 0.5, 0.5, E, { type: "output" }); return arm(s, -0.5, 0.5, W); } },
        { name: "a splitter from its outer side, unmirrored", basis: "game", make: (s) => { s.put("turbo-splitter", 0, 0.5, N); return arm(s, -1.5, 0.5, W); } },
        { name: "a splitter from its outer side, mirrored", basis: "unread", make: (s) => { s.put("turbo-splitter", 0, 0.5, N); return arm(s, -1.5, 0.5, W, true); } },
    ];
    for (const c of CASES) {
        it(`${c.name}: ${c.basis}`, () => {
            const s = new Sketch();
            const inserter = c.make(s);
            const { geometry } = s.build();
            const drop = geometry.drops.find((d) => d.inserter === inserter);
            expect(drop, "a drop onto the piece").toBeDefined();
            expect(drop!.line.value, "a line").not.toBeNull();
            note("fixture-b.tsv", "drop line basis", c.name, drop!.line.basis, c.basis, verdictOf(drop!.line.basis, c.basis));
            expect(drop!.line.basis).toBe(c.basis);
        });
    }
});

// ---------------------------------------------------------------- fixture (c): copies, flow direction and sharing

/** Joined lines by items give one belt: one way that every line gives, else none (the export's belt rule over physical lines) */
function joinedFlow(lines: readonly BuildGeometry["lines"][number][]): number | "none" {
    const ways = [...new Set(lines.filter((l) => l.flow_direction !== null).map((l) => l.flow_direction!.value))];
    return ways.length === 1 && ways[0] !== null ? ways[0] : "none";
}

describe("the copy spacing and flow of the Sidecar's copy-spacing game test, written as blueprint entities (measured)", () => {
    type Case = { copy_offset: Point | null; flows: (number | "none")[]; make: (s: Sketch) => void };
    /** A run going `way` that dips into a stub at each offset of `at`: a taker on the stub's straight piece fills an assembler */
    function stubs(s: Sketch, x: number, y: number, way: number, at: number[], length: number) {
        const sx = way === E ? 1 : -1;
        for (let i = 0; i < length;) {
            if (at.includes(i)) {
                s.line(x + sx * i, y, S, 1);
                const [pickup] = s.line(x + sx * i, y + 1, S, 1);
                s.line(x + sx * i, y + 2, way, 1);
                s.line(x + sx * (i + 1), y + 2, N, 1);
                s.line(x + sx * (i + 1), y + 1, N, 1);
                s.line(x + sx * (i + 1), y, way, 1);
                const p = s.at(pickup);
                s.put("assembling-machine-3", p.x - 3 * sx, p.y + 1, N, { recipe: "iron-gear-wheel" });
                s.taker(pickup, -sx, 0);
                i += 2;
            } else {
                s.line(x + sx * i, y, way, 1);
                i += 1;
            }
        }
    }
    const CASES: Record<string, Case> = {
        "two-copies-4-apart": { copy_offset: { x: 4, y: 0 }, flows: [E], make: (s) => { const a = s.line(0, 0, E, 10); s.copy(a[1], 0, 1); s.copy(a[5], 0, 1); } },
        "three-copies-6-apart": { copy_offset: { x: 6, y: 0 }, flows: [E], make: (s) => { const a = s.line(0, 0, E, 16); for (const k of [1, 7, 13]) s.copy(a[k], 0, 1); } },
        "three-copies-of-two-inserters-7-apart": { copy_offset: { x: 7, y: 0 }, flows: [E], make: (s) => {
            const a = s.line(0, 0, E, 20);
            for (let k = 0; k < 3; k += 1) { const p = s.at(a[1 + 7 * k]); s.put("assembling-machine-3", p.x, p.y + 3, N, { recipe: "iron-gear-wheel" }); s.taker(a[1 + 7 * k], 0, 1); s.taker(a[2 + 7 * k], 0, 1); }
        } },
        "two-copies-5-apart-on-a-belt-running-south": { copy_offset: { x: 0, y: 5 }, flows: [S], make: (s) => { const a = s.line(0, 0, S, 10); s.copy(a[1], 1, 0); s.copy(a[6], 1, 0); } },
        "two-copies-4-apart-on-a-belt-running-west": { copy_offset: { x: -4, y: 0 }, flows: [W], make: (s) => { const a = s.line(10, 0, W, 10); s.copy(a[1], 0, 1); s.copy(a[5], 0, 1); } },
        "three-copies-unevenly-apart": { copy_offset: null, flows: [E], make: (s) => { const a = s.line(0, 0, E, 14); for (const k of [1, 5, 10]) s.copy(a[k], 0, 1); } },
        "two-copies-mirrored": { copy_offset: null, flows: [E], make: (s) => { const a = s.line(0, 0, E, 10); s.copy(a[1], 0, 1); s.copy(a[5], 0, -1); } },
        "one-copy": { copy_offset: null, flows: [E], make: (s) => { const a = s.line(0, 0, E, 6); s.copy(a[1], 0, 1); } },
        "two-copies-and-a-part-copy": { copy_offset: null, flows: [E], make: (s) => {
            const a = s.line(0, 0, E, 20);
            for (let k = 0; k < 3; k += 1) { const p = s.at(a[1 + 7 * k]); s.put("assembling-machine-3", p.x, p.y + 3, N, { recipe: "iron-gear-wheel" }); s.taker(a[1 + 7 * k], 0, 1); if (k < 2) s.taker(a[2 + 7 * k], 0, 1); }
        } },
        // the export states no spacing without a machine (no suggested target); the geometry still finds it
        "two-copies-into-chests": { copy_offset: { x: 4, y: 0 }, flows: [E], make: (s) => {
            const a = s.line(0, 0, E, 10); for (const k of [1, 5]) { const p = s.at(a[k]); s.put("wooden-chest", p.x, p.y + 2); s.taker(a[k], 0, 1); } } },
        "two-copies-4-apart-on-two-belts": { copy_offset: { x: 4, y: 0 }, flows: [E], make: (s) => {
            const a = s.line(0, 0, E, 10), b = s.line(0, 6, E, 10); s.copy(a[1], 0, 1); s.copy(a[5], 0, 1); s.taker(b[1], 0, -1); s.taker(b[5], 0, -1); } },
        "two-belts-whose-spacings-differ": { copy_offset: null, flows: [E], make: (s) => {
            const a = s.line(0, 0, E, 10), b = s.line(0, 8, E, 10); s.copy(a[1], 0, 1); s.copy(a[5], 0, 1);
            for (const k of [1, 7]) { const p = s.at(b[k]); s.put("wooden-chest", p.x, p.y - 2); s.taker(b[k], 0, -1); } } },
        "two-copies-on-belts-running-opposite-ways": { copy_offset: null, flows: ["none"], make: (s) => {
            const a = s.line(0, 0, E, 10), b = s.line(9, 6, W, 10); s.copy(a[1], 0, 1); s.copy(a[5], 0, 1); s.taker(b[8], 0, -1); s.taker(b[4], 0, -1); } },
        "two-assemblers-alike-and-an-inserter-unlike-on-a-second-belt": { copy_offset: null, flows: [E], make: (s) => {
            const a = s.line(0, 0, E, 10), b = s.line(0, 6, E, 10); s.copy(a[1], 0, 1); s.copy(a[5], 0, 1); s.taker(b[1], 0, -1); } },
        "three-copies-on-stubs-across-a-run-going-east": { copy_offset: { x: 6, y: 0 }, flows: [E], make: (s) => stubs(s, 4, 0, E, [4, 10, 16], 20) },
        "three-copies-on-stubs-across-a-run-going-west": { copy_offset: { x: -6, y: 0 }, flows: [W], make: (s) => stubs(s, 30, 0, W, [4, 10, 16], 20) },
        "three-copies-unevenly-apart-on-stubs": { copy_offset: null, flows: ["none"], make: (s) => stubs(s, 4, 0, E, [4, 10, 17], 21) },
        "one-copy-on-a-line-that-turns": { copy_offset: null, flows: ["none"], make: (s) => { const a = s.line(0, 0, E, 4); s.line(4, 0, N, 3); s.copy(a[1], 0, 1); } },
    };
    /** The inserters of each case, as the game test counts them */
    const INSERTERS: Record<string, number> = {
        "two-copies-4-apart": 2,
        "three-copies-6-apart": 3,
        "three-copies-of-two-inserters-7-apart": 6,
        "two-copies-5-apart-on-a-belt-running-south": 2,
        "two-copies-4-apart-on-a-belt-running-west": 2,
        "three-copies-unevenly-apart": 3,
        "two-copies-mirrored": 2,
        "one-copy": 1,
        "two-copies-and-a-part-copy": 5,
        "two-copies-into-chests": 2,
        "two-copies-4-apart-on-two-belts": 4,
        "two-belts-whose-spacings-differ": 4,
        "two-copies-on-belts-running-opposite-ways": 4,
        "two-assemblers-alike-and-an-inserter-unlike-on-a-second-belt": 3,
        "three-copies-on-stubs-across-a-run-going-east": 3,
        "three-copies-on-stubs-across-a-run-going-west": 3,
        "three-copies-unevenly-apart-on-stubs": 3,
        "one-copy-on-a-line-that-turns": 1,
    };
    it("has the 18 cases of the game test", () => expect(Object.keys(CASES).sort()).toEqual(Object.keys(INSERTERS).sort()));
    for (const [name, c] of Object.entries(CASES)) {
        it(name, () => {
            const s = new Sketch();
            c.make(s);
            const { geometry } = s.build();
            expect(geometry.ends.length, "inserters").toBe(INSERTERS[name]);
            const flows = [joinedFlow(geometry.lines)];
            note("fixture-c.tsv", "copy-spacing game test", `${name} copy_offset`, geometry.copy_offset.value, c.copy_offset, verdictOf(geometry.copy_offset.value, c.copy_offset));
            note("fixture-c.tsv", "copy-spacing game test", `${name} flow_direction`, flows, c.flows, verdictOf(flows, c.flows));
            expect({ copy_offset: geometry.copy_offset.value, flows }).toEqual({ copy_offset: c.copy_offset, flows: c.flows });
            expect(geometry.copy_offset.basis).toBe(c.copy_offset === null ? "default" : "unread");
        });
    }
});

/** The samples whose blueprint shows copies at a spacing the rule cannot find, with the cause */
const SPACING_DIFFERS: Record<string, string> = {
    "grenade-240 full build": "no inserter takes from a belt, and the spacing is found only on the lines that takers share",
};

/**
 * The hand values of `sharing` the port does not give, with their causes. An unstated value reads shared; where each
 * copy drops onto a stub of its own that joins the others further on, the copies do not share the lane at their arms.
 */
const SHARING_DIFFERS: Record<string, string> = {
    "military-240 belt 1 lane 2": "unstated in the config; each copy drops onto a run of its own that merges into the others past the arms",
    "military-240 belt 2 lane 1": "unstated in the config; each copy drops onto a run of its own that merges into the others past the arms",
};

/** The physical line of each config belt, through the inserters of the config's first copy */
function linesOfBelts(g: BuildGeometry, inserters: CopiesBuild["inserters"]): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (const ins of inserters) {
        const end = g.ends.find((e) => e.inserter === ins.entity_number)!;
        for (const [side, at] of [[ins.source, end.source], [ins.sink, end.sink]] as const) {
            if (side.type !== "belt" || side.id === undefined || !at) continue;
            const first = lineOf(g, at.entity_number)!.first;
            out.set(side.id, [...new Set([...(out.get(side.id) ?? []), first])]);
        }
    }
    return out;
}

describe("copies, flow and sharing of sample builds", () => {
    for (const c of samples.copies) {
        const { geometry, entities } = built(path.join(SAMPLES, c.blueprint));
        const why = SPACING_DIFFERS[c.name];
        const noSpacing = why !== undefined;
        it(noSpacing
            ? `${c.name}: no copy spacing (${why}); the config's is a hand value`
            : `${c.name}: the copy spacing the blueprint shows is the config's (hand value)`, () => {
            const want = noSpacing ? null : c.copy_offset;
            note("fixture-c.tsv", `${c.name} copy_offset`, "setpoint", geometry.copy_offset.value, c.copy_offset,
                noSpacing ? `hand value (differs: ${why})` : verdictOf(geometry.copy_offset.value, c.copy_offset));
            expect(geometry.copy_offset.value).toEqual(want);
        });
        it(`${c.name}: every lane's sharing against the config's hand values (an unstated one reads shared)`, () => {
            const byBelt = linesOfBelts(geometry, c.inserters);
            const differ: string[] = [];
            for (const belt of c.belts) {
                const firsts = byBelt.get(belt.id) ?? [];
                expect(firsts, `${c.name} belt ${belt.id}`).toHaveLength(1);
                const line = geometry.lines.find((l) => l.first === firsts[0])!;
                // a belt of one lane in the config: the line its first copy's arm drops onto
                const dropper = c.inserters.find((ins) => ins.sink.type === "belt" && ins.sink.id === belt.id);
                const dropLine = dropper ? geometry.drops.find((d) => d.inserter === dropper.entity_number)?.line.value ?? null : null;
                belt.sharing.forEach((hand, i) => {
                    const lane = belt.sharing.length === 2 ? i : dropLine === null ? 0 : (dropLine - 1) % 2;
                    const derived = line.sharing[lane].value;
                    const want = hand ?? "shared";
                    const cause = SHARING_DIFFERS[`${c.name} belt ${belt.id} lane ${lane + 1}`];
                    const verdict = line.sharing[lane].basis === "default"
                        ? `default, no spacing found (${derived === want ? "the same value" : `differs: ${cause}`})`
                        : derived === want ? "hand value (fits)" : `hand value (differs: ${cause})`;
                    note("fixture-c.tsv", `${c.name} sharing`, `belt ${belt.id} lane ${lane + 1}`, derived, want, verdict);
                    if (derived !== want) differ.push(`belt ${belt.id} lane ${lane + 1}`);
                });
                if (belt.flow_direction !== null && belt.flow_direction !== undefined) {
                    const derived = line.flow_direction?.value ?? null;
                    note("fixture-c.tsv", `${c.name} flow_direction`, `belt ${belt.id}`, derived, belt.flow_direction, `hand value (${derived === belt.flow_direction ? "fits" : "differs"})`);
                    expect(derived, `${c.name} belt ${belt.id}`).toBe(belt.flow_direction);
                }
            }
            expect(differ.map((d) => `${c.name} ${d}`).sort()).toEqual(Object.keys(SHARING_DIFFERS).filter((k) => k.startsWith(`${c.name} `)).sort());
        });
        if (!noSpacing) it(`${c.name}: on every drop line a lane is shared exactly where the copy step has no part across the line and not every lane of the belt is per copy; a line no copy touches is shared by default`, () => {
            const offset = geometry.copy_offset.value!;
            // an arm with no arm of its kind one copy step before or after it is of no copy
            const arms = new Set(entities.map((e) => `${e.name}|${e.direction}|${e.mirror}|${e.position.x}|${e.position.y}`));
            const ofNoCopy = (n: number) => {
                const e = entities.find((x) => x.entity_number === n)!;
                return [-1, 1].every((k) => !arms.has(`${e.name}|${e.direction}|${e.mirror}|${e.position.x + k * offset.x}|${e.position.y + k * offset.y}`));
            };
            let drops = 0;
            for (const d of geometry.drops) {
                const facing = sampleDirection(c, d.inserter);
                const axis = facing === 0 || facing === 8 ? "x" : "y";
                const across = axis === "x" ? offset.y : offset.x;
                const line = lineOf(geometry, d.piece)!;
                if ([...geometry.drops, ...geometry.pickups].filter((x) => line.pieces.includes(x.piece)).every((x) => ofNoCopy(x.inserter))) {
                    expect(line.sharing, `inserter ${d.inserter}`).toEqual([{ value: "shared", basis: "default" }, { value: "shared", basis: "default" }]);
                    drops += 1;
                    continue;
                }
                const perCopy = line.sharing.every((s) => s.value === "per_copy");
                const shared = Math.abs(across) < 1e-9 && !perCopy;
                const lane = d.line.value === null ? null : ((d.line.value - 1) % 2);
                expect(lane === null ? null : line.sharing[lane].value === "shared", `inserter ${d.inserter}`).toBe(lane === null ? null : shared);
                drops += 1;
            }
            expect(drops).toBeGreaterThan(0);
        });
    }

    it("productivity module 80 shows one copy: every lane is shared with basis default, where the ruled coal lane is per copy (from the lane-sharing answer)", () => {
        const { geometry } = sampleBuilt.get("productivity-module-80")!;
        expect(geometry.copy_offset).toEqual({ value: null, basis: "default" });
        for (const line of geometry.lines) expect(line.sharing).toEqual([{ value: "shared", basis: "default" }, { value: "shared", basis: "default" }]);
        const b = samples.builds.find((it) => it.name === "productivity-module-80")!;
        for (const belt of b.belts) belt.sharing.forEach((hand, i) => {
            if (hand !== null) note("fixture-c.tsv", "productivity-module-80 sharing", `belt ${belt.id} lane ${i + 1}`, "shared", hand, `hand value (${hand === "shared" ? "fits" : "differs: one copy shown, the value is the lane-sharing answer's"})`);
        });
    });

    it("two copies stacked along a shared input belt, each dropping onto a belt of its own: the input lanes shared, the output lanes per copy (unread)", () => {
        const s = new Sketch();
        const input = s.line(0, 0, S, 14);
        for (const k of [2, 8]) {
            // a taker beside the input belt into an assembler, and an arm from the assembler onto an output belt running east
            const p = s.at(input[k]);
            s.put("assembling-machine-3", p.x + 3, p.y, N, { recipe: "iron-gear-wheel" });
            s.taker(input[k], 1, 0);
            s.put("stack-inserter", p.x + 3, p.y + 2, N);
            s.line(2, k + 3, E, 4);
        }
        const { geometry } = s.build();
        expect(geometry.copy_offset.value).toEqual({ x: 0, y: 6 });
        const inputLine = lineOf(geometry, input[0])!;
        expect(inputLine.sharing.map((x) => x.value)).toEqual(["shared", "shared"]);
        const outputs = geometry.drops.map((d) => lineOf(geometry, d.piece)!);
        expect(outputs).toHaveLength(2);
        // the lane each arm drops onto is per copy; the other lane no arm touches, so the blueprint does not show it
        const dropped = geometry.drops.map((d) => ((d.line.value! - 1) % 2));
        outputs.forEach((line, i) => {
            expect(line.sharing[dropped[i]]).toEqual({ value: "per_copy", basis: "unread" });
            expect(line.sharing[1 - dropped[i]]).toEqual({ value: "shared", basis: "default" });
        });
        for (const x of inputLine.sharing) expect(x.basis).toBe("unread");
        note("fixture-c.tsv", "sharing table", "copies found: the input line", inputLine.sharing.map((x) => x.value), ["shared", "shared"], "agree");
        note("fixture-c.tsv", "sharing table", "copies found: each output line's dropped lane", outputs.map((l, i) => l.sharing[dropped[i]].value), ["per_copy", "per_copy"], "agree");
        note("fixture-c.tsv", "sharing table", "copies found: a lane no arm touches", outputs.map((l, i) => l.sharing[1 - dropped[i]]), outputs.map(() => ({ value: "shared", basis: "default" })), "agree");
    });

    it("a config with every lane's sharing written and copies 1 passes the config schema", () => {
        const config = JSON.parse(read(path.join(SAMPLES, "science", "military", "military-240.json"))) as { setpoint: { copies: number }; belts: { lanes: { sharing?: string }[] }[] };
        config.setpoint.copies = 1;
        config.belts.forEach((belt, i) => belt.lanes.forEach((lane) => (lane.sharing = i % 2 === 0 ? "shared" : "per_copy")));
        const parsed = ConfigSchema.safeParse(config);
        expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    });
});

/** The direction of an inserter of a copies build, from its blueprint */
const copiesEntities = new Map(samples.copies.map((c) => [c.name, decoded(read(path.join(SAMPLES, c.blueprint)).trim())]));
function sampleDirection(c: CopiesBuild, inserter: number): number {
    return copiesEntities.get(c.name)!.find((e) => e.entity_number === inserter)!.direction;
}

describe("flow direction against the hand values of the samples, and the Sidecar's sample-flow game test (measured)", () => {
    it("fits each of the 6 hand values of flow direction (the export's rule over the takers' ways, with the copy spacing's way first)", () => {
        let values = 0;
        for (const b of samples.builds) {
            const { geometry } = sampleBuilt.get(b.name)!;
            for (const belt of b.belts) {
                if (belt.flow_direction === undefined || !b.hand.includes("flow_direction")) continue;
                const pieces = b.inserters.flatMap((ins) => {
                    const end = geometry.ends.find((e) => e.inserter === ins.entity_number)!;
                    return ins.source.type === "belt" && ins.source.id === belt.id && end.source ? [end.source.entity_number] : [];
                });
                const lines = [...new Set(pieces.map((p) => lineOf(geometry, p)!))];
                const derived = joinedFlow(lines);
                note("fixture-c.tsv", `${b.name} flow_direction`, `belt ${belt.id}`, derived, belt.flow_direction, `hand value (${derived === belt.flow_direction ? "fits" : "differs"})`);
                expect(derived, `${b.name} belt ${belt.id}`).toBe(belt.flow_direction);
                values += 1;
            }
        }
        expect(values).toBe(6);
    });
    for (const [name, file] of [["advanced circuit, coal", ["intermediates", "advanced-circuit", "advanced-circuit.scaffold"]],
        ["inserter crafting, one copy, circuits", ["intermediates", "inserter-crafting", "inserter-crafting-240-shared-signal-clock.scaffold"]]] as const) {
        it(`${name}: a belt of one copy that turns past its south-facing pickup has no flow`, () => {
            const { geometry, world } = built(path.join(SAMPLES, ...file));
            expect(geometry.copy_offset.value).toBeNull();
            const turning = geometry.lines.filter((l) => l.pickups.some((p) => p.pickup_way.value === false && world.piece(p.piece)!.direction === S));
            expect(turning.length).toBeGreaterThan(0);
            for (const line of turning) {
                note("fixture-c.tsv", "sample-flow game test", `${name} line ${line.first}`, line.flow_direction?.value ?? null, null, verdictOf(line.flow_direction?.value ?? null, null));
                expect(line.flow_direction?.value ?? null).toBeNull();
            }
        });
    }
    it("the game check's two flow cells give the way the plates passed the pickups", () => {
        const rows = reportingRows.filter((r) => r.field === "flow_direction");
        expect(rows).toHaveLength(2);
        for (const r of rows) {
            const target = reporting.geometry.ends.find((e) => e.inserter === Number(r.entity))!.source!.entity_number;
            const flow = lineOf(reporting.geometry, target)!.flow_direction!;
            note("fixture-c.tsv", "game check flow-direction", `${r.cell} ${r.layout}`, flow.value, Number(r.expected), verdictOf(flow.value, Number(r.expected)));
            expect(flow).toEqual({ value: Number(r.expected), basis: "game" });
        }
    });
});

// ---------------------------------------------------------------- the basis of every value

/**
 * The bases each output field may carry, and why. `vehicles` carries none: its box is computed from the data and the
 * blueprint alone. The table is the witness `basis.tsv` of the piece.
 */
const BASIS: Record<string, { bases: Basis[]; rule: string; witness: string }> = {
    "ends": { bases: ["game", "unread"], rule: "game: the entity on the point's tile, or a vehicle at a quarter turn; unread: a vehicle at another orientation", witness: "inserter ends against the Sidecar reads of seven sample builds; the car turned by 0.125 (vehicles)" },
    "pickups.near_lane, pickup_length, pickup_layout, problem": { bases: ["game", "unread"], rule: "game: a layout of the seven, a bend, a splitter or in line (the game check's cases); unread: a pickup the Lua calls unsupported", witness: "the pickup rules against the game's reads of 218 cells" },
    "pickups.supply_problem": { bases: ["game", "unread"], rule: "game: read for a pickup with no problem; else the pickup's basis", witness: "the pickup rules against the game's reads of 218 cells (supply_problem rows)" },
    "drops.line": { bases: ["game", "unread"], rule: "game: a straight belt, or a curve, underground end or splitter drop whose case the game check read; unread: another case", witness: "drop lanes against the game's reads of 88 cells; the basis of a drop's line (12 cases); the splitter drop in four facings" },
    "drops.belt_direction": { bases: ["game"], rule: "game: the piece's direction", witness: "drops against the Sidecar reads of the sample builds (belt_direction)" },
    "drops.side_load_tiles": { bases: ["game", "unread"], rule: "game: no side load, or one the world puts no mark on; unread: a side load the world marks", witness: "the pickup rules' side-loaded tile row; drops against the Sidecar reads (drop_capture.tiles)" },
    "lines.belt_type": { bases: ["game"], rule: "game: the line's belt name", witness: "the belt type of 13 read belts of the samples and the utility sample's express and turbo belts" },
    "lines.pickups.lane_ends": { bases: ["game", "unread", "default"], rule: "default: a lane that stops at the blueprint's edge (a last piece, an entrance with no exit); game: a loop, a merge, a side load, the hood or a splitter (the game check's cases); unread: a loader, a fork, another case", witness: "the lane-end game test as entities; the 88 cells' lane-end rows; the sample lane ends" },
    "lines.pickups.pickup_way": { bases: ["game"], rule: "game: the piece's direction where the line does not turn after it", witness: "the copy-spacing and sample-flow game tests as entities" },
    "lines.flow_direction": { bases: ["game", "unread", "default"], rule: "game: the common way of the takers; unread: the copy spacing's way where it differs; default: none", witness: "the 88 cells' flow rows; the copy-spacing and lane-end game tests; the 6 hand values" },
    "lines.sharing": { bases: ["unread", "default"], rule: "unread: copies found and their arms touch the lane; default: no copies found, no arm on the lane, or runs that disagree", witness: "copies, flow and sharing of sample builds, with its one-copy and two-stacked-copies cases" },
    "copy_offset": { bases: ["unread", "default"], rule: "unread: a spacing found; default: none found", witness: "the copy-spacing game test as entities; military-240 and grenade's full build" },
};

describe("the basis of every value the geometry gives (derived)", () => {
    it("is one of the bases the table allows for its field, on every build of the tests", () => {
        const all = [
            built(path.join(FIXTURES, "pickup-rules.scaffold")),
            reporting,
            ...sampleBuilt.values(),
            ...samples.copies.map((c) => built(path.join(SAMPLES, c.blueprint))),
        ];
        const seen = new Map<string, Set<Basis>>(Object.keys(BASIS).map((k) => [k, new Set<Basis>()]));
        const add = (field: string, basis: Basis) => seen.get(field)!.add(basis);
        for (const { geometry: g } of all) {
            for (const e of g.ends) add("ends", e.basis);
            for (const p of g.pickups) {
                for (const v of [p.near_lane, p.pickup_length, p.pickup_layout, p.problem]) {
                    expect(v.basis).toBe(p.near_lane.basis);
                    add("pickups.near_lane, pickup_length, pickup_layout, problem", v.basis);
                }
                add("pickups.supply_problem", p.supply_problem.basis);
            }
            for (const d of g.drops) {
                add("drops.line", d.line.basis);
                add("drops.belt_direction", d.belt_direction.basis);
                add("drops.side_load_tiles", d.side_load_tiles.basis);
            }
            for (const l of g.lines) {
                add("lines.belt_type", l.belt_type.basis);
                for (const p of l.pickups) {
                    for (const e of p.lane_ends) add("lines.pickups.lane_ends", e.basis);
                    add("lines.pickups.pickup_way", p.pickup_way.basis);
                }
                if (l.flow_direction) add("lines.flow_direction", l.flow_direction.basis);
                for (const s of l.sharing) add("lines.sharing", s.basis);
            }
            add("copy_offset", g.copy_offset.basis);
            for (const v of g.vehicles) expect(Object.keys(v).sort()).toEqual(["box", "entity_number", "name"]);
        }
        for (const [field, { bases }] of Object.entries(BASIS)) {
            for (const b of seen.get(field)!) expect(bases, field).toContain(b);
        }
        const folder = process.env.GEOMETRY_WITNESS_DIRECTORY;
        if (folder) {
            const rows = Object.entries(BASIS).map(([field, { bases, rule, witness: w }]) => [field, bases.join(","), [...seen.get(field)!].sort().join(","), rule, w].join("\t"));
            rows.push(["vehicles", "none", "none", "the box is the data's collision box turned by the blueprint's orientation; the vehicle end in ends carries the overlap rule's basis",
                "vehicles, the box their ends are found by (iron's car, steel's wagon, a tank, a car turned by 0.125, a car no arm reaches)"].join("\t"));
            fs.writeFileSync(path.join(folder, "basis.tsv"), ["field\tbases\tseen in the tests\trule\twitness", ...rows].join("\n") + "\n");
        }
    });
});
