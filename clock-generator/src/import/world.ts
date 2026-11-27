/**
 * The world of a pasted blueprint: where each entity stands, and how the belts join.
 *
 * `worldOf` turns the entities of a blueprint and the prototype rows of the game data into footprints, tiles and the
 * graph of belt pieces: curves, underground pairs, splitter sides, loaders, side loads, and the lane a drop lands on.
 * It reads only the game's own keys (`name`, `position`, `direction`, `type` and the splitter priorities) and takes
 * the prototype data as an argument. It is pure and total: the same entities and data give the same world, every
 * list it returns is sorted by a stated key, and an entity it cannot place is a listed problem, never a throw.
 *
 * Tiles are named by their top-left corner, y pointing south. A direction is the game's 16-way number: 0 north, 4 east,
 * 8 south, 12 west. A lane is the transport line of a belt piece: line 1 is its left side and line 2 its right side,
 * looking the way the piece faces.
 */

export type Point = { x: number; y: number };

/** A tile, by the whole-number coordinates of its top-left corner */
export type Tile = { x: number; y: number };

/**
 * The keys of a blueprint entity that the world reads, with the game's names. `direction` is north when left out.
 * `type` is that of an underground belt or a loader and `input_priority` and `output_priority` are a splitter's; the
 * values are the game's own strings, and the world fills in what the game leaves out.
 */
export type WorldEntity = {
    entity_number: number;
    name: string;
    position: Point;
    direction?: number;
    mirror?: boolean;
    type?: string;
    input_priority?: string;
    output_priority?: string;
};

/** What the world needs of one prototype: its game type, its size in tiles facing north, and the reach of an underground belt */
export type PrototypeRow = {
    type: string;
    tile_width?: number;
    tile_height?: number;
    max_distance?: number;
};

/** The prototype rows by entity name */
export type WorldData = Readonly<Record<string, PrototypeRow>>;

/** What the Clock Generator does with an entity: a machine crafts, a belt carries, a chest holds; any other entity is none */
export type EntityKind = "machine" | "belt" | "chest" | "none";

export type PlacedEntity = {
    entity_number: number;
    name: string;
    /** The prototype's game type, or null for a name the data has no row for */
    prototype: string | null;
    kind: EntityKind;
    position: Point;
    /** North (0) when the blueprint leaves it out */
    direction: number;
    /** false when the blueprint leaves it out */
    mirror: boolean;
    /** False for an entity that has no place on the grid: a name with no data row or tile size, and a vehicle */
    placed: boolean;
    /** The tiles it stands on, sorted by x and then y, so the first is its top-left tile; empty when not placed */
    tiles: Tile[];
};

export type PieceKind = "belt" | "underground" | "splitter" | "loader";
export type BeltShape = "straight" | "left" | "right";
export type EndType = "input" | "output";

/** A belt piece that sends its items into another: `lane` is the receiving piece's lane, `passing` the sender's own lanes that get there */
export type SideLoad = {
    receiver: number;
    lane: 1 | 2;
    passing: (1 | 2)[];
    /** null when the game's reads of the output side hold the case; else what is not held */
    mark: string | null;
};

export type SplitterSides = {
    /** The tile of the left half and of the right half, looking the way the splitter faces */
    left: Tile;
    right: Tile;
    input_priority: string;
    output_priority: string;
    /** The piece that feeds each half, [left, right], as an entity number; null where none does */
    inputs: [number | null, number | null];
    /** The piece each half feeds, [left, right]; null where none */
    outputs: [number | null, number | null];
};

export type LoaderEnds = {
    /** The tile the belt reaches the loader at, and the tile of its front */
    back: Tile;
    front: Tile;
    /** The entity on the tile one beyond the front, as an entity number; null where none stands */
    chest: number | null;
};

export type BeltPiece = {
    entity_number: number;
    name: string;
    kind: PieceKind;
    /** One of 0, 4, 8 and 12 */
    direction: number;
    /** An underground belt's or a loader's `type`, `input` when the blueprint leaves it out; null for the others */
    end: EndType | null;
    /** A belt's shape; null for the others */
    shape: BeltShape | null;
    /** The other end of an underground pair, as an entity number */
    partner: number | null;
    /** The pieces that feed this one and the ones it feeds, as entity numbers, sorted and without repeats */
    inputs: number[];
    outputs: number[];
    /** What this piece sends into others' sides, sorted by receiver and then lane */
    side_loads: SideLoad[];
    splitter: SplitterSides | null;
    loader: LoaderEnds | null;
};

export type WorldProblemCode =
    | "bad-entity"
    | "duplicate-number"
    | "unknown-name"
    | "no-size"
    | "bad-direction"
    | "bad-type"
    | "no-reach"
    | "off-grid"
    | "overlap";

/** `other` is the entity that holds the tile of an overlap, and `tile` that tile */
export type WorldProblem = {
    code: WorldProblemCode;
    entity_number: number;
    name: string;
    other?: number;
    tile?: Tile;
};

/** The lane a drop lands on, and the mark of a drop whose rule the game's reads of the output side do not hold */
export type DropLane = { line: 1 | 2; mark: string | null };

export type BuildWorld = {
    /** Sorted by entity number */
    entities: PlacedEntity[];
    /** The belt pieces, sorted by entity number */
    pieces: BeltPiece[];
    /** Sorted by entity number, then code, then tile */
    problems: WorldProblem[];
    entity(entityNumber: number): PlacedEntity | undefined;
    piece(entityNumber: number): BeltPiece | undefined;
    /** The entity on a tile; where two overlap, the one with the lower entity number */
    entityAt(tile: Tile): PlacedEntity | undefined;
    /** Where the items of a piece go next: an underground entrance goes to its exit, any other piece to the pieces it feeds */
    lineAfter(piece: BeltPiece): BeltPiece[];
    inputsOf(piece: BeltPiece): BeltPiece[];
    /** The lane of a belt piece that a drop at `point` lands on; null on a splitter, which this does not read */
    laneOfDrop(point: Point, piece: BeltPiece, mirrored: boolean): DropLane | null;
};

// The pin is the set of 596 comparisons of this world with the game's reads of the output side of the automation
// science 240 sample (see the test of this file).

/** The mark of a side load whose case the game's reads of the output side do not hold */
export const SIDE_LOAD_MARK = "outside the 596-read pin; a game check agrees, its reads not kept, game version not stated";
/** The mark of a drop onto a curve or onto the end of an underground belt */
export const OUTSIDE_THE_PIN = "outside the 596-read pin";

const MACHINE_TYPES = ["assembling-machine", "furnace", "lab"];
const BELT_TYPES = ["transport-belt", "underground-belt", "splitter", "loader", "loader-1x1"];
const CHEST_TYPES = ["container", "logistic-container", "linked-container", "infinity-container", "car", "cargo-wagon", "rocket-silo"];
/** Vehicles stand anywhere: they are passed through, not placed */
const OFF_GRID_TYPES = ["car", "cargo-wagon"];
const PIECE_KINDS: Record<string, PieceKind> = {
    "transport-belt": "belt",
    "underground-belt": "underground",
    splitter: "splitter",
    loader: "loader",
};

/** What the Clock Generator does with an entity of this prototype type */
export function kindOfType(type: string): EntityKind {
    if (MACHINE_TYPES.includes(type)) return "machine";
    if (BELT_TYPES.includes(type)) return "belt";
    if (CHEST_TYPES.includes(type)) return "chest";
    return "none";
}

/** The tile a point is in */
export function tileOf(point: Point): Tile {
    return { x: Math.floor(point.x), y: Math.floor(point.y) };
}

const RUN: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };
const CARDINAL = [0, 4, 8, 12];
const turnLeft = (d: number) => (d + 12) % 16;
const turnRight = (d: number) => (d + 4) % 16;
const behind = (d: number) => (d + 8) % 16;
const step = (tile: Tile, d: number, count = 1): Tile => ({ x: tile.x + RUN[d][0] * count, y: tile.y + RUN[d][1] * count });
const key = (tile: Tile) => `${tile.x},${tile.y}`;
const byNumber = (a: { entity_number: number }, b: { entity_number: number }) => a.entity_number - b.entity_number;

/** A drop this close to the centre line of its tile is on it: one step of the game's position grid, 1/256 of a tile */
const ON_CENTRE_LINE = 1 / 256;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The lane of a belt piece that a drop lands on (see `BuildWorld.laneOfDrop`) */
export function laneOfDrop(point: Point, piece: BeltPiece, mirrored: boolean): DropLane | null {
    if (piece.kind === "splitter") return null;
    const run = RUN[piece.direction];
    if (!run) return null;
    const dx = point.x - (Math.floor(point.x) + 0.5);
    const dy = point.y - (Math.floor(point.y) + 0.5);
    // positive when the point is on the left of the centre line, looking the way the piece faces
    let left = dx * run[1] - dy * run[0];
    const curved = piece.kind === "belt" && piece.shape !== null && piece.shape !== "straight";
    if (Math.abs(left) < ON_CENTRE_LINE && curved) {
        // on a curve a drop on the centre line takes the side it has looking the way the items come in
        const incoming = RUN[(piece.direction + (piece.shape === "right" ? 12 : 4)) % 16];
        left = dx * incoming[1] - dy * incoming[0];
    }
    const line: 1 | 2 = Math.abs(left) < ON_CENTRE_LINE ? (mirrored ? 1 : 2) : left > 0 ? 1 : 2;
    return { line, mark: curved || piece.kind === "underground" ? OUTSIDE_THE_PIN : null };
}

/** A belt piece while the graph is built */
type Work = {
    entity: PlacedEntity;
    kind: PieceKind;
    direction: number;
    end: EndType | null;
    reach: number | undefined;
    shape: BeltShape | null;
    partner: Work | null;
    inputs: Set<Work>;
    outputs: Set<Work>;
    sideLoads: { receiver: Work; lane: 1 | 2; passing: (1 | 2)[] }[];
    inputPriority: string;
    outputPriority: string;
    halves: { left: Tile; right: Tile } | null;
    ends: { back: Tile; front: Tile } | null;
};

/** One belt piece pushing into the tile in front of it: `how` is how the receiver takes it */
type Feed = { source: Work; receiver: Work; half: "left" | "right" | null; how: "behind" | "side" | "curve"; direction: number; tile: Tile };

/** The world of these entities. `data` holds a row for each entity name the blueprint uses. */
export function worldOf(entities: readonly WorldEntity[], data: WorldData): BuildWorld {
    const problems: WorldProblem[] = [];
    const placed: PlacedEntity[] = [];
    const seen = new Set<number>();
    const rowOf = (name: string): PrototypeRow | undefined => (Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined);

    // the entities, each with its kind and tiles
    const sources = new Map<PlacedEntity, WorldEntity>();
    for (const raw of entities as readonly unknown[]) {
        const entity = isRecord(raw) ? raw : {};
        const number = isNumber(entity.entity_number) ? entity.entity_number : 0;
        const name = typeof entity.name === "string" ? entity.name : "";
        const position = isRecord(entity.position) ? entity.position : {};
        if (!isNumber(entity.entity_number) || typeof entity.name !== "string" || !isNumber(position.x) || !isNumber(position.y)) {
            problems.push({ code: "bad-entity", entity_number: number, name });
            continue;
        }
        if (seen.has(number)) {
            problems.push({ code: "duplicate-number", entity_number: number, name });
            continue;
        }
        seen.add(number);
        const row = rowOf(name);
        let direction = isNumber(entity.direction) ? entity.direction : 0;
        if (!Number.isInteger(direction) || direction < 0 || direction > 15) {
            problems.push({ code: "bad-direction", entity_number: number, name });
            direction = 0;
        }
        const made: PlacedEntity = {
            entity_number: number,
            name,
            prototype: row ? row.type : null,
            kind: row ? kindOfType(row.type) : "none",
            position: { x: position.x, y: position.y },
            direction,
            mirror: entity.mirror === true,
            placed: false,
            tiles: [],
        };
        if (!row) {
            problems.push({ code: "unknown-name", entity_number: number, name });
        } else if (!OFF_GRID_TYPES.includes(row.type)) {
            const { tile_width: width, tile_height: height } = row;
            if (!isNumber(width) || !isNumber(height) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
                problems.push({ code: "no-size", entity_number: number, name });
            } else {
                const turned = direction === 4 || direction === 12;
                const [w, h] = turned ? [height, width] : [width, height];
                const left = made.position.x - w / 2;
                const top = made.position.y - h / 2;
                if (!Number.isInteger(left) || !Number.isInteger(top)) problems.push({ code: "off-grid", entity_number: number, name });
                for (let i = 0; i < w; i += 1) {
                    for (let j = 0; j < h; j += 1) made.tiles.push({ x: Math.floor(left) + i, y: Math.floor(top) + j });
                }
                made.placed = true;
            }
        }
        placed.push(made);
        sources.set(made, entity as WorldEntity);
    }
    placed.sort(byNumber);

    // who stands on which tile
    const at = new Map<string, PlacedEntity>();
    for (const entity of placed) {
        for (const tile of entity.tiles) {
            const holder = at.get(key(tile));
            if (holder) {
                problems.push({ code: "overlap", entity_number: entity.entity_number, name: entity.name, other: holder.entity_number, tile });
            } else {
                at.set(key(tile), entity);
            }
        }
    }
    const entityAt = (tile: Tile) => at.get(key(tile));

    // the belt pieces
    const works: Work[] = [];
    const workOf = new Map<PlacedEntity, Work>();
    for (const entity of placed) {
        const kind = entity.prototype === null ? undefined : PIECE_KINDS[entity.prototype];
        if (!kind || !entity.placed) continue;
        if (!CARDINAL.includes(entity.direction)) {
            problems.push({ code: "bad-direction", entity_number: entity.entity_number, name: entity.name });
            continue;
        }
        const raw = sources.get(entity);
        let end: EndType | null = null;
        if (kind === "underground" || kind === "loader") {
            end = "input";
            if (raw?.type === "output") end = "output";
            else if (raw?.type !== undefined && raw.type !== "input") problems.push({ code: "bad-type", entity_number: entity.entity_number, name: entity.name });
        }
        const work: Work = {
            entity,
            kind,
            direction: entity.direction,
            end,
            reach: rowOf(entity.name)?.max_distance,
            shape: null,
            partner: null,
            inputs: new Set(),
            outputs: new Set(),
            sideLoads: [],
            inputPriority: raw?.input_priority ?? "none",
            outputPriority: raw?.output_priority ?? "none",
            halves: null,
            ends: null,
        };
        const { x: cx, y: cy } = entity.position;
        if (kind === "splitter") {
            const lv = RUN[turnLeft(entity.direction)];
            const rv = RUN[turnRight(entity.direction)];
            work.halves = {
                left: { x: Math.floor(cx + lv[0] * 0.5 - 0.5), y: Math.floor(cy + lv[1] * 0.5 - 0.5) },
                right: { x: Math.floor(cx + rv[0] * 0.5 - 0.5), y: Math.floor(cy + rv[1] * 0.5 - 0.5) },
            };
        }
        if (kind === "loader") {
            const v = RUN[entity.direction];
            work.ends = {
                back: { x: Math.floor(cx - v[0] * 0.5 - 0.5), y: Math.floor(cy - v[1] * 0.5 - 0.5) },
                front: { x: Math.floor(cx + v[0] * 0.5 - 0.5), y: Math.floor(cy + v[1] * 0.5 - 0.5) },
            };
        }
        works.push(work);
        workOf.set(entity, work);
    }
    const workAt = (tile: Tile): Work | undefined => {
        const entity = entityAt(tile);
        return entity ? workOf.get(entity) : undefined;
    };

    // an underground entrance pairs with the first underground belt of its name on its line, if that is an exit facing the same way
    for (const p of works) {
        if (p.kind !== "underground" || p.end !== "input") continue;
        if (p.reach === undefined || !isNumber(p.reach)) {
            problems.push({ code: "no-reach", entity_number: p.entity.entity_number, name: p.entity.name });
            continue;
        }
        for (let k = 1; k <= p.reach; k += 1) {
            const q = entityAt(step(p.entity.tiles[0], p.direction, k));
            if (q && q.name === p.entity.name) {
                const other = workOf.get(q);
                if (other && (other.direction === p.direction || other.direction === behind(p.direction))) {
                    if (other.end === "output" && other.direction === p.direction) {
                        p.partner = other;
                        other.partner = p;
                    }
                    break;
                }
            }
        }
    }

    // each belt, exit and splitter half pushes into the tile in front of it
    const feeds: Feed[] = [];
    for (const p of works) {
        const pushes: { tile: Tile; half: "left" | "right" | null }[] = [];
        if (p.kind === "belt" || (p.kind === "underground" && p.end === "output")) pushes.push({ tile: p.entity.tiles[0], half: null });
        if (p.kind === "splitter" && p.halves) pushes.push({ tile: p.halves.left, half: "left" }, { tile: p.halves.right, half: "right" });
        for (const { tile, half } of pushes) {
            const d = p.direction;
            const target = step(tile, d);
            const r = workAt(target);
            if (!r) continue;
            let how: "behind" | "side" | null = null;
            if (r.kind === "belt" || (r.kind === "underground" && r.end === "input")) {
                how = d === r.direction ? "behind" : d === behind(r.direction) ? null : "side";
            } else if (r.kind === "underground") {
                how = d === r.direction || d === behind(r.direction) ? null : "side";
            } else if (r.kind === "splitter") {
                how = d === r.direction ? "behind" : null;
            } else if (r.kind === "loader" && r.ends) {
                how = d === r.direction && key(target) === key(r.ends.back) && r.end === "input" ? "behind" : null;
            }
            if (how) feeds.push({ source: p, receiver: r, half, how, direction: d, tile: target });
        }
    }

    // the shape of each belt: one feeder from a side and none from behind makes a curve
    for (const r of works) {
        if (r.kind !== "belt") continue;
        const mine = feeds.filter((f) => f.receiver === r);
        const fromBehind = mine.filter((f) => f.how === "behind");
        const fromSide = mine.filter((f) => f.how === "side");
        if (fromBehind.length === 0 && fromSide.length === 1) {
            r.shape = r.direction === turnRight(fromSide[0].direction) ? "right" : "left";
            fromSide[0].how = "curve";
        } else {
            r.shape = "straight";
        }
    }

    // the graph, and the lane each side load lands on
    for (const { source: p, receiver: r, how, direction: d } of feeds) {
        p.outputs.add(r);
        r.inputs.add(p);
        if (how !== "side") continue;
        const lane: 1 | 2 = d === turnRight(r.direction) ? 1 : 2;
        const passing: (1 | 2)[] = [];
        for (const [line, s] of [[1, turnLeft(d)], [2, turnRight(d)]] as const) {
            if (r.kind === "belt") passing.push(line);
            else if (r.kind === "underground" && r.end === "output" && s === r.direction) passing.push(line);
            else if (r.kind === "underground" && r.end === "input" && s === behind(r.direction)) passing.push(line);
        }
        p.sideLoads.push({ receiver: r, lane, passing });
    }

    // the finished pieces
    const numbers = (set: Set<Work>) => [...set].map((w) => w.entity.entity_number).sort((a, b) => a - b);
    const marked = (receiver: Work, lane: 1 | 2): string | null => {
        const unheld = (receiver.kind === "belt" && lane === 1) || (receiver.kind === "underground" && receiver.end === "output" && lane === 1) || (receiver.kind === "underground" && receiver.end === "input" && lane === 2);
        return unheld ? SIDE_LOAD_MARK : null;
    };
    const pieces: BeltPiece[] = works.map((p) => {
        const number = p.entity.entity_number;
        let splitter: SplitterSides | null = null;
        if (p.halves) {
            const halves = p.halves;
            const fed = (half: Tile) => feeds.filter((f) => f.receiver === p && key(f.tile) === key(half)).map((f) => f.source.entity.entity_number).sort((a, b) => a - b)[0] ?? null;
            const feeding = (half: "left" | "right") => feeds.find((f) => f.source === p && f.half === half)?.receiver.entity.entity_number ?? null;
            splitter = {
                left: halves.left,
                right: halves.right,
                input_priority: p.inputPriority,
                output_priority: p.outputPriority,
                inputs: [fed(halves.left), fed(halves.right)],
                outputs: [feeding("left"), feeding("right")],
            };
        }
        const loader: LoaderEnds | null = p.ends ? { back: p.ends.back, front: p.ends.front, chest: entityAt(step(p.ends.front, p.direction))?.entity_number ?? null } : null;
        return {
            entity_number: number,
            name: p.entity.name,
            kind: p.kind,
            direction: p.direction,
            end: p.end,
            shape: p.shape,
            partner: p.partner ? p.partner.entity.entity_number : null,
            inputs: numbers(p.inputs),
            outputs: numbers(p.outputs),
            side_loads: p.sideLoads
                .map((s) => ({ receiver: s.receiver.entity.entity_number, lane: s.lane, passing: s.passing, mark: marked(s.receiver, s.lane) }))
                .sort((a, b) => a.receiver - b.receiver || a.lane - b.lane),
            splitter,
            loader,
        };
    });
    const entityByNumber = new Map(placed.map((e) => [e.entity_number, e]));
    const pieceByNumber = new Map(pieces.map((p) => [p.entity_number, p]));
    const piece = (entityNumber: number) => pieceByNumber.get(entityNumber);
    const pieceList = (numbersOf: number[]) => numbersOf.flatMap((n) => piece(n) ?? []);

    problems.sort(
        (a, b) =>
            a.entity_number - b.entity_number ||
            (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
            (a.tile?.x ?? 0) - (b.tile?.x ?? 0) ||
            (a.tile?.y ?? 0) - (b.tile?.y ?? 0),
    );
    return {
        entities: placed,
        pieces,
        problems,
        entity: (entityNumber) => entityByNumber.get(entityNumber),
        piece,
        entityAt,
        lineAfter: (p) => (p.kind === "underground" && p.end === "input" ? pieceList(p.partner === null ? [] : [p.partner]) : pieceList(p.outputs)),
        inputsOf: (p) => pieceList(p.inputs),
        laneOfDrop,
    };
}
