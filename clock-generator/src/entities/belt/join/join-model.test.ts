import { describe, expect, test } from "vitest"
import { JoinLayout, JoinLine, JoinModel, JoinSplitter, TickInput } from "./join-model"
import { LOADER_LINE_LENGTH, SPLITTER_INPUT_LINE_LENGTH, SPLITTER_OUTPUT_LINE_LENGTH, STRAIGHT_LINE_LENGTH, UNDERGROUND_END_LINE_LENGTH } from "./join-rules"

/** Positions in 1/256 tile: the distance to the downstream end of the stack's line */
type Row = [string, number];

/** Runs the model for ticks 0..last, with the input of each tick from `inputs`; the rows after each tick, by line and position */
function run(model: JoinModel, last: number, inputs: Record<number, TickInput> = {}): Row[][] {
    const rows: Row[][] = [];
    for (let t = 0; t <= last; t++) {
        model.tick(inputs[t] ?? {});
        rows.push(model.stacks().map((stack): Row => [stack.line, stack.position]).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]));
    }
    return rows;
}

const before = (line: string, position: number) => ({ line, position, time: "before-movement" as const });
const after = (line: string, position: number) => ({ line, position, time: "after-movement" as const });

/** A belt line of two straight lines into a loader */
const STRAIGHT: JoinLine[] = [
    { id: "a", length: STRAIGHT_LINE_LENGTH, feeds: "b" },
    { id: "b", length: STRAIGHT_LINE_LENGTH, feeds: "loader" },
    { id: "loader", length: LOADER_LINE_LENGTH, end: "loader" },
];

describe("movement", () => {
    test("a stack moves 32 a tick and goes onto the next line at that line's length less the rest of the step", () => {
        const rows = run(new JoinModel({ lines: STRAIGHT }), 18, { 0: { put_ons: [before("a", 255)] } });
        expect(rows[0]).toEqual([["a", 223]]);
        expect(rows[6]).toEqual([["a", 31]]);
        expect(rows[7]).toEqual([["b", 255]]);
        expect(rows[15]).toEqual([["loader", 127]]);
    });

    test("the loader takes a stack in the tick its position would be below 32", () => {
        const rows = run(new JoinModel({ lines: STRAIGHT }), 18, { 0: { put_ons: [before("a", 255)] } });
        expect(rows[17]).toEqual([["loader", 63]]);
        expect(rows[18]).toEqual([]);
    });

    test("at a shut end the front stack stands at 0 and every stack behind it keeps 64 behind the stack ahead, also across a cut", () => {
        const model = new JoinModel({ lines: [
            { id: "a", length: STRAIGHT_LINE_LENGTH, feeds: "b" },
            { id: "b", length: UNDERGROUND_END_LINE_LENGTH, end: "shut" },
        ] });
        const rows = run(model, 30, { 0: { put_ons: [before("a", 255)] }, 2: { put_ons: [before("a", 255)] },
            4: { put_ons: [before("a", 255)] }, 6: { put_ons: [before("a", 255)] } });
        expect(rows[30]).toEqual([["a", 0], ["a", 64], ["b", 0], ["b", 64]]);
    });

    test("a put-on before the movement moves in its own tick; one after the movement is seen where it was put", () => {
        const model = new JoinModel({ lines: STRAIGHT });
        const ids = model.tick({ put_ons: [before("a", 100), after("b", 100)] });
        expect(ids).toEqual([1, 2]);
        expect(model.stacks()).toEqual([{ id: 1, line: "a", position: 68 }, { id: 2, line: "b", position: 100 }]);
    });

    test("an end changed in a tick acts from the next; a shut loader that opens stands one tick more, takes its front stack after it, then moves", () => {
        const model = new JoinModel({ lines: [{ id: "loader", length: LOADER_LINE_LENGTH, end: "shut" }] });
        const rows = run(model, 8, { 0: { put_ons: [before("loader", 127)] }, 2: { put_ons: [before("loader", 127)] },
            5: { end_changes: [{ line: "loader", end: "loader" }] } });
        expect(rows[4]).toEqual([["loader", 0], ["loader", 64]]);
        expect(rows[5]).toEqual([["loader", 0], ["loader", 64]]);
        expect(rows[6]).toEqual([["loader", 64]]);
        expect(rows[7]).toEqual([["loader", 32]]);
        expect(rows[8]).toEqual([]);
    });

    test("a loader that is shut holds its stacks from the next tick", () => {
        const model = new JoinModel({ lines: [{ id: "loader", length: LOADER_LINE_LENGTH, end: "loader" }] });
        const rows = run(model, 4, { 0: { put_ons: [before("loader", 127)], end_changes: [{ line: "loader", end: "shut" }] } });
        expect(rows[4]).toEqual([["loader", 0]]);
    });
});

/** A sender line onto a receiving line `r` that runs into a loader; `entity` and `lane` say which side-load point */
function sideLoaded(piece: "belt" | "underground-exit" | "underground-entrance", lane: "downstream" | "upstream", receiving = STRAIGHT_LINE_LENGTH): JoinLayout {
    return {
        lines: [
            { id: "u", length: STRAIGHT_LINE_LENGTH, feeds: "r" },
            { id: "r", length: receiving, feeds: "loader" },
            { id: "loader", length: LOADER_LINE_LENGTH, end: "loader" },
            { id: "s", length: STRAIGHT_LINE_LENGTH },
        ],
        side_loads: [{ sender: "s", receiver: "r", lane, entity: piece }],
    };
}

/** The sender's stack is put on at 231: before tick 7 it stands at 7 (p 7), and tick 7 is its first chance to land */
const SENDER = { 0: { put_ons: [before("s", 231)] } };

describe("side loads", () => {
    test.each([
        ["belt", "downstream", 67 - 32 + 7],
        ["belt", "upstream", 188 - 32 + 7],
        ["underground-exit", "downstream", 67 - 32 + 7],
        ["underground-entrance", "upstream", 60 - 32 + 7],
    ] as const)("onto an empty %s from its %s side the head lands at the side-load point less 32 plus its position before the tick", (piece, lane, spot) => {
        const rows = run(new JoinModel(sideLoaded(piece, lane, piece === "belt" ? STRAIGHT_LINE_LENGTH : UNDERGROUND_END_LINE_LENGTH)), 7, SENDER);
        expect(rows[6]).toEqual([["s", 7]]);
        expect(rows[7]).toEqual([["r", spot]]);
    });

    test.each([["underground-exit", "upstream"], ["underground-entrance", "downstream"]] as const)(
        "a sender lane that the hood shuts (%s, %s side) stands at its line's end", (piece, lane) => {
            const rows = run(new JoinModel(sideLoaded(piece, lane, UNDERGROUND_END_LINE_LENGTH)), 9, SENDER);
            expect(rows[9]).toEqual([["s", 0]]);
        });

    test("the head lands 64 behind a stack of the receiving lane that is at or ahead of its spot", () => {
        const rows = run(new JoinModel(sideLoaded("belt", "downstream")), 7, { ...SENDER, 7: { put_ons: [before("r", 52)] } });
        expect(rows[7]).toEqual([["r", 20], ["r", 84]]);
    });

    test("a receiving-lane stack at the side-load point goes first, also when it is behind the head's spot: the head stands", () => {
        const rows = run(new JoinModel(sideLoaded("belt", "downstream")), 7, { ...SENDER, 7: { put_ons: [before("r", 99)] } });
        expect(rows[7]).toEqual([["r", 67], ["s", 0]]);
    });

    test("a receiving-lane stack past the side-load point and behind the head's spot yields: the head lands in front of it", () => {
        const rows = run(new JoinModel(sideLoaded("belt", "downstream")), 7, { ...SENDER, 7: { put_ons: [before("r", 103)] } });
        expect(rows[7]).toEqual([["r", 42], ["r", 71]]);
    });

    test("a spot at or past the receiving line's length is on the line before it", () => {
        const rows = run(new JoinModel(sideLoaded("underground-exit", "downstream", UNDERGROUND_END_LINE_LENGTH)), 7,
            { ...SENDER, 7: { put_ons: [before("r", 96)] } });
        expect(rows[7]).toEqual([["r", 64], ["u", 0]]);
    });
});

/** A splitter: an input line of 179 on each side and lane, fed by a belt line, and an output line of 128 into a belt and a loader */
function splitterLayout(input_priority: JoinSplitter["input_priority"], output_priority: JoinSplitter["output_priority"],
    shut: { left?: boolean; right?: boolean } = {}): JoinLayout {
    const lines: JoinLine[] = [];
    for (const side of ["left", "right"] as const) for (const lane of [1, 2]) {
        const s = `${side}${lane}`;
        lines.push({ id: `in-belt-${s}`, length: STRAIGHT_LINE_LENGTH, feeds: `in-${s}` });
        lines.push({ id: `in-${s}`, length: SPLITTER_INPUT_LINE_LENGTH });
        if (shut[side]) {
            lines.push({ id: `out-${s}`, length: SPLITTER_OUTPUT_LINE_LENGTH, end: "shut" });
        } else {
            lines.push({ id: `out-${s}`, length: SPLITTER_OUTPUT_LINE_LENGTH, feeds: `out-belt-${s}` });
            lines.push({ id: `out-belt-${s}`, length: STRAIGHT_LINE_LENGTH, feeds: `loader-${s}` });
            lines.push({ id: `loader-${s}`, length: LOADER_LINE_LENGTH, end: "loader" });
        }
    }
    return {
        lines,
        splitters: [{
            inputs: { left: ["in-left1", "in-left2"], right: ["in-right1", "in-right2"] },
            outputs: { left: ["out-left1", "out-left2"], right: ["out-right1", "out-right2"] },
            input_priority, output_priority,
        }],
    };
}

/** Stacks put on the splitter's lines where they stand at the start: after the movement */
const standing = (line: string, positions: number[]) => positions.map(position => after(line, position));

describe("a splitter", () => {
    test("a lane crosses it in one tile and leaves on the same lane: from 18 on the input line to 63 on the output line", () => {
        const rows = run(new JoinModel(splitterLayout("right", "right")), 1, { 0: { put_ons: [before("in-left1", 50), before("in-left2", 50)] } });
        expect(rows[0]).toEqual([["in-left1", 18], ["in-left2", 18]]);
        expect(rows[1]).toEqual([["out-right1", 77 - 14], ["out-right2", 77 - 14]]);
    });

    test("a stack goes to the output that has the priority", () => {
        const rows = run(new JoinModel(splitterLayout("right", "left")), 1, { 0: { put_ons: [before("in-right1", 50)] } });
        expect(rows[1]).toEqual([["out-left1", 63]]);
    });

    test("the input that has the priority goes first; the other input's stack is put 64 behind it", () => {
        for (const [priority, first, second] of [["right", 2, 1], ["left", 1, 2]] as const) {
            const model = new JoinModel(splitterLayout(priority, "right"));
            run(model, 1, { 0: { put_ons: [before("in-left1", 50), before("in-right1", 50)] } });
            expect(model.stacks()).toEqual(expect.arrayContaining([{ id: first, line: "out-right1", position: 63 }, { id: second, line: "out-right1", position: 127 }]));
        }
    });

    test("an output takes a stack at most at its back end, 127, less than 64 behind its last stack when that is where the spot falls", () => {
        const rows = run(new JoinModel(splitterLayout("right", "right", { right: true })), 1,
            { 0: { put_ons: [...standing("out-right1", [0, 64]), before("in-left1", 50)] } });
        expect(rows[1]).toEqual([["out-right1", 0], ["out-right1", 64], ["out-right1", 127]]);
    });

    test("the other output takes the stack only when the output that has the priority cannot", () => {
        const rows = run(new JoinModel(splitterLayout("right", "right", { right: true })), 1,
            { 0: { put_ons: [...standing("out-right1", [0, 64, 127]), before("in-left1", 50)] } });
        expect(rows[1]).toEqual([["out-left1", 63], ["out-right1", 0], ["out-right1", 64], ["out-right1", 127]]);
    });

    test("past its back end, an output takes a stack at the back end only when the stack's natural spot is at most 64 before it", () => {
        const rows = run(new JoinModel(splitterLayout("right", "right", { right: true })), 1,
            { 0: { put_ons: [...standing("out-right1", [0, 64]), before("in-left1", 35)] } });
        expect(rows[1]).toEqual([["out-left1", 48], ["out-right1", 0], ["out-right1", 64]]);
    });

    test("an output takes a stack 64 behind its last stack when that is on the output line, however far behind its natural spot", () => {
        const rows = run(new JoinModel(splitterLayout("right", "right")), 1, { 0: { put_ons: [after("out-right1", 95), before("in-left1", 32)] } });
        expect(rows[0]).toEqual([["in-left1", 0], ["out-right1", 95]]);
        expect(rows[1]).toEqual([["out-right1", 63], ["out-right1", 127]]);
    });

    test("a stack that no output takes stands at the end of its input line, and the stacks behind it keep 64 behind it", () => {
        const rows = run(new JoinModel(splitterLayout("right", "right", { left: true, right: true })), 3, { 0: { put_ons: [
            ...standing("out-right1", [0, 64, 127]), ...standing("out-left1", [0, 64, 127]), before("in-left1", 50), before("in-left1", 114)] } });
        expect(rows[3].filter(([line]) => line.startsWith("in-"))).toEqual([["in-left1", 0], ["in-left1", 64]]);
    });

    test("with both inputs full and both outputs free, after the first stacks each input keeps its own output", () => {
        const model = new JoinModel(splitterLayout("right", "right"));
        const from = new Map<number, string>();
        const first = new Map<number, string>();
        for (let t = 0; t < 60; t++) {
            const ids = model.tick(t % 2 === 0 && t < 40 ? { put_ons: [before("in-belt-left1", 255), before("in-belt-right1", 255)] } : {});
            if (ids.length) { from.set(ids[0], "left"); from.set(ids[1], "right"); }
            for (const stack of model.stacks()) if (stack.line.startsWith("out-") && !first.has(stack.id)) first.set(stack.id, stack.line);
        }
        const outputs = (side: string) => [...from].filter(([, s]) => s === side).map(([id]) => first.get(id));
        expect(outputs("right")).toEqual(Array(20).fill("out-right1"));
        expect(outputs("left")).toEqual(["out-right1", ...Array(19).fill("out-left1")]);
    });

    test("with one usable output and both inputs full, the input without the priority stands", () => {
        const model = new JoinModel(splitterLayout("right", "right", { left: true }));
        const put = standing("out-left1", [0, 64, 127]);
        let left = 0;
        for (let t = 0; t < 60; t++) {
            const ids = model.tick({ put_ons: [...(t === 0 ? put : []), ...(t % 2 === 0 ? [before("in-belt-left1", 255), before("in-belt-right1", 255)] : [])] });
            if (t % 2 === 0) left = ids[ids.length - 2];
        }
        const stacks = model.stacks();
        expect(stacks.filter(stack => stack.line === "in-left1").map(stack => stack.position)).toEqual([0, 64, 128]);
        expect(stacks.some(stack => stack.id === left && stack.line.startsWith("out-"))).toBe(false);
        expect(stacks.filter(stack => stack.line === "out-right1").length).toBeGreaterThan(0);
    });

    test("a splitter with no priority on either side is refused", () => {
        expect(() => new JoinModel(splitterLayout("none", "right"))).toThrow(/input priority.*none.*left or right/);
        expect(() => new JoinModel(splitterLayout("left", "none"))).toThrow(/output priority.*none.*left or right/);
    });
});

describe("the layout and the input", () => {
    test("a line with no way on (no line it feeds, no end, not a sender, not a splitter's input) is refused", () => {
        expect(() => new JoinModel({ lines: [{ id: "a", length: 256 }] })).toThrow(/a.*no way on/);
    });

    test("a line that feeds a line the layout does not have is refused", () => {
        expect(() => new JoinModel({ lines: [{ id: "a", length: 256, feeds: "b" }] })).toThrow(/b/);
    });

    test("positions and lengths are whole 1/256 tiles", () => {
        expect(() => new JoinModel({ lines: [{ id: "a", length: 255.5, end: "shut" }] })).toThrow(/whole/);
        expect(() => new JoinModel({ lines: STRAIGHT }).tick({ put_ons: [before("a", 10.5)] })).toThrow(/whole/);
        expect(() => new JoinModel({ lines: STRAIGHT }).tick({ put_ons: [before("a", 256)] })).toThrow(/a/);
    });
});
