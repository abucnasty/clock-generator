import { describe, expect, it } from "vitest";
import { OpenRange } from "../data-types";
import { placeByTurns, turnTicks } from "./turn-groups";

describe("placeByTurns", () => {
    // two groups: the output swing, then the inputs, then the drills, in the order of each turn
    const turns = [
        { start: 0, entity_ids: ["inserter:1", "inserter:3", "inserter:4", "drill:1"] },
        { start: 56, entity_ids: ["inserter:2", "inserter:5", "drill:2"] },
    ];

    it("puts the deciders of a group together, in the order of its turn, the groups in the order of their turns", () => {
        // deciders as the blueprint has them, by entity id: the drills first, then the inserters
        const deciders = [["drill:1"], ["drill:2"], ["inserter:1"], ["inserter:2"], ["inserter:3", "inserter:4"], ["inserter:5"]];
        expect(placeByTurns(deciders, turns)).toEqual([
            { turn: 0, deciders: [2, 4, 0] },
            { turn: 1, deciders: [3, 5, 1] },
        ]);
    });

    it("places a decider that serves several entities by the first of them in the turn", () => {
        // the drill's window is the input's: one decider, which stands where the earlier of the two does
        const deciders = [["drill:1", "inserter:3"], ["inserter:1"], ["inserter:2"]];
        expect(placeByTurns(deciders, turns)).toEqual([
            { turn: 0, deciders: [1, 0] },
            { turn: 1, deciders: [2] },
        ]);
    });

    it("keeps the deciders that no turn names after the groups, as a group of their own", () => {
        const deciders = [["inserter:9"], ["inserter:1"], ["inserter:2"]];
        expect(placeByTurns(deciders, turns)).toEqual([
            { turn: 0, deciders: [1] },
            { turn: 1, deciders: [2] },
            { turn: null, deciders: [0] },
        ]);
    });

    it("leaves a turn with no decider out, and has nothing to tell apart in fewer than two", () => {
        expect(placeByTurns([["inserter:1"], ["inserter:3"]], turns)).toBeNull();
        expect(placeByTurns([["inserter:9"]], turns)).toBeNull();
        expect(placeByTurns([["inserter:1"], ["inserter:2"]], [turns[0], { start: 30, entity_ids: ["inserter:7"] }, turns[1]])).toEqual([
            { turn: 0, deciders: [0] },
            { turn: 2, deciders: [1] },
        ]);
        expect(placeByTurns([["inserter:1"], ["inserter:2"]], [])).toBeNull();
    });

    it("keeps the order of the ids for deciders that stand in the same place of a turn", () => {
        const group = { start: 0, entity_ids: ["inserter:1", "inserter:2", "inserter:3"] };
        expect(placeByTurns([["inserter:3"], ["inserter:1"], ["inserter:2"], ["inserter:4"]], [group, { start: 5, entity_ids: ["inserter:4"] }])).toEqual([
            { turn: 0, deciders: [1, 2, 0] },
            { turn: 1, deciders: [3] },
        ]);
    });
});

describe("turnTicks", () => {
    const range = (start: number, end: number) => OpenRange.from(start, end);

    it("lasts from the tick the turn begins to the end of the group's last window", () => {
        expect(turnTicks(56, [range(56, 56), range(58, 99), range(58, 59)], 112)).toEqual({ start: 56, end: 99 });
        expect(turnTicks(0, [range(0, 0), range(2, 43)], 112)).toEqual({ start: 0, end: 43 });
    });

    it("runs on past the period's last tick where a window wraps over it", () => {
        // a window of 20 ticks that opens 10 ticks before the period ends and wraps: split into 102..111 and 0..9
        expect(turnTicks(100, [range(100, 100), range(102, 111), range(0, 9)], 112)).toEqual({ start: 100, end: 121 });
    });

    it("is one tick for a group whose only window is its output swing", () => {
        expect(turnTicks(56, [range(56, 56)], 112)).toEqual({ start: 56, end: 56 });
    });

    it("is never longer than the period", () => {
        expect(turnTicks(0, [range(0, 111), range(5, 20)], 112)).toEqual({ start: 0, end: 111 });
        expect(turnTicks(50, [range(0, 111)], 112)).toEqual({ start: 50, end: 161 });
    });
});
