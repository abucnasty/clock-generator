import { JoinLayout, JoinLine, SideLoad, SplitterSide } from "../../../../src/entities/belt/join/join-model";
import {
    CURVE_INNER_LINE_LENGTH, CURVE_OUTER_LINE_LENGTH, LOADER_LINE_LENGTH, SPLITTER_INPUT_LINE_LENGTH, SPLITTER_OUTPUT_LINE_LENGTH,
    STRAIGHT_LINE_LENGTH, TUNNEL_LINE_LENGTH_A_TILE, UNDERGROUND_END_LINE_LENGTH,
} from "../../../../src/entities/belt/join/join-rules";

/**
 * The copies of the belt join family: six shapes of turbo belts, built side by side by probe.lua, each copy fed by
 * script inserts (and on the turned shape by a stack inserter) from tick 120 on, with nothing built, removed or cleared
 * after the build. See README.md.
 *
 * A position is a tile of the shape: x to the east, y to the south, the shape's main line running east. A line is
 * named `x,y/n`: the piece whose top-left tile is (x, y), and its transport line n as the game numbers them.
 */

/** One entity of a shape, as the probe builds it: its position in tiles from the shape's top-left corner */
export interface ShapeEntity {
    name: string;
    x: number;
    y: number;
    /** The game's direction (2.1: 0 north, 4 east, 8 south, 12 west) */
    direction?: number;
    /** An underground belt's or a loader's type */
    type?: "input" | "output";
    /** An end chest takes what its loader brings; the inserter's chest holds a hand */
    chest?: "end" | "inserter";
}

export type ShapeName = "belt" | "exit" | "entrance" | "curve" | "splitter" | "loop";

const belt = (x: number, y: number, direction?: number): ShapeEntity => ({ name: "turbo-transport-belt", x: x + 0.5, y: y + 0.5, direction });
const underground = (x: number, y: number, type: "input" | "output", direction = 4): ShapeEntity =>
    ({ name: "turbo-underground-belt", x: x + 0.5, y: y + 0.5, direction, type });
/** A loader whose belt end is at x - 1 and whose chest is at x + 1, on row y */
const loaderAndChest = (x: number, y: number): ShapeEntity[] => [
    { name: "turbo-loader", x, y: y + 0.5, direction: 4, type: "input" },
    { name: "infinity-chest", x: x + 1.5, y: y + 0.5, chest: "end" },
];
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The two side belts of the three straight shapes: from the north onto row 4 heading south, from the south onto row 9 heading north */
const SIDE_BELTS: ShapeEntity[] = [...range(0, 3).map(y => belt(5, y, 8)), ...range(10, 13).map(y => belt(5, y, 0))];

/** The entities of each shape */
export const SHAPES: Record<ShapeName, ShapeEntity[]> = {
    // a straight belt: the main line on rows 4 and 9, a side belt onto its tile 5 from each side
    belt: [...[4, 9].flatMap(y => [...range(0, 11).map(x => belt(x, y, 4)), ...loaderAndChest(13, y)]), ...SIDE_BELTS],
    // an underground exit at tile 5, its entrance at 1
    exit: [...[4, 9].flatMap(y => [belt(0, y, 4), underground(1, y, "input"), underground(5, y, "output"), ...range(6, 11).map(x => belt(x, y, 4)),
        ...loaderAndChest(13, y)]), ...SIDE_BELTS],
    // an underground entrance at tile 5, its exit at 9
    entrance: [...[4, 9].flatMap(y => [...range(0, 4).map(x => belt(x, y, 4)), underground(5, y, "input"), underground(9, y, "output"),
        belt(10, y, 4), belt(11, y, 4), ...loaderAndChest(13, y)]), ...SIDE_BELTS],
    // a turned belt onto an underground exit at tile 9 of row 1; a stack inserter drops onto the belt before the turn
    curve: [underground(0, 1, "output"), underground(1, 1, "input"), underground(9, 1, "output"), underground(10, 1, "input"),
        underground(18, 1, "output"), ...loaderAndChest(20, 1), belt(8, 2, 4), belt(9, 2, 0),
        { name: "stack-inserter", x: 8.5, y: 1.5, direction: 0 }, { name: "infinity-chest", x: 8.5, y: 0.5, chest: "inserter" },
        { name: "small-electric-pole", x: 7.5, y: 1.5 }, { name: "electric-energy-interface", x: 6, y: 0 }],
    // a splitter on tile 8 of rows 0 and 1, eight belts before it and after it on each row
    splitter: [...[0, 1].flatMap(y => [...range(0, 7).map(x => belt(x, y, 4)), ...range(9, 16).map(x => belt(x, y, 4)), ...loaderAndChest(18, y)]),
        { name: "turbo-splitter", x: 8.5, y: 1, direction: 4 }],
    // a splitter whose left output is a loop of five left turns back onto the first tile of its right output
    loop: [underground(0, 3, "output"), underground(1, 3, "input"), underground(5, 3, "output"), underground(4, 1, "output"),
        belt(5, 1, 8), belt(5, 2, 4), { name: "turbo-splitter", x: 6.5, y: 3, direction: 4 }, belt(7, 3, 4), belt(8, 3, 4),
        ...loaderAndChest(10, 3), belt(7, 2, 0), belt(7, 1, 0), belt(7, 0, 12), belt(6, 0, 8), underground(6, 1, "input", 8),
        underground(6, 4, "output", 8), belt(6, 5, 4), belt(7, 5, 0), belt(7, 4, 0)],
};

/** Script inserts of one stream: `count` stacks of 4, every `every` ticks from `first`, at `spot` on the line (default its length less 1) */
export interface Stream {
    line: string;
    first: number;
    every: number;
    count: number;
    spot?: number;
}

/** Done by the script in a tick: an end chest blocked (it keeps what comes and its slots are full) or released (emptied, taking again) */
export interface EndAction {
    t: number;
    action: "block" | "release";
    /** The tiles of the end chests */
    chests: [number, number][];
}

export interface JoinCopy {
    name: string;
    shape: ShapeName;
    /** What the copy is for */
    about: string;
    /** Kept in recordings/ and replayed by recordings.test.ts; a measurement copy is kept only where it settles a rule */
    kept: boolean;
    streams: Stream[];
    /** The inserter's chest gets a hand at `t`, and again each time it is empty, `hands` times in all */
    hands?: { t: number; hands: number };
    ends?: EndAction[];
    /** The splitter's input and output priority */
    priority?: [SplitterSide, SplitterSide];
}

/** The last tick logged */
export const TICKS = 720;

const stream = (line: string, first: number, every: number, count: number, spot?: number): Stream => ({ line, first, every, count, spot });
/** A stream on both lanes of a piece */
const lanes = (piece: string, first: number, every: number, count: number, spot?: number): Stream[] =>
    [stream(`${piece}/1`, first, every, count, spot), stream(`${piece}/2`, first, every, count, spot)];
/** The receiving lane's stream of the straight shapes: both lanes of tile 0 on both rows */
const mainLine = (first: number, every: number, count: number, spot?: number): Stream[] =>
    [...lanes("0,4", first, every, count, spot), ...lanes("0,9", first, every, count, spot)];
/** The side stream of the straight shapes: lane `top` of the north side belt, lane `bottom` of the south one */
const sides = (top: number, bottom: number, first: number, every: number, count: number, spot?: number): Stream[] =>
    [stream(`5,0/${top}`, first, every, count, spot), stream(`5,13/${bottom}`, first, every, count, spot)];
const STRAIGHT_ENDS: [number, number][] = [[14, 4], [14, 9]];

/** The line stack's phase q on lines whose lengths are multiples of 32: its spot on a line of `length` */
const phase = (q: number, length: number) => length - 32 + q;

/**
 * The copies whose rows the reference model gave to the last tick, built again: the free landings, a landing behind a
 * stack ahead, the contest onto an exit and onto a straight belt at both side-load points, the loop, the side belt held
 * by a shut end, a backed-up line released, the end loader.
 */
const KEPT: JoinCopy[] = [
    ...(["belt", "exit", "entrance"] as const).flatMap(shape => [1, 2].map((lane): JoinCopy => ({
        name: `${shape}-free-${lane}`, shape, kept: true,
        about: `free landings of lane ${lane} of each side belt (from the north the downstream lane is 1, from the south 2)`,
        streams: sides(lane, lane, 180, 2, 8),
    }))),
    { name: "curve-free", shape: "curve", kept: true, about: "one hand of the inserter onto the turned belt, onto an empty exit",
        streams: [], hands: { t: 220, hands: 1 } },
    { name: "exit-behind-stack-ahead", shape: "exit", kept: true, about: "side stacks landing 64 behind a stack of the line, every fourth tick on both lanes",
        streams: [...mainLine(124, 4, 65), ...sides(1, 1, 180, 2, 8)] },
    { name: "curve-line-first", shape: "curve", kept: true, about: "the inserter's stacks against a line that goes first, its stacks 4 before the side-load point",
        streams: lanes("0,1", 126, 4, 49, 127), hands: { t: 175, hands: 6 } },
    { name: "curve-line-yields", shape: "curve", kept: true, about: "script stacks on the turned belt against a line that yields, its stacks 4 behind the side-load point",
        streams: [...lanes("0,1", 124, 4, 50, 103), stream("8,2/2", 180, 5, 16, 224)] },
    ...([["belt-downstream-at-point", 1, 2, 3, "a line stack at the side-load point 67 goes first"],
        ["belt-downstream-before-point", 1, 2, 2, "a line stack at 66 goes first"],
        ["belt-upstream-at-point", 2, 1, 28, "a line stack at the side-load point 188 goes first"],
        ["belt-upstream-behind-point", 2, 1, 31, "a line stack at 191 yields"]] as const).map(([name, top, bottom, q, about]): JoinCopy => ({
        name, shape: "belt", kept: true, about, streams: [...mainLine(120, 4, 41, phase(q, STRAIGHT_LINE_LENGTH)), ...sides(top, bottom, 170, 5, 12, 231)],
    })),
    { name: "loop-downstream-at-point", shape: "loop", kept: true, about: "the loop's lane 2 at its side-load point 67 against a line stack exactly there",
        streams: [...lanes("6,2", 120, 4, 41, phase(3, SPLITTER_OUTPUT_LINE_LENGTH)).map((s, i) => ({ ...s, line: `6,2/${7 + i}` })), stream("7,2/2", 170, 5, 12, 267)] },
    { name: "loop-upstream-at-point", shape: "loop", kept: true, about: "the loop's lane 1 at its side-load point 188 against a line stack exactly there",
        streams: [...lanes("6,2", 120, 4, 41, phase(28, SPLITTER_OUTPUT_LINE_LENGTH)).map((s, i) => ({ ...s, line: `6,2/${7 + i}` })), stream("7,2/1", 170, 5, 12, 95)] },
    { name: "curve-shut-end", shape: "curve", kept: true, about: "the side belt holds its stacks while the line's end is shut, then the end opens",
        streams: lanes("0,1", 121, 2, 200), hands: { t: 360, hands: 3 },
        ends: [{ t: 0, action: "block", chests: [[21, 1]] }, { t: 540, action: "release", chests: [[21, 1]] }] },
    { name: "belt-released", shape: "belt", kept: true, about: "a backed-up line with its side heads held, released",
        streams: [...mainLine(120, 2, 40, 224), ...sides(1, 2, 170, 5, 10, 231)],
        ends: [{ t: 0, action: "block", chests: STRAIGHT_ENDS }, { t: 230, action: "release", chests: STRAIGHT_ENDS }] },
    { name: "loop-lane-1", shape: "loop", kept: true, about: "the loop's lane 1 alone", streams: [stream("7,2/1", 130, 2, 4)] },
    { name: "loop-lane-2", shape: "loop", kept: true, about: "the loop's lane 2 alone", streams: [stream("7,2/2", 130, 2, 4)] },
    { name: "loop-shut-end", shape: "loop", kept: false, about: "both inputs full; the end shut and opened again: the splitter fills the loop, then one input stands. Not kept: the game differs from the model from tick 137 (README.md)",
        streams: [...lanes("0,3", 121, 2, 200), ...lanes("4,1", 121, 2, 200)],
        ends: [{ t: 160, action: "block", chests: [[11, 3]] }, { t: 380, action: "release", chests: [[11, 3]] }] },
    { name: "curve-loader", shape: "curve", kept: true, about: "the end loader takes a stack when it would be below 32; one hand into a line every fourth tick",
        streams: lanes("0,1", 124, 4, 100), hands: { t: 220, hands: 1 } },
];

/**
 * The splitter's rules on copies they were not read from: the other priorities than right and right or left and left,
 * each lane, both inputs full, the output with the priority shut, one usable output.
 */
const SPLITTER: JoinCopy[] = [
    { name: "splitter-cross-lane-1", shape: "splitter", kept: true, priority: ["left", "right"], about: "the left input's lane 1 onto the right output",
        streams: [stream("0,0/1", 120, 2, 8)] },
    { name: "splitter-cross-lane-2", shape: "splitter", kept: true, priority: ["right", "left"], about: "the right input's lane 2 onto the left output",
        streams: [stream("0,1/2", 120, 2, 8)] },
    { name: "splitter-full-left-right", shape: "splitter", kept: true, priority: ["left", "right"], about: "both inputs full on both lanes",
        streams: [...lanes("0,0", 121, 2, 150), ...lanes("0,1", 121, 2, 150)] },
    { name: "splitter-full-right-left", shape: "splitter", kept: true, priority: ["right", "left"], about: "both inputs full on both lanes",
        streams: [...lanes("0,0", 121, 2, 150), ...lanes("0,1", 121, 2, 150)] },
    { name: "splitter-output-shut", shape: "splitter", kept: false, priority: ["left", "right"], about: "the right output's end shut: one input full goes to the left output once the right one is full. Not kept: the game differs from the model from tick 262 (README.md)",
        streams: lanes("0,1", 121, 2, 200), ends: [{ t: 0, action: "block", chests: [[19, 1]] }] },
    { name: "splitter-one-output", shape: "splitter", kept: true, priority: ["left", "right"], about: "both inputs full, the right output's end shut and opened again",
        streams: [...lanes("0,0", 121, 2, 200), ...lanes("0,1", 121, 2, 200)],
        ends: [{ t: 0, action: "block", chests: [[19, 1]] }, { t: 400, action: "release", chests: [[19, 1]] }] },
];

/**
 * The boundary of the contest: a line stack just behind the side-load point at a side head's first chance, onto a
 * straight belt (68, 69, 70 behind 67; 189, 190 behind 188) and onto an exit (exactly 67, and 64 to 66). The model's
 * rule (a stack at or past the point goes first) says the side head lands in front of the first five and the line goes
 * first at the last four; the game agreed on all nine. Kept: the first stack behind each point (68, 189), and the stack
 * exactly at the exit's point (67), beside the copies at each point and behind it.
 */
const BOUNDARY: JoinCopy[] = [
    ...[4, 5, 6].map((q): JoinCopy => ({ name: `boundary-belt-${64 + q}`, shape: "belt", kept: q === 4, about: `a line stack at ${64 + q} at the side-load point 67`,
        streams: [...mainLine(120, 4, 41, phase(q, STRAIGHT_LINE_LENGTH)), ...sides(1, 2, 170, 5, 12, 231)] })),
    ...[29, 30].map((q): JoinCopy => ({ name: `boundary-belt-${160 + q}`, shape: "belt", kept: q === 29, about: `a line stack at ${160 + q} at the side-load point 188`,
        streams: [...mainLine(120, 4, 41, phase(q, STRAIGHT_LINE_LENGTH)), ...sides(2, 1, 170, 5, 12, 231)] })),
    ...[0, 1, 2, 3].map((q): JoinCopy => ({ name: `boundary-exit-${64 + q}`, shape: "exit", kept: q === 3, about: `a line stack at ${64 + q} at the exit's side-load point 67`,
        streams: [...mainLine(120, 4, 41, phase(q, STRAIGHT_LINE_LENGTH)), ...sides(1, 2, 170, 5, 12, 231)] })),
];

export const COPIES: JoinCopy[] = [...KEPT, ...SPLITTER, ...BOUNDARY];

/** The ticks of a stream's inserts */
export const streamTicks = (s: Stream): number[] => Array.from({ length: s.count }, (_, i) => s.first + i * s.every);

// ---------------------------------------------------------------------------------------------------- the model's layouts

const id = (x: number, y: number, n: number) => `${x},${y}/${n}`;

/** One lane of a row heading east: belts, an underground pair (its tunnel on the entrance's lines 3 and 4) and a loader */
function row(lines: JoinLine[], y: number, lane: 1 | 2, pieces: [number, "belt" | "entrance" | "exit"][], loader: number): void {
    lines.push({ id: id(loader, y, lane), length: LOADER_LINE_LENGTH, end: "loader" });
    let next = id(loader, y, lane);
    for (let i = pieces.length - 1; i >= 0; i--) {
        const [x, kind] = pieces[i];
        if (kind === "entrance") {
            lines.push({ id: id(x, y, lane + 2), length: TUNNEL_LINE_LENGTH_A_TILE * (pieces[i + 1][0] - x), feeds: next });
            next = id(x, y, lane + 2);
        }
        lines.push({ id: id(x, y, lane), length: kind === "belt" ? STRAIGHT_LINE_LENGTH : UNDERGROUND_END_LINE_LENGTH, feeds: next });
        next = id(x, y, lane);
    }
}

/** A side belt's lanes: its tiles from the first to the last (the last goes onto the receiving line) */
function sideBelt(lines: JoinLine[], loads: SideLoad[], tiles: [number, number][], receiver: string, piece: SideLoad["entity"],
    lanes: [1 | 2, SideLoad["lane"]][]): void {
    for (const [lane, side] of lanes) {
        const [lx, ly] = tiles[tiles.length - 1];
        lines.push({ id: id(lx, ly, lane), length: STRAIGHT_LINE_LENGTH });
        loads.push({ sender: id(lx, ly, lane), receiver, lane: side, entity: piece });
        let next = id(lx, ly, lane);
        for (const [x, y] of tiles.slice(0, -1).reverse()) {
            lines.push({ id: id(x, y, lane), length: STRAIGHT_LINE_LENGTH, feeds: next });
            next = id(x, y, lane);
        }
    }
}

function splitterLines(x: number, y: number): { inputs: Record<SplitterSide, [string, string]>; outputs: Record<SplitterSide, [string, string]> } {
    return { inputs: { left: [id(x, y, 1), id(x, y, 2)], right: [id(x, y, 3), id(x, y, 4)] },
        outputs: { left: [id(x, y, 5), id(x, y, 6)], right: [id(x, y, 7), id(x, y, 8)] } };
}

/**
 * The model's layout of a copy's shape. Of the three straight shapes, the north side belt goes onto lane 1 of row 4 and
 * the south one onto lane 2 of row 9; a side belt's lane 1 is the downstream lane from the north and lane 2 from the south.
 */
export function layoutOf(copy: JoinCopy): JoinLayout {
    const lines: JoinLine[] = [];
    const loads: SideLoad[] = [];
    const halves = [{ y: 4, tiles: range(0, 3).map(t => [5, t] as [number, number]), receiver: 1, downstream: 1 as const },
        { y: 9, tiles: range(10, 13).reverse().map(t => [5, t] as [number, number]), receiver: 2, downstream: 2 as const }];
    const other = (lane: 1 | 2): 1 | 2 => (lane === 1 ? 2 : 1);
    switch (copy.shape) {
    case "belt":
    case "exit":
    case "entrance": {
        const pieces: Record<string, [number, "belt" | "entrance" | "exit"][]> = {
            belt: range(0, 11).map(x => [x, "belt"]),
            exit: [[0, "belt"], [1, "entrance"], [5, "exit"], ...range(6, 11).map((x): [number, "belt"] => [x, "belt"])],
            entrance: [...range(0, 4).map((x): [number, "belt"] => [x, "belt"]), [5, "entrance"], [9, "exit"], [10, "belt"], [11, "belt"]],
        };
        const piece = ({ belt: "belt", exit: "underground-exit", entrance: "underground-entrance" } as const)[copy.shape];
        for (const half of halves) {
            for (const lane of [1, 2] as const) row(lines, half.y, lane, pieces[copy.shape], 12);
            sideBelt(lines, loads, half.tiles, id(5, half.y, half.receiver), piece,
                [[half.downstream, "downstream"], [other(half.downstream), "upstream"]]);
        }
        return { lines, side_loads: loads };
    }
    case "curve": {
        for (const lane of [1, 2] as const) row(lines, 1, lane, [[0, "exit"], [1, "entrance"], [9, "exit"], [10, "entrance"], [18, "exit"]], 19);
        // the turned belt's inner lane 1 is shut by the exit's hood; its outer lane 2 goes onto the exit's lane 2
        lines.push({ id: id(9, 2, 1), length: CURVE_INNER_LINE_LENGTH });
        lines.push({ id: id(9, 2, 2), length: CURVE_OUTER_LINE_LENGTH });
        loads.push({ sender: id(9, 2, 1), receiver: id(9, 1, 2), lane: "upstream", entity: "underground-exit" });
        loads.push({ sender: id(9, 2, 2), receiver: id(9, 1, 2), lane: "downstream", entity: "underground-exit" });
        for (const lane of [1, 2]) lines.push({ id: id(8, 2, lane), length: STRAIGHT_LINE_LENGTH, feeds: id(9, 2, lane) });
        return { lines, side_loads: loads };
    }
    case "splitter": {
        for (const y of [0, 1]) for (const lane of [1, 2]) {
            const input = id(8, 0, y * 2 + lane), output = id(8, 0, 4 + y * 2 + lane);
            for (const x of range(0, 7)) lines.push({ id: id(x, y, lane), length: STRAIGHT_LINE_LENGTH, feeds: x < 7 ? id(x + 1, y, lane) : input });
            lines.push({ id: input, length: SPLITTER_INPUT_LINE_LENGTH });
            lines.push({ id: output, length: SPLITTER_OUTPUT_LINE_LENGTH, feeds: id(9, y, lane) });
            for (const x of range(9, 16)) lines.push({ id: id(x, y, lane), length: STRAIGHT_LINE_LENGTH, feeds: x < 16 ? id(x + 1, y, lane) : id(17, y, lane) });
            lines.push({ id: id(17, y, lane), length: LOADER_LINE_LENGTH, end: "loader" });
        }
        return { lines, splitters: [{ ...splitterLines(8, 0), input_priority: copy.priority![0], output_priority: copy.priority![1] }] };
    }
    case "loop": {
        for (const lane of [1, 2]) {
            lines.push({ id: id(9, 3, lane), length: LOADER_LINE_LENGTH, end: "loader" });
            lines.push({ id: id(8, 3, lane), length: STRAIGHT_LINE_LENGTH, feeds: id(9, 3, lane) });
            lines.push({ id: id(7, 3, lane), length: STRAIGHT_LINE_LENGTH, feeds: id(8, 3, lane) });
        }
        // the loop, five left turns from the splitter's left output: lane 1 the inner lane, lane 2 the outer; its last
        // piece goes onto lane 2 of the right output's first tile, lane 2 from the downstream side, lane 1 from the upstream
        for (const [lane, curve, side] of [[1, CURVE_INNER_LINE_LENGTH, "upstream"], [2, CURVE_OUTER_LINE_LENGTH, "downstream"]] as const) {
            lines.push({ id: id(7, 4, lane), length: STRAIGHT_LINE_LENGTH });
            loads.push({ sender: id(7, 4, lane), receiver: id(7, 3, 2), lane: side, entity: "belt" });
            const chain: [string, number][] = [[id(7, 5, lane), curve], [id(6, 5, lane), curve], [id(6, 4, lane), UNDERGROUND_END_LINE_LENGTH],
                [id(6, 1, lane + 2), 3 * TUNNEL_LINE_LENGTH_A_TILE], [id(6, 1, lane), UNDERGROUND_END_LINE_LENGTH], [id(6, 0, lane), curve],
                [id(7, 0, lane), curve], [id(7, 1, lane), STRAIGHT_LINE_LENGTH], [id(7, 2, lane), curve]];
            let next = id(7, 4, lane);
            for (const [line, length] of chain) { lines.push({ id: line, length, feeds: next }); next = line; }
        }
        const sp = splitterLines(6, 2);
        for (const lane of [1, 2] as const) {
            lines.push({ id: sp.outputs.left[lane - 1], length: SPLITTER_OUTPUT_LINE_LENGTH, feeds: id(7, 2, lane) });
            lines.push({ id: sp.outputs.right[lane - 1], length: SPLITTER_OUTPUT_LINE_LENGTH, feeds: id(7, 3, lane) });
            lines.push({ id: sp.inputs.left[lane - 1], length: SPLITTER_INPUT_LINE_LENGTH });
            lines.push({ id: sp.inputs.right[lane - 1], length: SPLITTER_INPUT_LINE_LENGTH });
            // the left input: an exit at (4,1), a right turn at (5,1), a left turn at (5,2)
            lines.push({ id: id(5, 2, lane), length: lane === 1 ? CURVE_INNER_LINE_LENGTH : CURVE_OUTER_LINE_LENGTH, feeds: sp.inputs.left[lane - 1] });
            lines.push({ id: id(5, 1, lane), length: lane === 1 ? CURVE_OUTER_LINE_LENGTH : CURVE_INNER_LINE_LENGTH, feeds: id(5, 2, lane) });
            lines.push({ id: id(4, 1, lane), length: UNDERGROUND_END_LINE_LENGTH, feeds: id(5, 1, lane) });
            // the right input: an exit at (0,3), an entrance at (1,3), four tiles of tunnel, an exit at (5,3)
            lines.push({ id: id(5, 3, lane), length: UNDERGROUND_END_LINE_LENGTH, feeds: sp.inputs.right[lane - 1] });
            lines.push({ id: id(1, 3, lane + 2), length: 4 * TUNNEL_LINE_LENGTH_A_TILE, feeds: id(5, 3, lane) });
            lines.push({ id: id(1, 3, lane), length: UNDERGROUND_END_LINE_LENGTH, feeds: id(1, 3, lane + 2) });
            lines.push({ id: id(0, 3, lane), length: UNDERGROUND_END_LINE_LENGTH, feeds: id(1, 3, lane) });
        }
        return { lines, side_loads: loads, splitters: [{ ...sp, input_priority: "right", output_priority: "right" }] };
    }
    }
}

/** The loader's lines before an end chest, which an end action shuts or opens: the loader's piece is two tiles before the chest */
export const endLinesOf = (chest: [number, number]): string[] => [1, 2].map(lane => id(chest[0] - 2, chest[1], lane));
