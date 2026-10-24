import { describe, expect, it } from "vitest";
import { OpenRange } from "../../data-types";
import { underBlockMap, underBlockStretches, underBlockWindows } from "./under-block-windows";

/** The windows of an output read as underBlockMap reads it */
const windowsOf = (output: number[], block: number, period: number, min: number, length?: number) => {
    const map = underBlockMap(output, block, period);
    return map === null ? null : underBlockWindows(map, min, length);
};

/** An output at `block` but in the given ticks of every period, where it is a hand under it */
function outputOf(periods: number, period: number, under: [number, number][], block = 28): number[] {
    const output: number[] = [];
    for (let tick = 0; tick < periods * period; tick++) {
        const position = tick % period;
        output.push(under.some(([start, end]) => position >= start && position <= end) ? block - 16 : block);
    }
    return output;
}

/** The stretches of the science biochamber of the agricultural science sample: under its block from tick 25 to 62 of every 96 */
const SLOTS = [0, 96, 192, 288, 384];

describe("underBlockWindows", () => {
    it("enables the inserter where the machine was under its output block, with 2 ticks on each side", () => {
        const result = windowsOf(outputOf(30, 480, SLOTS.map(at => [at + 25, at + 62])), 28, 480, 16)!;
        expect(result.windows).toEqual(SLOTS.map(at => OpenRange.from(at + 23, at + 64)));
        expect(result.shortest_off_ticks).toBe(54);
        expect(result.longest_off_ticks).toBe(54);
    });

    it("takes the ticks under the block of every judged period together", () => {
        const output = outputOf(30, 480, SLOTS.map(at => [at + 25, at + 62]));
        // one period is under it from tick 17, a hand taken before the rest
        for (let tick = 20 * 480 + 17; tick <= 20 * 480 + 19; tick++) {
            output[tick] = 12;
        }
        const result = windowsOf(output, 28, 480, 16)!;
        // 15 to 21 and 23 to 64 are one window: a tick off between them is less than the 16 asked
        expect(result.windows[0]).toEqual(OpenRange.from(15, 64));
        expect(result.windows.slice(1)).toEqual(SLOTS.slice(1).map(at => OpenRange.from(at + 23, at + 64)));
        expect(result.shortest_off_ticks).toBe(46);
        expect(result.longest_off_ticks).toBe(54);
    });

    it("does not judge the first third of the run, which carries its start-up", () => {
        const output = outputOf(30, 480, SLOTS.map(at => [at + 25, at + 62]));
        for (let tick = 2 * 480 + 70; tick <= 2 * 480 + 80; tick++) {
            output[tick] = 12;
        }
        expect(windowsOf(output, 28, 480, 16)!.windows[0]).toEqual(OpenRange.from(23, 64));
    });

    it("leaves on a stretch off shorter than the least asked, and off one that is as long", () => {
        const output = outputOf(30, 480, SLOTS.map(at => [at + 25, at + 62]));
        // windows 23..64 of every 96: off for 54 ticks at a time
        expect(windowsOf(output, 28, 480, 54)!.windows).toHaveLength(5);
        expect(windowsOf(output, 28, 480, 55)).toBeNull();
    });

    it("wraps a stretch under the block across the end of the period", () => {
        const result = windowsOf(outputOf(30, 480, [[0, 10], [470, 479], [200, 260]]), 28, 480, 16)!;
        expect(result.windows).toEqual([OpenRange.from(0, 12), OpenRange.from(198, 262), OpenRange.from(468, 479)]);
        expect(result.longest_off_ticks).toBe(468 - 263);
    });

    it("leaves the inserter always enabled where the machine is under its block all the time, or never", () => {
        expect(windowsOf(outputOf(30, 480, [[0, 479]]), 28, 480, 16)).toBeNull();
        expect(windowsOf(outputOf(30, 480, []), 28, 480, 16)).toBeNull();
    });

    it("leaves it always enabled on a period that is not a whole number of ticks, or a run of less than two periods", () => {
        const output = outputOf(30, 480, SLOTS.map(at => [at + 25, at + 62]));
        expect(windowsOf(output, 28, 479.5, 16)).toBeNull();
        expect(windowsOf(output.slice(0, 959), 28, 480, 16)).toBeNull();
    });

    it("enables only as many ticks of each stretch as asked, from the first run under its block as long", () => {
        // every period is under it at ticks 17 and 18 too, a hand taken before the others, and back at it from 19 to 24
        const output = outputOf(30, 480, SLOTS.map(at => [at + 25, at + 62]));
        for (let period = 0; period < 30; period++) {
            output[period * 480 + 17] = 12;
            output[period * 480 + 18] = 12;
        }
        const map = underBlockMap(output, 28, 480)!;
        expect(underBlockStretches(map, 16).map(it => [it.start, it.length])).toEqual(SLOTS.map(at => [at === 0 ? 17 : at + 25, at === 0 ? 46 : 38]));
        const result = underBlockWindows(map, 16, 20)!;
        // 20 ticks from 25, and 2 on each side
        expect(result.windows).toEqual(SLOTS.map(at => OpenRange.from(at + 23, at + 46)));
        expect(result.longest_off_ticks).toBe(72);
    });

    it("starts from the longest run under its block where none is as long as asked, and keeps the window within its stretch", () => {
        const result = windowsOf(outputOf(30, 480, SLOTS.map(at => [at + 25, at + 30])), 28, 480, 16, 20)!;
        expect(result.windows).toEqual(SLOTS.map(at => OpenRange.from(at + 23, at + 32)));
    });
});
