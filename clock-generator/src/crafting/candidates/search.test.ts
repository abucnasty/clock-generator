import { describe, expect, it } from "vitest";
import { search } from "./search";

/** A search over candidates 0..n-1 in rows of `row` (0: one row), where `holds` and `confirms` say what each trial finds */
function searchOf(holds: boolean[], confirms: boolean[], in_order: boolean, row = 0, eligible?: (c: number) => boolean) {
    const quick: number[] = [];
    const confirmed: number[] = [];
    const result = search<number, { holds: boolean }, string>({
        candidates: holds.map((_, index) => index),
        quick: candidate => { quick.push(candidate); return { holds: holds[candidate] }; },
        neighbours: (a, b) => row === 0 || Math.floor(a / row) === Math.floor(b / row),
        eligible,
        tieBreak: (a, b) => a.candidate - b.candidate,
        confirm: ({ candidate }) => { confirmed.push(candidate); return confirms[candidate] ? `picked ${candidate}` : null; },
        in_order,
    });
    return { picked: result.picked, pick: result.pick?.candidate ?? null, quick, confirmed };
}

/** A small generator of the same numbers each run */
function numbers(seed: number) {
    return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe("a search in order", () => {
    it("picks what the whole search picks, on every pattern of trials", () => {
        const next = numbers(7);
        for (let round = 0; round < 3000; round++) {
            const n = 1 + Math.floor(next() * 14);
            const holds = Array.from({ length: n }, () => next() < 0.7);
            const confirms = Array.from({ length: n }, () => next() < 0.6);
            const row = next() < 0.5 ? 0 : 2 + Math.floor(next() * 4);
            const eligible = next() < 0.3 ? (c: number) => c % 3 !== 1 : undefined;
            const whole = searchOf(holds, confirms, false, row, eligible);
            const ordered = searchOf(holds, confirms, true, row, eligible);
            expect({ picked: ordered.picked, pick: ordered.pick }).toEqual({ picked: whole.picked, pick: whole.pick });
            // a candidate is confirmed once at most, and never one the whole search would not confirm
            expect(new Set(ordered.confirmed).size).toBe(ordered.confirmed.length);
            expect(ordered.confirmed.every(c => whole.confirmed.includes(c))).toBe(true);
        }
    });

    it("stops at the first candidate whose neighbours pass, as the padding search does at 1 tick", () => {
        const all = Array.from({ length: 12 }, () => true);
        const ordered = searchOf(all, all, true);
        expect(ordered.pick).toBe(1);
        expect(ordered.quick).toEqual([0, 1, 2]);
        expect(searchOf(all, all, false).quick).toHaveLength(12);
    });

    it("tries every candidate where none has its neighbours passing", () => {
        const holds = [true, false, true, false, true];
        const ordered = searchOf(holds, holds, true);
        expect(ordered.pick).toBe(0);
        expect(ordered.quick).toHaveLength(5);
    });
});
