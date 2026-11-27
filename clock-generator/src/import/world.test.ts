import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { decodeBlueprintFileBrowser } from "../blueprints/serde-browser";
import {
    BeltPiece,
    BuildWorld,
    DropLane,
    OUTSIDE_THE_PIN,
    Point,
    PrototypeRow,
    SIDE_LOAD_MARK,
    WorldData,
    WorldEntity,
    WorldProblem,
    kindOfType,
    laneOfDrop,
    tileOf,
    worldOf,
} from "./world";

const ENGINE = path.resolve(__dirname, "../..");
const SAMPLE = path.join(ENGINE, "resources", "config-samples", "science", "automation", "automation-240.scaffold");

// ---------------------------------------------------------------- the game's reads and the data slice

type GamePiece = {
    unit: number;
    name: string;
    type: string;
    position: Point;
    direction: number;
    inputs: number[];
    outputs: number[];
    belt_shape?: string;
    belt_to_ground_type?: string;
    loader_type?: string;
    underground_neighbour?: number;
    splitter_input_priority?: string;
    splitter_output_priority?: string;
    loader_container?: { name: string; position: Point };
};
type GameInserter = { unit: number; position: Point; direction: number; mirroring: boolean; drop_position: Point; drop_unit: number; lane_read: number };
type GameReads = {
    frame_offset: Point;
    pieces: GamePiece[];
    inserters: GameInserter[];
    landing: { unit: number; line: number; read: number[][] }[];
};
type SliceRow = PrototypeRow & { source: string; max_distance_source?: string };

const reads = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "world", "output-line.json"), "utf8")) as GameReads;
const slice = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "world", "data-slice.json"), "utf8")) as { game_version: string; rows: Record<string, SliceRow> };
const DATA: WorldData = slice.rows;

// ---------------------------------------------------------------- reading a scaffold

/** A blueprint entity narrowed to the keys the world reads; anything the game does not write that way stops the test */
function toWorldEntity(value: unknown): WorldEntity {
    const fail = (why: string): never => {
        throw new Error(`not a blueprint entity the world reads: ${why}`);
    };
    if (typeof value !== "object" || value === null) return fail("not an object");
    const e = value as Record<string, unknown>;
    const position = e.position as Record<string, unknown> | undefined;
    if (typeof e.entity_number !== "number") fail("entity_number");
    if (typeof e.name !== "string") fail("name");
    if (typeof position !== "object" || position === null || typeof position.x !== "number" || typeof position.y !== "number") fail("position");
    for (const key of ["direction"]) if (e[key] !== undefined && typeof e[key] !== "number") fail(key);
    if (e.mirror !== undefined && typeof e.mirror !== "boolean") fail("mirror");
    for (const key of ["type", "input_priority", "output_priority"]) if (e[key] !== undefined && typeof e[key] !== "string") fail(key);
    const read: WorldEntity = { entity_number: e.entity_number as number, name: e.name as string, position: { x: position!.x as number, y: position!.y as number } };
    if (e.direction !== undefined) read.direction = e.direction as number;
    if (e.mirror !== undefined) read.mirror = e.mirror as boolean;
    if (e.type !== undefined) read.type = e.type as string;
    if (e.input_priority !== undefined) read.input_priority = e.input_priority as string;
    if (e.output_priority !== undefined) read.output_priority = e.output_priority as string;
    return read;
}

function entitiesOf(file: string): WorldEntity[] {
    const decoded = decodeBlueprintFileBrowser(fs.readFileSync(file, "utf8").trim()) as unknown as { blueprint?: { entities?: unknown } };
    const list = decoded.blueprint?.entities;
    if (!Array.isArray(list)) throw new Error(`${file} holds no entities`);
    return list.map(toWorldEntity);
}

const sampleEntities = entitiesOf(SAMPLE);
const sampleWorld = worldOf(sampleEntities, DATA);

// ---------------------------------------------------------------- the comparison with the game's reads

/** Every comparison of the game's reads with the world; each is one check */
function compareWithGame(world: BuildWorld) {
    const OX = reads.frame_offset.x;
    const OY = reads.frame_offset.y;
    const diffs: string[] = [];
    let checks = 0;
    let agree = 0;
    const check = (what: string, mine: unknown, game: unknown) => {
        checks += 1;
        if (JSON.stringify(mine) === JSON.stringify(game)) agree += 1;
        else diffs.push(`${what}: world ${JSON.stringify(mine)}, game ${JSON.stringify(game)}`);
    };

    const pieceAtPosition = new Map<string, BeltPiece>();
    for (const piece of world.pieces) {
        const position = world.entity(piece.entity_number)!.position;
        pieceAtPosition.set(`${position.x},${position.y}`, piece);
    }
    const unitOf = new Map<number, number>();
    const gameByUnit = new Map(reads.pieces.map((p) => [p.unit, p]));
    for (const g of reads.pieces) {
        const piece = pieceAtPosition.get(`${g.position.x - OX},${g.position.y - OY}`);
        if (!piece) diffs.push(`game piece ${g.unit}: the world has no belt piece there`);
        else unitOf.set(piece.entity_number, g.unit);
    }
    const U = (n: number | null | undefined) => (n === null || n === undefined ? null : (unitOf.get(n) ?? -n));
    const recorded = world.pieces.filter((p) => unitOf.has(p.entity_number));
    for (const p of recorded) {
        for (const q of [...p.outputs, ...p.inputs, ...(p.partner === null ? [] : [p.partner])]) {
            if (!unitOf.has(q)) diffs.push(`${U(p.entity_number)}: the world's neighbour ${q} is not a recorded piece`);
        }
    }

    for (const p of recorded) {
        const unit = U(p.entity_number)!;
        const g = gameByUnit.get(unit)!;
        const entity = world.entity(p.entity_number)!;
        check(`${unit} type`, entity.prototype, g.type);
        check(`${unit} name`, p.name, g.name);
        check(`${unit} direction`, p.direction, g.direction);
        check(`${unit} belt_shape`, p.shape, g.belt_shape ?? null);
        check(`${unit} belt_to_ground_type`, p.kind === "underground" ? p.end : null, g.belt_to_ground_type ?? null);
        check(`${unit} loader_type`, p.kind === "loader" ? p.end : null, g.loader_type ?? null);
        check(`${unit} underground_neighbour`, U(p.partner), g.underground_neighbour ?? null);
        if (p.splitter) {
            check(`${unit} priorities`, [p.splitter.input_priority, p.splitter.output_priority], [g.splitter_input_priority, g.splitter_output_priority]);
            check(`${unit} outputs`, p.splitter.outputs.map(U), g.outputs);
            check(`${unit} inputs`, p.splitter.inputs.map(U), g.inputs);
        } else {
            const sorted = (list: number[]) => [...list].sort((a, b) => a - b);
            check(`${unit} outputs`, sorted(p.outputs.map((n) => U(n)!)), sorted(g.outputs));
            check(`${unit} inputs`, sorted(p.inputs.map((n) => U(n)!)), sorted(g.inputs));
        }
        if (p.loader) {
            const chest = p.loader.chest === null ? null : world.entity(p.loader.chest)!;
            const gc = g.loader_container!;
            check(
                `${unit} loader chest`,
                chest && { name: chest.name, position: chest.position },
                { name: gc.name, position: { x: gc.position.x - OX, y: gc.position.y - OY } },
            );
        }
    }

    // the side loads: one read for each lane of each side loader
    for (const row of reads.landing) {
        const p = recorded.find((q) => U(q.entity_number) === row.unit)!;
        const mine = p.side_loads.filter((s) => s.passing.includes(row.line as 1 | 2)).map((s) => [U(s.receiver), s.lane]);
        check(`side load ${row.unit} line ${row.line}`, mine, row.read);
    }
    const loading = new Set(reads.landing.map((row) => row.unit));
    for (const p of recorded) {
        if (p.side_loads.length > 0 && !loading.has(U(p.entity_number)!)) diffs.push(`${U(p.entity_number)} side-loads in the world, not in the reads`);
    }

    // the output inserters: the piece each drops on, the lane, and the way on to the loader
    const gamePath = (unit: number, seen: Set<number>): number[] => {
        const g = gameByUnit.get(unit);
        if (seen.has(unit) || !g) return [];
        const next = g.type === "underground-belt" && g.belt_to_ground_type === "input" ? (g.underground_neighbour === undefined ? [] : [g.underground_neighbour]) : g.outputs;
        if (g.type === "loader") return [unit];
        for (const n of next) {
            const rest = gamePath(n, new Set(seen).add(unit));
            if (rest.length > 0) return [unit, ...rest];
        }
        return [];
    };
    const minePath = (p: BeltPiece, seen: Set<number>): number[] | null => {
        if (seen.has(p.entity_number)) return null;
        if (p.kind === "loader") return [p.entity_number];
        for (const q of world.lineAfter(p)) {
            const rest = minePath(q, new Set(seen).add(p.entity_number));
            if (rest) return [p.entity_number, ...rest];
        }
        return null;
    };
    for (const g of reads.inserters) {
        const where = { x: g.position.x - OX, y: g.position.y - OY };
        const inserter = world.entities.find((e) => e.position.x === where.x && e.position.y === where.y && e.prototype === "inserter");
        if (!inserter) {
            diffs.push(`inserter ${g.unit}: the world has none there`);
            continue;
        }
        const dropAt = { x: g.drop_position.x - OX, y: g.drop_position.y - OY };
        const entity = world.entityAt(tileOf(dropAt));
        const piece = entity && world.piece(entity.entity_number);
        const lane = piece ? world.laneOfDrop(dropAt, piece, g.mirroring) : null;
        check(`inserter ${g.unit} drop piece`, piece ? U(piece.entity_number) : null, g.drop_unit);
        check(`inserter ${g.unit} drop lane`, lane && lane.line, g.lane_read);
        const mine = piece ? (minePath(piece, new Set()) ?? []).map((n) => U(n)) : [];
        check(`inserter ${g.unit} path to the loader`, mine, gamePath(g.drop_unit, new Set()));
    }
    return { checks, agree, diffs };
}

describe("the world of the automation science 240 sample, against the game's reads", () => {
    it("matches the game on every compared read of the output side", () => {
        const { checks, agree, diffs } = compareWithGame(sampleWorld);
        expect(diffs).toEqual([]);
        expect({ compared: checks, agree, differ: diffs.length }).toEqual({ compared: 596, agree: 596, differ: 0 });
    });

    it("holds 61 pieces, 9 inserters and 18 landing reads, and places the sample with no problem", () => {
        expect({ pieces: reads.pieces.length, inserters: reads.inserters.length, landing: reads.landing.length }).toEqual({ pieces: 61, inserters: 9, landing: 18 });
        expect(sampleWorld.problems).toEqual([]);
    });

    it("gives the same world whatever the order of the entities", () => {
        const reversed = worldOf([...sampleEntities].reverse(), DATA);
        expect(reversed.entities).toEqual(sampleWorld.entities);
        expect(reversed.pieces).toEqual(sampleWorld.pieces);
        expect(reversed.problems).toEqual(sampleWorld.problems);
    });
});

// ---------------------------------------------------------------- the data slice

describe("the data slice of the tests", () => {
    it("names its source for the type and size of each row, and for each reach", () => {
        for (const [name, row] of Object.entries(DATA) as [string, SliceRow][]) {
            expect(row.source, name).not.toBe("");
            if (row.max_distance !== undefined) expect(row.max_distance_source, name).toBeTruthy();
        }
    });

    it("holds the reach of the four underground belts: 5, 7, 9 and 11", () => {
        expect(["underground-belt", "fast-underground-belt", "express-underground-belt", "turbo-underground-belt"].map((n) => DATA[n].max_distance)).toEqual([5, 7, 9, 11]);
    });
});

// ---------------------------------------------------------------- small worlds

type Extra = Partial<Pick<WorldEntity, "type" | "input_priority" | "output_priority" | "mirror">>;
const entity = (entity_number: number, name: string, x: number, y: number, direction?: number, extra: Extra = {}): WorldEntity => ({
    entity_number,
    name,
    position: { x, y },
    ...(direction === undefined ? {} : { direction }),
    ...extra,
});
const belt = (n: number, x: number, y: number, direction: number) => entity(n, "turbo-transport-belt", x, y, direction);
const piece = (world: BuildWorld, n: number): BeltPiece => {
    const found = world.piece(n);
    if (!found) throw new Error(`no piece ${n}`);
    return found;
};
const codes = (problems: WorldProblem[]) => problems.map((p) => `${p.entity_number} ${p.code}`);

describe("footprints and tiles", () => {
    it("turns a splitter and a loader with their direction", () => {
        const world = worldOf([entity(1, "turbo-splitter", 0.5, 1, 4), entity(2, "turbo-splitter", 3, 0.5, 0), entity(3, "turbo-loader", 6.5, 1, 8), entity(4, "turbo-loader", 9, 0.5, 12)], DATA);
        expect(world.entities.map((e) => e.tiles)).toEqual([
            [{ x: 0, y: 0 }, { x: 0, y: 1 }],
            [{ x: 2, y: 0 }, { x: 3, y: 0 }],
            [{ x: 6, y: 0 }, { x: 6, y: 1 }],
            [{ x: 8, y: 0 }, { x: 9, y: 0 }],
        ]);
        expect(world.problems).toEqual([]);
    });

    it("places a machine on its tiles and an inserter on one tile", () => {
        const world = worldOf([entity(1, "electromagnetic-plant", 2, 2), entity(2, "stack-inserter", 4.5, 0.5, 0)], DATA);
        expect(world.entity(1)!.tiles).toHaveLength(16);
        expect(world.entity(2)!.tiles).toEqual([{ x: 4, y: 0 }]);
        expect(world.entityAt({ x: 3, y: 3 })!.entity_number).toBe(1);
        expect(world.entityAt({ x: 4, y: 3 })).toBeUndefined();
    });

    it("lists an entity off the grid and two that share a tile", () => {
        const world = worldOf([entity(1, "assembling-machine-3", 1, 1), belt(2, 5.5, 5.5, 0), belt(3, 5.5, 5.5, 4)], DATA);
        expect(codes(world.problems)).toEqual(["1 off-grid", "3 overlap"]);
        expect(world.problems[1]).toMatchObject({ other: 2, tile: { x: 5, y: 5 } });
        expect(world.entityAt({ x: 5, y: 5 })!.entity_number).toBe(2);
    });

    it("passes a car and a wagon through, off the grid", () => {
        const world = worldOf([entity(1, "car", 0.3, 0.3), entity(2, "cargo-wagon", 7.1, 2.9)], DATA);
        expect(world.entities.map((e) => [e.kind, e.placed, e.tiles.length])).toEqual([["chest", false, 0], ["chest", false, 0]]);
        expect(world.problems).toEqual([]);
    });

    it("lists a name with no data row, and does not throw on an entity that is not one", () => {
        const world = worldOf([entity(1, "no-such-thing", 0.5, 0.5), null, {}, { entity_number: 7, name: "pipe", position: { x: "a", y: 0 } }, entity(2, "pipe", 1.5, 0.5), entity(2, "pipe", 2.5, 0.5)] as unknown as WorldEntity[], DATA);
        expect(world.entity(1)).toMatchObject({ kind: "none", placed: false, prototype: null });
        expect(codes(world.problems)).toEqual(["0 bad-entity", "0 bad-entity", "1 unknown-name", "2 duplicate-number", "7 bad-entity"]);
    });

    it("lists a direction the game does not write, and a belt facing between two", () => {
        const world = worldOf([belt(1, 0.5, 0.5, 2), belt(2, 1.5, 0.5, 40)], DATA);
        expect(codes(world.problems)).toEqual(["1 bad-direction", "2 bad-direction"]);
        expect(world.pieces.map((p) => p.entity_number)).toEqual([2]);
    });

    it("gives every entity a kind from its prototype type", () => {
        const withOneByOne: WorldData = { ...DATA, "loader-1x1": { type: "loader-1x1", tile_width: 1, tile_height: 1 } };
        const world = worldOf(
            [
                "assembling-machine-3", "electric-furnace", "lab", "recycler", "turbo-transport-belt", "underground-belt", "turbo-splitter", "turbo-loader", "loader-1x1",
                "steel-chest", "passive-provider-chest", "linked-chest", "infinity-chest", "car", "cargo-wagon", "rocket-silo", "electric-mining-drill", "beacon", "stack-inserter",
            ].map((name, i) => entity(i + 1, name, 0.5 + 12 * i, 0.5)),
            withOneByOne,
        );
        expect(world.entities.map((e) => [e.name, e.kind])).toEqual([
            ["assembling-machine-3", "machine"], ["electric-furnace", "machine"], ["lab", "machine"], ["recycler", "machine"],
            ["turbo-transport-belt", "belt"], ["underground-belt", "belt"], ["turbo-splitter", "belt"], ["turbo-loader", "belt"], ["loader-1x1", "belt"],
            ["steel-chest", "chest"], ["passive-provider-chest", "chest"], ["linked-chest", "chest"], ["infinity-chest", "chest"], ["car", "chest"], ["cargo-wagon", "chest"], ["rocket-silo", "chest"],
            ["electric-mining-drill", "none"], ["beacon", "none"], ["stack-inserter", "none"],
        ]);
        expect(world.pieces.map((p) => p.name)).toEqual(["turbo-transport-belt", "underground-belt", "turbo-splitter", "turbo-loader"]);
        expect(["transport-belt", "inserter", "pipe"].map(kindOfType)).toEqual(["belt", "none", "none"]);
    });
});

describe("what the game leaves out of a blueprint", () => {
    it("reads an underground belt and a loader with no type as an input", () => {
        const world = worldOf([entity(1, "turbo-underground-belt", 0.5, 0.5, 4), entity(2, "turbo-loader", 3.5, 2, 4), entity(3, "turbo-underground-belt", 5.5, 0.5, 4, { type: "output" })], DATA);
        expect(world.pieces.map((p) => p.end)).toEqual(["input", "input", "output"]);
    });

    it("lists a type that is neither input nor output", () => {
        const world = worldOf([entity(1, "turbo-underground-belt", 0.5, 0.5, 4, { type: "sideways" })], DATA);
        expect(codes(world.problems)).toEqual(["1 bad-type"]);
    });

    it("reads a splitter with no priority as none, for each priority apart", () => {
        const world = worldOf(
            [entity(1, "turbo-splitter", 0.5, 1, 4), entity(2, "turbo-splitter", 3.5, 1, 4, { output_priority: "left" }), entity(3, "turbo-splitter", 6.5, 1, 4, { input_priority: "right", output_priority: "left" })],
            DATA,
        );
        expect(world.pieces.map((p) => [p.splitter!.input_priority, p.splitter!.output_priority])).toEqual([["none", "none"], ["none", "left"], ["right", "left"]]);
        expect(world.problems).toEqual([]);
    });
});

describe("underground pairs", () => {
    const pairAt = (name: string, k: number) => {
        const world = worldOf([entity(1, name, 0.5, 0.5, 4, { type: "input" }), entity(2, name, 0.5 + k, 0.5, 4, { type: "output" })], DATA);
        return { world, partner: piece(world, 1).partner };
    };

    for (const name of ["underground-belt", "fast-underground-belt", "express-underground-belt", "turbo-underground-belt"]) {
        const reach = DATA[name].max_distance!;
        const pinned = name === "turbo-underground-belt" ? "" : ", unmeasured below turbo";
        it(`${name} pairs an exit ${reach} tiles on and not ${reach + 1} (reach as the data gives it${pinned})`, () => {
            const inReach = pairAt(name, reach);
            expect(inReach.partner).toBe(2);
            expect(piece(inReach.world, 2).partner).toBe(1);
            expect(pairAt(name, reach + 1).partner).toBeNull();
        });
    }

    it("pairs only with the first underground belt of its name on its line, and only an exit facing the same way", () => {
        const second = worldOf([entity(1, "turbo-underground-belt", 0.5, 0.5, 4, { type: "input" }), entity(2, "turbo-underground-belt", 2.5, 0.5, 4, { type: "input" }), entity(3, "turbo-underground-belt", 5.5, 0.5, 4, { type: "output" })], DATA);
        expect(piece(second, 1).partner).toBeNull();
        expect(piece(second, 2).partner).toBe(3);
        const facing = worldOf([entity(1, "turbo-underground-belt", 0.5, 0.5, 4, { type: "input" }), entity(2, "turbo-underground-belt", 3.5, 0.5, 12, { type: "output" })], DATA);
        expect(piece(facing, 1).partner).toBeNull();
        const otherName = worldOf([entity(1, "turbo-underground-belt", 0.5, 0.5, 4, { type: "input" }), entity(2, "express-underground-belt", 3.5, 0.5, 4, { type: "output" })], DATA);
        expect(piece(otherName, 1).partner).toBeNull();
    });

    it("lists an underground belt whose data row has no reach, and pairs nothing", () => {
        const world = worldOf([entity(1, "turbo-underground-belt", 0.5, 0.5, 4, { type: "input" }), entity(2, "turbo-underground-belt", 2.5, 0.5, 4, { type: "output" })], { ...DATA, "turbo-underground-belt": { type: "underground-belt", tile_width: 1, tile_height: 1 } });
        expect(codes(world.problems)).toEqual(["1 no-reach"]);
        expect(piece(world, 1).partner).toBeNull();
    });

    it("sends the items of an entrance to its exit, and of any other piece to the pieces it feeds", () => {
        const world = worldOf([entity(1, "turbo-underground-belt", 0.5, 0.5, 4, { type: "input" }), entity(2, "turbo-underground-belt", 3.5, 0.5, 4, { type: "output" }), belt(3, 4.5, 0.5, 4)], DATA);
        expect(world.lineAfter(piece(world, 1)).map((p) => p.entity_number)).toEqual([2]);
        expect(world.lineAfter(piece(world, 2)).map((p) => p.entity_number)).toEqual([3]);
        expect(world.inputsOf(piece(world, 3)).map((p) => p.entity_number)).toEqual([2]);
    });
});

describe("belt shapes", () => {
    it("makes a curve of a belt with one feeder from a side and none from behind", () => {
        const right = worldOf([belt(1, 0.5, 0.5, 0), belt(2, 1.5, 0.5, 12)], DATA);
        const left = worldOf([belt(1, 0.5, 0.5, 0), belt(2, -0.5, 0.5, 4)], DATA);
        expect([piece(right, 1).shape, piece(left, 1).shape]).toEqual(["right", "left"]);
        expect(piece(right, 2).side_loads).toEqual([]);
    });

    it("keeps a belt straight when it has a feeder from behind, or two from the sides", () => {
        const withBehind = worldOf([belt(1, 0.5, 0.5, 0), belt(2, 0.5, 1.5, 0), belt(3, 1.5, 0.5, 12)], DATA);
        const bothSides = worldOf([belt(1, 0.5, 0.5, 0), belt(2, 1.5, 0.5, 12), belt(3, -0.5, 0.5, 4)], DATA);
        expect([piece(withBehind, 1).shape, piece(bothSides, 1).shape]).toEqual(["straight", "straight"]);
        expect(piece(bothSides, 2).side_loads).toHaveLength(1);
    });

    it("takes nothing from a belt that faces it", () => {
        const world = worldOf([belt(1, 0.5, 0.5, 0), belt(2, 0.5, -0.5, 8)], DATA);
        expect(piece(world, 1).inputs).toEqual([]);
        expect(piece(world, 2).outputs).toEqual([]);
    });
});

describe("side loads", () => {
    const sideLoad = (receiver: WorldEntity, sender: WorldEntity, extra: WorldEntity[] = []) => piece(worldOf([receiver, sender, ...extra], DATA), sender.entity_number).side_loads;
    const behindReceiver = belt(9, 0.5, 1.5, 0);
    const straight = belt(1, 0.5, 0.5, 0);
    const exit = entity(1, "turbo-underground-belt", 0.5, 0.5, 0, { type: "output" });
    const entrance = entity(1, "turbo-underground-belt", 0.5, 0.5, 0, { type: "input" });
    const fromLeft = belt(2, -0.5, 0.5, 4);
    const fromRight = belt(2, 1.5, 0.5, 12);

    it("lands from the right onto a straight belt on its right lane, both lanes passing (in the game's reads)", () => {
        expect(sideLoad(straight, fromRight, [behindReceiver])).toEqual([{ receiver: 1, lane: 2, passing: [1, 2], mark: null }]);
    });
    it("lands from the right onto an exit on its right lane, only the lane over its front half passing (in the game's reads)", () => {
        expect(sideLoad(exit, fromRight)).toEqual([{ receiver: 1, lane: 2, passing: [2], mark: null }]);
    });
    it("lands from the left onto an entrance on its left lane, only the lane over its back half passing (in the game's reads)", () => {
        expect(sideLoad(entrance, fromLeft)).toEqual([{ receiver: 1, lane: 1, passing: [2], mark: null }]);
    });

    it("lands from the left onto a straight belt on its left lane, both lanes passing, marked outside the pin (a game check, reads not kept)", () => {
        expect(sideLoad(straight, fromLeft, [behindReceiver])).toEqual([{ receiver: 1, lane: 1, passing: [1, 2], mark: SIDE_LOAD_MARK }]);
    });
    it("lands from the left onto an exit on its left lane, only the left lane passing, marked outside the pin (a game check, reads not kept)", () => {
        expect(sideLoad(exit, fromLeft)).toEqual([{ receiver: 1, lane: 1, passing: [1], mark: SIDE_LOAD_MARK }]);
    });
    it("lands from the right onto an entrance on its right lane, only the left lane passing, marked outside the pin (a game check, reads not kept)", () => {
        expect(sideLoad(entrance, fromRight)).toEqual([{ receiver: 1, lane: 2, passing: [1], mark: SIDE_LOAD_MARK }]);
    });

    it("says in the words of its rule what the mark of a side load means", () => {
        expect(SIDE_LOAD_MARK).toBe("outside the 596-read pin; a game check agrees, its reads not kept, game version not stated");
    });
});

describe("splitters and loaders", () => {
    it("tells the halves of a splitter apart, left and right looking the way it faces, and what feeds and leaves each", () => {
        // a splitter facing east at x 1, its halves at y 0 (left, north) and y 1 (right, south)
        const world = worldOf(
            [entity(1, "turbo-splitter", 1.5, 1, 4), belt(2, 0.5, 0.5, 4), belt(3, 0.5, 1.5, 4), belt(4, 2.5, 0.5, 4), belt(5, 2.5, 1.5, 4)],
            DATA,
        );
        const splitter = piece(world, 1).splitter!;
        expect([splitter.left, splitter.right]).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }]);
        expect([splitter.inputs, splitter.outputs]).toEqual([[2, 3], [4, 5]]);
    });

    it("finds the chest a loader fills one tile beyond its front", () => {
        const world = worldOf([entity(1, "turbo-loader", 1, 0.5, 4, { type: "input" }), entity(2, "steel-chest", 2.5, 0.5), belt(3, -0.5, 0.5, 4)], DATA);
        expect(piece(world, 1).loader).toEqual({ back: { x: 0, y: 0 }, front: { x: 1, y: 0 }, chest: 2 });
        expect(piece(world, 3).outputs).toEqual([1]);
    });

    it("feeds a loader only from behind, and only an input loader", () => {
        const fromBack = worldOf([entity(1, "turbo-loader", 1, 0.5, 4, { type: "input" }), belt(2, -0.5, 0.5, 4)], DATA);
        const output = worldOf([entity(1, "turbo-loader", 1, 0.5, 4, { type: "output" }), belt(2, -0.5, 0.5, 4)], DATA);
        const fromFront = worldOf([entity(1, "turbo-loader", 1, 0.5, 4, { type: "input" }), belt(2, 2.5, 0.5, 12)], DATA);
        expect([piece(fromBack, 1).inputs, piece(output, 1).inputs, piece(fromFront, 1).inputs]).toEqual([[2], [], []]);
    });
});

// ---------------------------------------------------------------- the lane of a drop

const lane = (world: BuildWorld, n: number, point: Point, mirrored: boolean): DropLane | null => world.laneOfDrop(point, piece(world, n), mirrored);
const CENTRE = 0.5;

describe("the lane of a drop on a straight belt", () => {
    // the way each direction faces, and the side of it that is its left
    const WAYS: [number, string, Point, Point][] = [
        [0, "north", { x: 0, y: -1 }, { x: -1, y: 0 }],
        [4, "east", { x: 1, y: 0 }, { x: 0, y: -1 }],
        [8, "south", { x: 0, y: 1 }, { x: 1, y: 0 }],
        [12, "west", { x: -1, y: 0 }, { x: 0, y: 1 }],
    ];
    const at = (base: Point, by: Point, far: number): Point => ({ x: CENTRE + base.x + by.x * far, y: CENTRE + base.y + by.y * far });

    for (const [direction, way, run, left] of WAYS) {
        const world = worldOf([belt(1, CENTRE, CENTRE, direction)], DATA);
        it(`lands on the lane on the side of the drop point, belt facing ${way}, 0.2 tile off the centre line (measured)`, () => {
            expect(lane(world, 1, at({ x: 0, y: 0 }, left, 0.2), false)).toEqual({ line: 1, mark: null });
            expect(lane(world, 1, at({ x: 0, y: 0 }, left, -0.2), false)).toEqual({ line: 2, mark: null });
        });
        it(`lands on the right lane for a drop on the centre line, belt facing ${way}, not mirrored (measured)`, () => {
            expect(lane(world, 1, at({ x: 0, y: 0 }, run, 0.2), false)).toEqual({ line: 2, mark: null });
            expect(lane(world, 1, at({ x: 0, y: 0 }, run, -0.2), false)).toEqual({ line: 2, mark: null });
        });
        it(`lands on the left lane for a drop on the centre line, belt facing ${way}, mirrored (derived, not measured)`, () => {
            expect(lane(world, 1, at({ x: 0, y: 0 }, run, 0.2), true)).toEqual({ line: 1, mark: null });
        });
        it(`gives the same lane to a drop off the centre line, mirrored or not, belt facing ${way}`, () => {
            expect(lane(world, 1, at({ x: 0, y: 0 }, left, 0.2), true)).toEqual({ line: 1, mark: null });
        });
    }

    it("gives no lane on a splitter, and a drop point reads the tile it is in", () => {
        const world = worldOf([entity(1, "turbo-splitter", 1, 0.5, 0)], DATA);
        expect(lane(world, 1, { x: 1.2, y: 0.5 }, false)).toBeNull();
        expect(tileOf({ x: -0.2, y: 3.99 })).toEqual({ x: -1, y: 3 });
    });

    it("is one function, whether the world or the module calls it", () => {
        const world = worldOf([belt(1, CENTRE, CENTRE, 0)], DATA);
        const point = { x: 0.3, y: 0.5 };
        expect(world.laneOfDrop(point, piece(world, 1), false)).toEqual(laneOfDrop(point, piece(world, 1), false));
    });
});

describe("the lane of a drop on the end of an underground belt, outside the pin", () => {
    const end = (type: "input" | "output") => worldOf([entity(1, "turbo-underground-belt", CENTRE, CENTRE, 4, { type })], DATA);
    const inLine = { x: CENTRE + 0.2, y: CENTRE };

    it("gives an exit, mirrored, in line, the left lane (measured on one build)", () => {
        expect(lane(end("output"), 1, inLine, true)).toEqual({ line: 1, mark: OUTSIDE_THE_PIN });
    });
    it("gives an entrance, not mirrored, in line, the right lane (measured on one build)", () => {
        expect(lane(end("input"), 1, inLine, false)).toEqual({ line: 2, mark: OUTSIDE_THE_PIN });
    });
    it("gives an exit, not mirrored, in line, the right lane (derived from the rule, not measured)", () => {
        expect(lane(end("output"), 1, inLine, false)).toEqual({ line: 2, mark: OUTSIDE_THE_PIN });
    });
    it("gives an entrance, mirrored, in line, the left lane (derived from the rule, not measured)", () => {
        expect(lane(end("input"), 1, inLine, true)).toEqual({ line: 1, mark: OUTSIDE_THE_PIN });
    });
    it("gives a drop from the side onto an end the lane of the straight rule (derived, not measured)", () => {
        expect(lane(end("output"), 1, { x: CENTRE, y: CENTRE + 0.2 }, false)).toEqual({ line: 2, mark: OUTSIDE_THE_PIN });
        expect(lane(end("input"), 1, { x: CENTRE, y: CENTRE - 0.2 }, false)).toEqual({ line: 1, mark: OUTSIDE_THE_PIN });
    });
});

describe("the lane of a drop on a curve, outside the pin and unmeasured: this pins the ported rule", () => {
    // a belt facing north that the items enter from the east (a right curve, moving west) or from the west (a left curve, moving east)
    const curve = (feeder: WorldEntity) => worldOf([belt(1, CENTRE, CENTRE, 0), feeder], DATA);
    const right = curve(belt(2, 1.5, 0.5, 12));
    const left = curve(belt(2, -0.5, 0.5, 4));
    // drop points 0.2 tile from the tile centre, as (dx, dy) with y down: east, west, north, south of it
    const POINTS: Point[] = [{ x: 0.2, y: 0 }, { x: -0.2, y: 0 }, { x: 0, y: -0.2 }, { x: 0, y: 0.2 }];
    const EXPECTED = { right: [2, 1, 2, 1], left: [2, 1, 1, 2] };

    it("is a right curve and a left curve", () => {
        expect([piece(right, 1).shape, piece(left, 1).shape]).toEqual(["right", "left"]);
    });
    for (const [shape, world] of [["right", right], ["left", left]] as const) {
        it(`gives the ${shape} curve its lanes at the four points, mirrored and not (the two ties by the incoming way)`, () => {
            for (const mirrored of [false, true]) {
                const got = POINTS.map((p) => lane(world, 1, { x: CENTRE + p.x, y: CENTRE + p.y }, mirrored));
                expect(got, `mirrored ${mirrored}`).toEqual(EXPECTED[shape].map((line) => ({ line, mark: OUTSIDE_THE_PIN })));
            }
        });
    }
});

// ---------------------------------------------------------------- every scaffold of the repository

function scaffoldFiles(directory: string): string[] {
    const found: string[] = [];
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) found.push(...scaffoldFiles(file));
        else if (item.name.endsWith(".scaffold")) found.push(file);
    }
    return found;
}

/** Where a run that wants the graph of each scaffold says to write it; unset, nothing is written */
const DUMP_DIRECTORY = process.env.WORLD_DUMP_DIRECTORY;

describe("every scaffold of the repository", () => {
    const files = ["resources", "tests"].flatMap((d) => scaffoldFiles(path.join(ENGINE, d))).sort();

    it("finds the scaffolds", () => {
        expect(files.length).toBeGreaterThanOrEqual(60);
    });

    // three hand-made fixtures of the game tests sit on a frame moved half a tile along x: each of their entities is off the grid
    const HALF_TILE_OFF = [
        "tests/game/mechanics/activation-order/fixtures/condition-writes/scaffold.scaffold",
        "tests/game/mechanics/activation-order/fixtures/partial-hand/scaffold.scaffold",
        "tests/game/mechanics/source-search/fixtures/scaffold.scaffold",
    ];

    it("places the entities of each scaffold sharing no tile, and on the grid but for three fixtures a half tile off", () => {
        const overlaps: string[] = [];
        const offGrid = new Map<string, { off: number; placed: number }>();
        for (const file of files) {
            const relative = path.relative(ENGINE, file).split(path.sep).join("/");
            const world = worldOf(entitiesOf(file), DATA);
            for (const problem of world.problems) {
                if (problem.code === "overlap") overlaps.push(`${relative}: ${problem.entity_number} ${problem.name}`);
            }
            const off = world.problems.filter((p) => p.code === "off-grid").length;
            if (off > 0) offGrid.set(relative, { off, placed: world.entities.filter((e) => e.placed).length });
            if (DUMP_DIRECTORY) {
                const unplaced: Record<string, number> = {};
                for (const e of world.entities) if (!e.placed) unplaced[e.name] = (unplaced[e.name] ?? 0) + 1;
                const dump = { scaffold: relative, pieces: world.pieces, problems: world.problems, unplaced };
                fs.writeFileSync(path.join(DUMP_DIRECTORY, `${relative.replace(/\//g, "__")}.json`), JSON.stringify(dump));
            }
        }
        expect(overlaps).toEqual([]);
        expect([...offGrid.keys()].sort()).toEqual(HALF_TILE_OFF);
        for (const counts of offGrid.values()) expect(counts.off).toBe(counts.placed);
    });
});
