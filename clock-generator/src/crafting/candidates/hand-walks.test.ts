import { describe, expect, it } from "vitest";
import { OpenRange } from "../../data-types";
import { handsInWindow, handsInWindows, supplyShortfall } from "./hand-walks";

describe("hands a window starts", () => {
    it("starts one hand every cycle from its first tick", () => {
        expect([0, 1, 8, 9, 41, 42].map(ticks => handsInWindow(ticks, 8))).toEqual([0, 1, 1, 2, 6, 6]);
    });

    it("counts a window that runs over the end of the period as one with the start of the next", () => {
        expect(handsInWindows([OpenRange.from(100, 111), OpenRange.from(0, 5)], 8, 112)).toBe(3);
        expect(handsInWindows([OpenRange.from(2, 19), OpenRange.from(44, 61)], 8, 112)).toBe(6);
        expect(handsInWindows(undefined, 8, 112)).toBe(14);
    });
});

describe("the supply walk", () => {
    // the grenade build's foundry: a stack of 100 plates, 3.74 a tick; four takers of five hands of 16, a cycle of 8, a period of 112
    const foundry = { stock: 100, rate: 3.7434895833333335 };
    const takers = [3, 4, 5, 6].map(n => ({ id: `inserter:${n}`, hand: 16, hands: 5, cycle: 8 }));
    const same = (...windows: [number, number][]) => new Map(takers.map(taker => [taker.id, windows.map(([from, to]) => OpenRange.from(from, to))]));

    it("finds the foundry short when the four takers draw their 320 plates together in 42 ticks", () => {
        expect(supplyShortfall(foundry, takers, same([2, 43]), 112)).toMatchObject({ hands: 5 });
    });

    it("finds it able to serve two groups of two takers half a period apart", () => {
        const windows = new Map(takers.map((taker, index) => [taker.id, [index < 2 ? OpenRange.from(2, 43) : OpenRange.from(58, 99)]]));
        expect(supplyShortfall(foundry, takers, windows, 112)).toBeNull();
    });

    it("refuses windows that start fewer hands than a taker moves", () => {
        expect(supplyShortfall(foundry, takers, same([2, 30]), 112)).toEqual({ id: "inserter:3", hands: 5, reached: 4 });
    });

    it("passes bursts that the foundry refills between", () => {
        expect(supplyShortfall(foundry, takers, same([2, 19], [44, 61], [86, 95]), 112)).toBeNull();
    });
});
