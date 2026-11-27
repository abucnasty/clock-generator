/**
 * The geometry of a pasted blueprint: what each inserter takes from and drops into, how it stands at a belt it takes
 * from, where a drop lands, how each belt line ends and which way its items move, where the next copy stands, and
 * whether the copies share a lane.
 *
 * `geometryOf` reads the world of the blueprint (`worldOf`), the blueprint's own entities (for a recipe, a quality, a
 * vehicle's orientation and an infinity chest's settings) and the prototype rows of the game data, with the game's
 * property names. It is pure and total: the same input gives the same geometry, every list is sorted by a stated key,
 * and an entity it cannot read is a listed problem, never a throw.
 *
 * Every value but a vehicle's box carries a basis: `game` where a kept read of the game agrees on its case, `unread`
 * where no read of the game holds the case, and `default` where the blueprint cannot show the value (a lane's sharing
 * with one copy, a lane that ends at the blueprint's edge). The box is computed from the data and the blueprint alone.
 *
 * Frames, tiles, directions and lanes are as in `world.ts`.
 */
import type { BlueprintEntityRead } from "./blueprint-entities";
import type { BeltPickupLayout } from "../common/belt-pickup-layout";
import { BeltPiece, BuildWorld, PlacedEntity, Point, Tile, kindOfType, tileOf } from "./world";

export type Basis = "game" | "unread" | "default";

/** A value with its basis */
export type Based<T> = { value: T; basis: Basis };

/** A vector as the game data writes it: a pair, or an object with x and y */
export type DataVector = readonly [number, number] | { x: number; y: number };

/** What the geometry needs of one prototype, with the game's property names */
export type GeometryRow = {
    type: string;
    /** An inserter's pickup and drop vectors, facing north */
    pickup_position?: DataVector;
    insert_position?: DataVector;
    /** A vehicle's box, facing north: [top-left, bottom-right] */
    collision_box?: readonly [DataVector, DataVector];
    /** A belt piece's speed in tiles per tick */
    speed?: number;
};

/** The prototype rows by entity name */
export type GeometryData = Readonly<Record<string, GeometryRow>>;

export type TargetKind = "machine" | "belt" | "chest";

/** The corners of a vehicle's box in the blueprint's frame, in the order top-left, top-right, bottom-right, bottom-left before the turn */
export type Corners = [Point, Point, Point, Point];

/** A car (a tank is a car) or a cargo wagon of the blueprint, reached by an inserter or not */
export type VehicleBox = { entity_number: number; name: string; box: Corners | null };

/** The entity at one end of an inserter */
export type EndEntity = { entity_number: number; name: string; target: TargetKind; vehicle: boolean };

/** An inserter's pickup and drop points and what stands there */
export type InserterEnds = {
    inserter: number;
    pickup: Point;
    drop: Point;
    /** The one entity of a target type whose box overlaps the tile of the point; null where none or more than one */
    source: EndEntity | null;
    sink: EndEntity | null;
    /** Every entity of a target type on that tile, by entity number: more than one makes the end null */
    source_candidates: number[];
    sink_candidates: number[];
    basis: Basis;
};

/** Why a belt pickup is not supported, in the order the checks run */
export type PickupProblem = "bend" | "splitter" | "unsupported" | "inline";

/** An inserter that takes from a belt piece */
export type BeltPickup = {
    inserter: number;
    piece: number;
    near_lane: Based<1 | 2 | null>;
    pickup_length: Based<0.5 | 1 | null>;
    pickup_layout: Based<BeltPickupLayout | null>;
    problem: Based<PickupProblem | null>;
    /** "side-loaded" where another belt side-loads onto the pickup tile; read only for a pickup with no problem */
    supply_problem: Based<"side-loaded" | null>;
};

/** An inserter that drops onto a belt piece */
export type BeltDrop = {
    inserter: number;
    piece: number;
    /** The transport line the drop lands on: 1 or 2 on a belt or an underground end, 1 to 4 on a splitter's input halves; null elsewhere */
    line: Based<number | null>;
    belt_direction: Based<number>;
    /** The belt tiles from the drop tile to the belt its stream side-loads onto, where that belt is fed from behind */
    side_load_tiles: Based<number | null>;
};

export type LaneEnd = "dead_end" | "infinite" | "unknown";
export type Sharing = "shared" | "per_copy";

/** A piece of a line that an inserter takes from */
export type LinePickupPiece = {
    piece: number;
    /** The end of lane 1 and lane 2, followed downstream from the piece */
    lane_ends: [Based<LaneEnd>, Based<LaneEnd>];
    /** The way the items move at the piece where the line does not turn after it; false where it turns */
    pickup_way: Based<number | false>;
};

/** A physical belt line: pieces joined by the belt graph and underground pairs */
export type BeltLine = {
    /** The entity number of its first piece in the blueprint's order */
    first: number;
    /** Its pieces, by entity number */
    pieces: number[];
    /** The transport belt name of the line */
    belt_type: Based<string>;
    /** The pieces inserters take from, by entity number */
    pickups: LinePickupPiece[];
    /** The way the items pass the copies, for a line with pickups; null where the rule gives none; absent without pickups */
    flow_direction: Based<number | null> | null;
    /** Lane 1 and lane 2 */
    sharing: [Based<Sharing>, Based<Sharing>];
};

export type GeometryProblemCode = "no-vectors" | "bad-direction" | "no-box" | "bad-orientation";
export type GeometryProblem = { code: GeometryProblemCode; entity_number: number; name: string };

export type BuildGeometry = {
    /** By inserter entity number */
    ends: InserterEnds[];
    /** By inserter entity number */
    pickups: BeltPickup[];
    /** By inserter entity number */
    drops: BeltDrop[];
    /** By first piece */
    lines: BeltLine[];
    copy_offset: Based<Point | null>;
    /** By entity number */
    vehicles: VehicleBox[];
    /** By entity number, then code */
    problems: GeometryProblem[];
};

// ---------------------------------------------------------------- directions and small helpers

const RUN: Record<number, Point> = { 0: { x: 0, y: -1 }, 4: { x: 1, y: 0 }, 8: { x: 0, y: 1 }, 12: { x: -1, y: 0 } };
const CARDINAL = [0, 4, 8, 12];
const byNumber = (a: number, b: number) => a - b;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** The game keeps positions on a grid of 1/256 tile */
const GRID = 256;
const onGrid = (value: number) => Math.round(value * GRID) / GRID + 0;

function vectorOf(value: DataVector | undefined): Point | null {
    if (value === undefined) return null;
    const [x, y] = Array.isArray(value) ? value : [(value as { x: number }).x, (value as { y: number }).y];
    return isNumber(x) && isNumber(y) ? { x, y } : null;
}

/** A vector of a prototype facing north, turned to a cardinal direction */
function turned(v: Point, direction: number): Point {
    let { x, y } = v;
    for (let k = 0; k < direction / 4; k += 1) [x, y] = [-y, x];
    return { x: x + 0, y: y + 0 };
}

// ---------------------------------------------------------------- line lengths

/** The calibrated arcs of a right bend (lane 1 the outer one), and the line lengths of the other pieces */
const OUTER_ARC = 295 / 256;
const INNER_ARC = 106 / 256;
const SPLITTER_INPUT_LINE = 179 / 256;
const HALF_TILE = 0.5;

/**
 * The length of transport line 1 or 2 of a belt piece: a straight belt 1; a curve's outer line 295/256 and its inner
 * line 106/256 (line 1 is the outer one on a right curve, line 2 on a left curve); an underground end 0.5; a splitter's
 * input lines 179/256; a loader 0.5. Null for an entity that is not a belt piece of these kinds.
 */
export function lineLengthOf(world: BuildWorld, entityNumber: number, line: 1 | 2): number | null {
    const piece = world.piece(entityNumber);
    if (piece === undefined || (line !== 1 && line !== 2)) return null;
    switch (piece.kind) {
        case "belt":
            if (piece.shape === "left" || piece.shape === "right") return (piece.shape === "right") === (line === 1) ? OUTER_ARC : INNER_ARC;
            return 1;
        case "underground":
            return HALF_TILE;
        case "splitter":
            return SPLITTER_INPUT_LINE;
        case "loader":
            return HALF_TILE;
        default:
            return null;
    }
}

// ---------------------------------------------------------------- the pickup rules

/** The belt the right bend's pickup was calibrated on: only it is supported */
const CALIBRATED_BEND_BELTS: readonly string[] = ["turbo-transport-belt"];

type Arm = { position: Point; direction: number; mirror: boolean };

const offsetOf = (arm: Arm, piece: PlacedEntity) => ({ dx: arm.position.x - piece.position.x, dy: arm.position.y - piece.position.y });

function bendLayout(world: BuildWorld, arm: Arm, piece: BeltPiece): "bend-right-upstream" | null {
    if (piece.kind !== "belt" || piece.shape !== "right" || !CALIBRATED_BEND_BELTS.includes(piece.name) || arm.mirror) return null;
    const run = RUN[piece.direction];
    const placed = world.entity(piece.entity_number);
    if (!run || !placed || arm.direction !== piece.direction) return null;
    const { dx, dy } = offsetOf(arm, placed);
    if (Math.abs(dx + run.x) > 0.01 || Math.abs(dy + run.y) > 0.01) return null;
    if (lineLengthOf(world, piece.entity_number, 1) !== OUTER_ARC || lineLengthOf(world, piece.entity_number, 2) !== INNER_ARC) return null;
    return "bend-right-upstream";
}

/** The lane the inserter takes from first: the nearer lane beside the piece, or the one mirroring picks in line at an underground end */
function nearLane(world: BuildWorld, arm: Arm, piece: BeltPiece): 1 | 2 | null {
    if (bendLayout(world, arm, piece)) return 1;
    if (!(piece.kind === "underground" || (piece.kind === "belt" && piece.shape === "straight"))) return null;
    const run = RUN[piece.direction];
    const placed = world.entity(piece.entity_number);
    if (!run || !placed) return null;
    const { dx, dy } = offsetOf(arm, placed);
    // how far the inserter is to the left of the piece: left of (x, y) is (y, -x)
    const left = dx * run.y - dy * run.x;
    if (left > 0.25) return 1;
    if (left < -0.25) return 2;
    const along = dx * run.x + dy * run.y;
    const facing = RUN[arm.direction];
    if (!facing || piece.kind !== "underground" || Math.abs(left) >= 0.01) return null;
    // in line downstream of either end, facing back into it
    if (along > 0.25 && facing.x === -run.x && facing.y === -run.y) return arm.mirror ? 2 : 1;
    // in line upstream of an exit, reaching across its hood
    if (piece.end === "output" && along < -0.25 && facing.x === run.x && facing.y === run.y) return arm.mirror ? 2 : 1;
    return null;
}

function pickupLength(world: BuildWorld, arm: Arm, piece: BeltPiece): 0.5 | 1 | null {
    if (bendLayout(world, arm, piece)) return 1;
    if (!nearLane(world, arm, piece)) return null;
    const length = lineLengthOf(world, piece.entity_number, 1);
    return length === 0.5 || length === 1 ? length : null;
}

function pickupLayout(world: BuildWorld, arm: Arm, piece: BeltPiece): BeltPickupLayout | null {
    const bend = bendLayout(world, arm, piece);
    if (bend) return bend;
    if (!nearLane(world, arm, piece)) return null;
    if (piece.kind === "belt") return "side-straight";
    const run = RUN[piece.direction];
    const { dx, dy } = offsetOf(arm, world.entity(piece.entity_number)!);
    const side = Math.abs(dx * run.y - dy * run.x) > 0.25;
    const endpoint = piece.end === "input" ? "entrance" : "exit";
    if (!side && dx * run.x + dy * run.y < -0.25) return "over-hood-exit";
    if (side) return endpoint === "entrance" ? "side-entrance" : "side-exit";
    return endpoint === "entrance" ? "front-entrance" : "front-exit";
}

function pickupProblem(world: BuildWorld, arm: Arm, piece: BeltPiece | undefined): PickupProblem | null {
    if (piece && piece.kind === "belt" && piece.shape !== "straight" && !bendLayout(world, arm, piece)) return "bend";
    if (piece && piece.kind === "splitter") return "splitter";
    if (!piece || (piece.kind !== "belt" && piece.kind !== "underground")) return "unsupported";
    if (!nearLane(world, arm, piece)) return "inline";
    if (!pickupLength(world, arm, piece)) return "unsupported";
    return null;
}

/** The way a right bend takes its items in: its own input is no side load */
function incomingOfOwnInput(piece: BeltPiece): number {
    return piece.kind === "belt" && piece.shape === "right" ? (piece.direction + 12) % 16 : piece.direction;
}

/** "side-loaded" where a piece other than the pickup piece's own input feeds it */
function supplyProblem(world: BuildWorld, piece: BeltPiece): "side-loaded" | null {
    if (piece.kind !== "belt" && piece.kind !== "underground") return null;
    const incoming = incomingOfOwnInput(piece);
    return world.inputsOf(piece).some((input) => input.direction !== incoming) ? "side-loaded" : null;
}

/**
 * The pickup cases the game was read in, by layout or refusal and mirroring (both mirrorings of each): the seven
 * layouts, a bend, a splitter, in line, and a side-loaded tile. A refusal as `unsupported` (a loader and the like) was
 * not read.
 */
const READ_PICKUP_CASES: readonly string[] = [
    "side-straight", "side-entrance", "side-exit", "front-entrance", "front-exit", "over-hood-exit", "bend-right-upstream",
    "bend", "splitter", "inline",
];

// ---------------------------------------------------------------- ends and vehicles

const VEHICLE_TYPES = ["car", "cargo-wagon"];
/** The tile a point is in, shrunk by this much on each side, is what a box must overlap to stand there */
const TILE_MARGIN = 0.01;

/** The sine and cosine of a turn by `orientation` (0 to 1, clockwise from north), exact at the quarter turns */
function turnOf(orientation: number): { c: number; s: number } {
    const quarters = orientation * 4;
    if (Number.isInteger(quarters)) {
        const q = ((quarters % 4) + 4) % 4;
        return [{ c: 1, s: 0 }, { c: 0, s: 1 }, { c: -1, s: 0 }, { c: 0, s: -1 }][q];
    }
    const a = 2 * Math.PI * orientation;
    return { c: Math.cos(a), s: Math.sin(a) };
}

function vehicleBox(entity: BlueprintEntityRead | undefined, placed: PlacedEntity, row: GeometryRow): Corners | null {
    const box = row.collision_box;
    const a = box ? vectorOf(box[0]) : null;
    const b = box ? vectorOf(box[1]) : null;
    if (!a || !b) return null;
    const orientation = entity?.orientation ?? 0;
    if (!isNumber(orientation)) return null;
    const { c, s } = turnOf(orientation);
    const { x: px, y: py } = placed.position;
    const at = (x: number, y: number): Point => ({ x: px + x * c - y * s + 0, y: py + x * s + y * c + 0 });
    return [at(a.x, a.y), at(b.x, a.y), at(b.x, b.y), at(a.x, b.y)];
}

/** Whether a convex polygon overlaps a tile shrunk by the margin: a separating axis test */
function overlapsTile(polygon: readonly Point[], tile: Tile): boolean {
    const x0 = tile.x + TILE_MARGIN, y0 = tile.y + TILE_MARGIN, x1 = tile.x + 1 - TILE_MARGIN, y1 = tile.y + 1 - TILE_MARGIN;
    const square: Point[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    for (const shape of [polygon, square]) {
        for (let i = 0; i < shape.length; i += 1) {
            const p = shape[i], q = shape[(i + 1) % shape.length];
            const nx = q.y - p.y, ny = p.x - q.x;
            const along = (points: readonly Point[]) => points.map((pt) => nx * pt.x + ny * pt.y);
            const pa = along(polygon), pb = along(square);
            if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
        }
    }
    return true;
}

function targetOf(prototype: string | null): TargetKind | null {
    if (prototype === null) return null;
    const kind = kindOfType(prototype);
    return kind === "none" ? null : kind;
}

/** A vehicle end's case was read only with the vehicle turned a whole quarter */
const quarterTurned = (entity: BlueprintEntityRead | undefined) => Number.isInteger((entity?.orientation ?? 0) * 4);

// ---------------------------------------------------------------- drops

type DropCase = { piece: BeltPiece; across: number; along: number; mirrored: boolean };

/** Where the arm stands from the tile it drops on, in the piece's frame: along its way and to its left, in whole tiles */
function dropCase(arm: Arm, piece: BeltPiece, drop: Point): DropCase {
    const run = RUN[piece.direction];
    const tile = tileOf(drop);
    const dx = Math.round(arm.position.x - (tile.x + 0.5));
    const dy = Math.round(arm.position.y - (tile.y + 0.5));
    return { piece, along: dx * run.x + dy * run.y, across: dx * run.y - dy * run.x, mirrored: arm.mirror };
}

/**
 * Whether the game was read on this drop: the cases of the drop-lane cells (all four facings each). An underground end
 * from either side unmirrored, an entrance in line from behind and an exit in line from in front (mirrored or not); a
 * curve from behind and from the side away from its feeder, unmirrored; a splitter half from its outer side or from
 * behind, unmirrored. A straight belt: from either side, or in line unmirrored.
 */
function dropRead(c: DropCase): boolean {
    const { piece, along, across, mirrored } = c;
    const side = along === 0 && Math.abs(across) === 1;
    if (piece.kind === "underground") {
        if (side) return !mirrored;
        return across === 0 && (piece.end === "input" ? along === -1 : along === 1);
    }
    if (piece.kind === "belt" && (piece.shape === "left" || piece.shape === "right")) {
        if (mirrored) return false;
        // the feeder of a right curve is on its right, so the side away from it is the left (across +1)
        const away = piece.shape === "right" ? 1 : -1;
        return (along === -1 && across === 0) || (along === 0 && across === away);
    }
    if (piece.kind === "belt") return side || (across === 0 && Math.abs(along) === 1 && !mirrored);
    return false;
}

/** The splitter's line a drop lands on: the line of the drop's side on the half it falls on (1, 2 left half; 3, 4 right half) */
function splitterLine(piece: BeltPiece, drop: Point, mirrored: boolean): number | null {
    const run = RUN[piece.direction];
    if (!run || !piece.splitter) return null;
    const dx = drop.x - (Math.floor(drop.x) + 0.5);
    const dy = drop.y - (Math.floor(drop.y) + 0.5);
    const left = dx * run.y - dy * run.x;
    const side = Math.abs(left) < 1 / GRID ? (mirrored ? 1 : 2) : left > 0 ? 1 : 2;
    const tile = tileOf(drop);
    const on = (t: Tile) => t.x === tile.x && t.y === tile.y;
    if (on(piece.splitter.left)) return side;
    if (on(piece.splitter.right)) return side + 2;
    return null;
}

/** A splitter drop was read unmirrored from a half's outer side and from behind each half */
function splitterDropRead(c: DropCase, line: number | null): boolean {
    if (c.mirrored || line === null) return false;
    const onLeft = line <= 2;
    return (c.along === -1 && c.across === 0) || (c.along === 0 && c.across === (onLeft ? 1 : -1));
}

const beltPiece = (p: BeltPiece | undefined): p is BeltPiece => p !== undefined && (p.kind === "belt" || p.kind === "underground");

function hasThroughStream(world: BuildWorld, piece: BeltPiece): boolean {
    if (piece.kind === "underground" && piece.end === "output") return piece.partner !== null;
    return world.inputsOf(piece).some((input) => input.direction === piece.direction);
}

/** The tiles a step from a piece to the next takes: an underground pair counts the tiles between its ends */
function stepTiles(world: BuildWorld, from: BeltPiece, to: BeltPiece): number {
    const a = world.entity(from.entity_number)!.position, b = world.entity(to.entity_number)!.position;
    return Math.floor(Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + 0.5);
}

/** The next piece downstream, through an underground pair; null where there is not exactly one */
function nextPiece(world: BuildWorld, piece: BeltPiece): BeltPiece | null {
    if (piece.kind === "underground" && piece.end === "input") return piece.partner === null ? null : world.piece(piece.partner) ?? null;
    const outputs = world.lineAfter(piece);
    return outputs.length === 1 ? outputs[0] : null;
}

/** The tiles from a drop piece to the side load its stream waits at (a belt fed from behind), and whether the side load's case was read */
function sideLoadTiles(world: BuildWorld, drop: BeltPiece): { tiles: number | null; read: boolean } {
    let piece: BeltPiece | undefined = drop;
    let tiles = 0;
    const seen = new Set<number>();
    while (beltPiece(piece) && !seen.has(piece.entity_number)) {
        seen.add(piece.entity_number);
        const next = nextPiece(world, piece);
        if (!beltPiece(next ?? undefined)) return { tiles: null, read: true };
        tiles += piece.kind === "underground" && piece.end === "input" ? stepTiles(world, piece, next!) : 1;
        if (next!.direction !== piece.direction && hasThroughStream(world, next!)) {
            const load = piece.side_loads.find((s) => s.receiver === next!.entity_number);
            return { tiles, read: !load || load.mark === null };
        }
        piece = next!;
    }
    return { tiles: null, read: true };
}

// ---------------------------------------------------------------- lane ends and the way

function incomingOf(piece: BeltPiece): number {
    if (piece.shape === "right") return (piece.direction + 12) % 16;
    if (piece.shape === "left") return (piece.direction + 4) % 16;
    return piece.direction;
}

/** Whether a piece has an input other than `from` (an exit's tunnel is not among its inputs) */
const hasOtherInput = (world: BuildWorld, piece: BeltPiece, from: BeltPiece | null) =>
    world.inputsOf(piece).some((input) => input.entity_number !== from?.entity_number);

type EndCase = { ends: [LaneEnd, LaneEnd]; bases: [Basis, Basis] };
const both = (end: LaneEnd, basis: Basis): EndCase => ({ ends: [end, end], bases: [basis, basis] });

function loaderVoids(world: BuildWorld, read: ReadonlyMap<number, BlueprintEntityRead>, data: GeometryData, loader: BeltPiece, before: BeltPiece): boolean {
    if (loader.end !== "input" || !loader.loader || loader.loader.chest === null) return false;
    const chest = world.entity(loader.loader.chest);
    const settings = read.get(loader.loader.chest)?.infinity;
    if (!chest || chest.prototype !== "infinity-container" || !settings || !settings.remove_unfiltered_items || settings.filters.length > 0) return false;
    if ((read.get(loader.entity_number)?.filters.length ?? 0) > 0) return false;
    const speed = (n: string) => data[n]?.speed;
    const a = speed(loader.name), b = speed(before.name);
    return isNumber(a) && isNumber(b) && a >= b;
}

/**
 * The end of each lane of the line a pickup piece belongs to, followed downstream over the whole blueprint. A lane that
 * stops at the blueprint's edge is a dead end with basis default; the other cases carry the basis of their game read.
 */
function laneEnds(world: BuildWorld, read: ReadonlyMap<number, BlueprintEntityRead>, data: GeometryData, pickup: BeltPiece): EndCase {
    let piece: BeltPiece | undefined = pickup;
    const seen = new Set<number>();
    while (true) {
        if (!beltPiece(piece)) return both("unknown", "unread");
        // a loop
        if (seen.has(piece.entity_number)) return both("unknown", "game");
        seen.add(piece.entity_number);
        if (piece.kind === "underground" && piece.end === "input") {
            const exit: BeltPiece | undefined = piece.partner === null ? undefined : world.piece(piece.partner);
            if (!exit) return both("dead_end", "default");
            if (hasOtherInput(world, exit, null)) return both("unknown", "game");
            piece = exit;
            continue;
        }
        const outputs = world.lineAfter(piece);
        if (outputs.length === 0) return both("dead_end", "default");
        if (outputs.length > 1) return both("unknown", "unread");
        const next: BeltPiece = outputs[0];
        if (next.kind === "loader") return loaderVoids(world, read, data, next, piece) ? both("infinite", "unread") : both("unknown", "unread");
        if (next.kind === "belt") {
            // a stream that does not come in the way the next piece takes its items in side-loads onto it; or a merge
            if (piece.direction !== incomingOf(next) || hasOtherInput(world, next, piece)) return both("unknown", "game");
        } else if (next.kind === "underground") {
            if (next.direction === piece.direction) {
                if (next.end !== "input") return both("unknown", "unread");
                if (hasOtherInput(world, next, piece)) return both("unknown", "game");
            } else if (((next.direction - piece.direction) % 8 + 8) % 8 === 4) {
                // a side load into an underground piece: the lane that reaches the hood stops, the other goes on
                const downstream = next.direction === (piece.direction + 4) % 16 ? 2 : 1;
                const blocked = next.end === "input" ? downstream : 3 - downstream;
                const ends: [LaneEnd, LaneEnd] = ["unknown", "unknown"];
                ends[blocked - 1] = "dead_end";
                return { ends, bases: ["game", "game"] };
            } else {
                return both("unknown", "unread");
            }
        } else {
            // a splitter
            return both("unknown", "game");
        }
        piece = next;
    }
}

const straightPiece = (p: BeltPiece) => p.kind === "underground" || (p.kind === "belt" && p.shape === "straight");

/** The pieces of the line from a pickup piece downstream, each with the tiles to it, until the line ends, turns into another belt or meets a piece seen before */
function lineAfter(world: BuildWorld, pickup: BeltPiece): { along: Map<number, number>; order: BeltPiece[] } {
    const along = new Map<number, number>();
    const order: BeltPiece[] = [];
    let piece = pickup;
    let tiles = 0;
    while (true) {
        along.set(piece.entity_number, tiles);
        order.push(piece);
        let next: BeltPiece | null;
        let step = 1;
        if (piece.kind === "underground" && piece.end === "input") {
            next = nextPiece(world, piece);
            if (!next) break;
            step = stepTiles(world, piece, next);
        } else {
            next = nextPiece(world, piece);
            if (!next) break;
            if ((next.kind === "belt" && incomingOf(next) !== piece.direction) || (next.kind === "underground" && next.direction !== piece.direction)) break;
        }
        if (!beltPiece(next) || along.has(next.entity_number)) break;
        tiles += step;
        piece = next;
    }
    return { along, order };
}

function pickupWay(world: BuildWorld, pickup: BeltPiece): number | false {
    if (!straightPiece(pickup)) return false;
    return lineAfter(world, pickup).order.every((p) => p.direction === pickup.direction && straightPiece(p)) ? pickup.direction : false;
}

// ---------------------------------------------------------------- copies

const fixed = (value: number) => (value + 0).toFixed(4).replace(/^-(0\.0000)$/, "$1");

type Taker = { inserter: number; x: number; y: number; like: string; piece: number };

const spot = (x: number, y: number, like: string) => `${fixed(x)},${fixed(y)},${like}`;

/** Whether the takers split into runs B, B + step, ... of one length of at least 2, each of alike takers */
function splits(takers: readonly Taker[], step: Point): boolean {
    const at = new Set<string>();
    for (const t of takers) {
        const key = spot(t.x, t.y, t.like);
        if (at.has(key)) return false;
        at.add(key);
    }
    let length: number | null = null;
    let runs = 0;
    for (const t of takers) {
        if (at.has(spot(t.x - step.x, t.y - step.y, t.like))) continue;
        let count = 0;
        while (at.has(spot(t.x + count * step.x, t.y + count * step.y, t.like))) count += 1;
        if (length === null) length = count;
        else if (length !== count) return false;
        runs += 1;
    }
    return length !== null && length >= 2 && runs * length === takers.length;
}

/**
 * Where the next copy stands, from the inserters that take from belt pieces: the shortest step that every belt line with
 * two or more takers gives (from its first taker to one alike further along) and by which all takers split into runs.
 */
function copyOffset(world: BuildWorld, takers: readonly Taker[]): Point | null {
    const starts = new Map<number, BeltPiece>();
    for (const t of takers) {
        const piece = world.piece(t.piece);
        if (beltPiece(piece)) starts.set(piece.entity_number, piece);
    }
    const lines = [...starts.values()].sort((a, b) => a.entity_number - b.entity_number).map((p) => ({ start: p.entity_number, along: lineAfter(world, p).along }));
    let common: Map<string, Point> | null = null;
    for (const line of lines) {
        if (lines.some((other) => other.start !== line.start && other.along.has(line.start))) continue;
        const onLine = takers.filter((t) => line.along.has(t.piece)).sort((a, b) => line.along.get(a.piece)! - line.along.get(b.piece)! || a.x - b.x || a.y - b.y);
        if (onLine.length < 2) continue;
        const steps = new Map<string, Point>();
        const head = onLine[0];
        for (const t of onLine.slice(1)) {
            const step = { x: t.x - head.x, y: t.y - head.y };
            if (t.like === head.like && splits(onLine, step)) steps.set(spot(step.x, step.y, ""), step);
        }
        if (common === null) common = steps;
        else for (const key of [...common.keys()]) if (!steps.has(key)) common.delete(key);
    }
    let best: Point | null = null;
    for (const step of (common ?? new Map<string, Point>()).values()) {
        const size = Math.abs(step.x) + Math.abs(step.y);
        const bestSize = best ? Math.abs(best.x) + Math.abs(best.y) : Infinity;
        if (splits(takers, step) && (best === null || size < bestSize || (size === bestSize && (step.x < best.x || (step.x === best.x && step.y < best.y))))) best = step;
    }
    return best ? { x: best.x + 0, y: best.y + 0 } : null;
}

/** The way a copy spacing points, where it lies along one axis */
function wayOf(step: Point): number | null {
    if (step.y === 0) return step.x > 0 ? 4 : 12;
    if (step.x === 0) return step.y > 0 ? 8 : 0;
    return null;
}

// ---------------------------------------------------------------- belt type

const BELT_OF: Readonly<Record<string, string>> = {
    "underground-belt": "transport-belt",
    "fast-underground-belt": "fast-transport-belt",
    "express-underground-belt": "express-transport-belt",
    "turbo-underground-belt": "turbo-transport-belt",
    splitter: "transport-belt",
    "fast-splitter": "fast-transport-belt",
    "express-splitter": "express-transport-belt",
    "turbo-splitter": "turbo-transport-belt",
    loader: "transport-belt",
    "loader-1x1": "transport-belt",
    "fast-loader": "fast-transport-belt",
    "express-loader": "express-transport-belt",
    "turbo-loader": "turbo-transport-belt",
};
const beltOf = (name: string) => (Object.prototype.hasOwnProperty.call(BELT_OF, name) ? BELT_OF[name] : name);

// ---------------------------------------------------------------- the geometry

/** The geometry of a blueprint: `entities` are the decoded entities the world was made of, `data` the prototype rows by name */
export function geometryOf(world: BuildWorld, entities: readonly BlueprintEntityRead[], data: GeometryData): BuildGeometry {
    const read = new Map<number, BlueprintEntityRead>();
    for (const e of entities) if (!read.has(e.entity_number)) read.set(e.entity_number, e);
    const rowOf = (name: string): GeometryRow | undefined => (Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined);
    const problems: GeometryProblem[] = [];
    const problem = (code: GeometryProblemCode, e: PlacedEntity) => problems.push({ code, entity_number: e.entity_number, name: e.name });

    // the vehicles and their boxes
    const vehicles: VehicleBox[] = [];
    for (const e of world.entities) {
        if (e.prototype === null || !VEHICLE_TYPES.includes(e.prototype)) continue;
        const orientation = read.get(e.entity_number)?.orientation;
        if (orientation !== undefined && !isNumber(orientation)) problem("bad-orientation", e);
        const box = vehicleBox(read.get(e.entity_number), e, rowOf(e.name) ?? { type: e.prototype });
        if (box === null) problem("no-box", e);
        vehicles.push({ entity_number: e.entity_number, name: e.name, box });
    }

    const endAt = (point: Point, self: number) => {
        const tile = tileOf(point);
        const found: { entity: PlacedEntity; vehicle: boolean }[] = [];
        const holder = world.entityAt(tile);
        if (holder && holder.entity_number !== self && targetOf(holder.prototype)) found.push({ entity: holder, vehicle: false });
        for (const v of vehicles) {
            if (v.box && v.entity_number !== self && overlapsTile(v.box, tile)) found.push({ entity: world.entity(v.entity_number)!, vehicle: true });
        }
        found.sort((a, b) => a.entity.entity_number - b.entity.entity_number);
        const one = found.length === 1 ? found[0] : null;
        const end: EndEntity | null = one ? { entity_number: one.entity.entity_number, name: one.entity.name, target: targetOf(one.entity.prototype)!, vehicle: one.vehicle } : null;
        return { end, candidates: found.map((f) => f.entity.entity_number) };
    };

    // the ends of every inserter
    const ends: InserterEnds[] = [];
    const armOf = new Map<number, Arm>();
    for (const e of world.entities) {
        if (e.prototype !== "inserter") continue;
        const row = rowOf(e.name);
        const pick = vectorOf(row?.pickup_position), put = vectorOf(row?.insert_position);
        if (!pick || !put) {
            problem("no-vectors", e);
            continue;
        }
        if (!CARDINAL.includes(e.direction)) {
            problem("bad-direction", e);
            continue;
        }
        const arm: Arm = { position: e.position, direction: e.direction, mirror: e.mirror };
        armOf.set(e.entity_number, arm);
        const at = (v: Point): Point => {
            const t = turned(v, e.direction);
            return { x: e.position.x + onGrid(t.x), y: e.position.y + onGrid(t.y) };
        };
        const pickup = at(pick), drop = at(put);
        const source = endAt(pickup, e.entity_number), sink = endAt(drop, e.entity_number);
        const vehicleRead = (end: EndEntity | null) => !end || !end.vehicle || quarterTurned(read.get(end.entity_number));
        ends.push({
            inserter: e.entity_number,
            pickup,
            drop,
            source: source.end,
            sink: sink.end,
            source_candidates: source.candidates,
            sink_candidates: sink.candidates,
            basis: vehicleRead(source.end) && vehicleRead(sink.end) ? "game" : "unread",
        });
    }

    // pickups
    const pickups: BeltPickup[] = [];
    for (const end of ends) {
        if (!end.source || end.source.target !== "belt") continue;
        const arm = armOf.get(end.inserter)!;
        const piece = world.piece(end.source.entity_number);
        const problemValue = pickupProblem(world, arm, piece);
        const near = piece ? nearLane(world, arm, piece) : null;
        const length = piece ? pickupLength(world, arm, piece) : null;
        const layout = piece ? pickupLayout(world, arm, piece) : null;
        const supply = problemValue === null && piece ? supplyProblem(world, piece) : null;
        const caseName = layout ?? problemValue ?? "none";
        const basis: Basis = READ_PICKUP_CASES.includes(caseName) ? "game" : "unread";
        pickups.push({
            inserter: end.inserter,
            piece: end.source.entity_number,
            near_lane: { value: near, basis },
            pickup_length: { value: length, basis },
            pickup_layout: { value: layout, basis },
            problem: { value: problemValue, basis },
            supply_problem: { value: supply, basis: problemValue === null ? "game" : basis },
        });
    }

    // drops
    const drops: BeltDrop[] = [];
    for (const end of ends) {
        if (!end.sink || end.sink.target !== "belt") continue;
        const piece = world.piece(end.sink.entity_number);
        if (!piece) continue;
        const arm = armOf.get(end.inserter)!;
        const c = dropCase(arm, piece, end.drop);
        let line: number | null = null;
        let readLine = false;
        if (piece.kind === "splitter") {
            line = splitterLine(piece, end.drop, arm.mirror);
            readLine = splitterDropRead(c, line);
        } else if (beltPiece(piece)) {
            line = world.laneOfDrop(end.drop, piece, arm.mirror)?.line ?? null;
            readLine = dropRead(c);
        }
        const merge = beltPiece(piece) ? sideLoadTiles(world, piece) : { tiles: null, read: true };
        drops.push({
            inserter: end.inserter,
            piece: piece.entity_number,
            line: { value: line, basis: readLine ? "game" : "unread" },
            belt_direction: { value: piece.direction, basis: "game" },
            side_load_tiles: { value: merge.tiles, basis: merge.read ? "game" : "unread" },
        });
    }

    // copies
    const takers: Taker[] = [];
    const likeness = (e: PlacedEntity, end: EndEntity | null, at: Point) => {
        if (!end) return "none";
        const target = world.entity(end.entity_number)!;
        const recipe = target.prototype === "assembling-machine" || target.prototype === "furnace" ? read.get(end.entity_number)?.recipe ?? "" : "";
        return `${target.name}/${recipe}/${fixed(target.position.x - at.x)}/${fixed(target.position.y - at.y)}`;
    };
    for (const end of ends) {
        if (!end.source || !world.piece(end.source.entity_number)) continue;
        const e = world.entity(end.inserter)!;
        const like = `${e.name}|${read.get(e.entity_number)?.quality ?? ""}|${e.direction}|${likeness(e, end.source, e.position)}|${likeness(e, end.sink, e.position)}`;
        takers.push({ inserter: end.inserter, x: e.position.x, y: e.position.y, like, piece: end.source.entity_number });
    }
    const offset = copyOffset(world, takers);
    const copy_offset: Based<Point | null> = { value: offset, basis: offset ? "unread" : "default" };

    // the copy of each inserter: how many steps back an inserter of its kind stands at each step
    const copyOf = new Map<number, number>();
    if (offset) {
        const kinds = new Map<string, number>();
        const kindOf = (e: PlacedEntity) => `${e.name}|${e.direction}|${e.mirror}`;
        for (const n of armOf.keys()) {
            const e = world.entity(n)!;
            kinds.set(spot(e.position.x, e.position.y, kindOf(e)), n);
        }
        for (const n of armOf.keys()) {
            const e = world.entity(n)!;
            let k = 0;
            while (kinds.has(spot(e.position.x - (k + 1) * offset.x, e.position.y - (k + 1) * offset.y, kindOf(e)))) k += 1;
            const after = kinds.has(spot(e.position.x + offset.x, e.position.y + offset.y, kindOf(e)));
            if (k > 0 || after) copyOf.set(n, k);
        }
    }

    // physical lines
    const parent = new Map<number, number>();
    const find = (n: number): number => {
        let r = n;
        while (parent.get(r) !== r) r = parent.get(r)!;
        parent.set(n, r);
        return r;
    };
    const join = (a: number, b: number) => {
        if (!parent.has(a) || !parent.has(b)) return;
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    };
    for (const p of world.pieces) parent.set(p.entity_number, p.entity_number);
    for (const p of world.pieces) {
        for (const q of [...p.inputs, ...p.outputs]) join(p.entity_number, q);
        if (p.partner !== null) join(p.entity_number, p.partner);
    }
    const groups = new Map<number, number[]>();
    for (const p of world.pieces) {
        const r = find(p.entity_number);
        groups.set(r, [...(groups.get(r) ?? []), p.entity_number]);
    }
    const pickupPieces = new Set(pickups.map((p) => p.piece));
    const lineOfPiece = new Map<number, number>();
    for (const [root, members] of groups) for (const m of members) lineOfPiece.set(m, root);

    // runs: the stretches of a line with no merge or split, where the copies' arms are compared (no splitter, and
    // a piece joins the next only where it feeds that one alone and that one is fed by it alone)
    const runParent = new Map<number, number>();
    const runRoot = (n: number): number => {
        let r = n;
        while (runParent.get(r) !== r) r = runParent.get(r)!;
        runParent.set(n, r);
        return r;
    };
    const joinRun = (a: number, b: number) => {
        const ra = runRoot(a), rb = runRoot(b);
        if (ra !== rb) runParent.set(Math.max(ra, rb), Math.min(ra, rb));
    };
    for (const p of world.pieces) runParent.set(p.entity_number, p.entity_number);
    for (const p of world.pieces) {
        if (p.kind === "splitter") continue;
        for (const q of p.outputs) {
            const next = world.piece(q);
            if (next && next.kind !== "splitter" && p.outputs.length === 1 && next.inputs.length === 1) joinRun(p.entity_number, q);
        }
        if (p.kind === "underground" && p.end === "input" && p.partner !== null) {
            const exit = world.piece(p.partner);
            if (exit && exit.inputs.length === 0) joinRun(p.entity_number, exit.entity_number);
        }
    }

    // which copies touch each run and lane (lane 0: a pickup, which reaches both lanes)
    const touch = new Map<string, Set<number>>();
    const touched = (run: number, lane: 1 | 2 | 0, copy: number) => {
        const key = `${run}:${lane}`;
        touch.set(key, (touch.get(key) ?? new Set()).add(copy));
    };
    const runsOfLine = new Map<number, Set<number>>();
    const onRun = (piece: number) => {
        const run = runRoot(piece);
        const line = lineOfPiece.get(piece)!;
        runsOfLine.set(line, (runsOfLine.get(line) ?? new Set()).add(run));
        return run;
    };
    for (const p of pickups) {
        const copy = copyOf.get(p.inserter);
        if (copy === undefined || !runParent.has(p.piece)) continue;
        touched(onRun(p.piece), 0, copy);
    }
    for (const d of drops) {
        const copy = copyOf.get(d.inserter);
        if (copy === undefined || !runParent.has(d.piece) || d.line.value === null) continue;
        touched(onRun(d.piece), (((d.line.value - 1) % 2) + 1) as 1 | 2, copy);
    }

    const lines: BeltLine[] = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([root, members]) => {
        members.sort(byNumber);
        const pieces = members.map((n) => world.piece(n)!);
        const typed = pieces.find((p) => p.kind === "belt" || p.kind === "underground" || p.kind === "splitter") ?? pieces[0];
        const linePickups: LinePickupPiece[] = pieces
            .filter((p) => pickupPieces.has(p.entity_number))
            .map((p) => {
                const ended = laneEnds(world, read, data, p);
                const way = pickupWay(world, p);
                return {
                    piece: p.entity_number,
                    lane_ends: [{ value: ended.ends[0], basis: ended.bases[0] }, { value: ended.ends[1], basis: ended.bases[1] }],
                    pickup_way: { value: way, basis: "game" },
                };
            });
        let flow: Based<number | null> | null = null;
        if (linePickups.length > 0) {
            const ways = [...new Set(linePickups.map((p) => p.pickup_way.value))];
            const common = ways.length === 1 && ways[0] !== false ? ways[0] : null;
            const value = offset ? wayOf(offset) : common;
            flow = { value, basis: value === null ? "default" : value === common ? "game" : "unread" };
        }
        // per run that copies touch on the lane: shared where two or more copies touch it, per copy where one does;
        // runs of one line that disagree give shared with basis default, as joined lines that disagree do
        const sharingOf = (lane: 1 | 2): Based<Sharing> => {
            if (!offset) return { value: "shared", basis: "default" };
            const values = new Set<Sharing>();
            for (const run of runsOfLine.get(root) ?? []) {
                const copies = new Set([...(touch.get(`${run}:${lane}`) ?? []), ...(touch.get(`${run}:0`) ?? [])]);
                if (copies.size > 0) values.add(copies.size >= 2 ? "shared" : "per_copy");
            }
            if (values.size !== 1) return { value: "shared", basis: "default" };
            return { value: [...values][0], basis: "unread" };
        };
        return {
            first: root,
            pieces: members,
            belt_type: { value: beltOf(typed.name), basis: "game" },
            pickups: linePickups,
            flow_direction: flow,
            sharing: [sharingOf(1), sharingOf(2)],
        };
    });

    problems.sort((a, b) => a.entity_number - b.entity_number || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    return {
        ends,
        pickups,
        drops,
        lines,
        copy_offset,
        vehicles,
        problems,
    };
}
