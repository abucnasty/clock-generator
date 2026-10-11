import { describe, expect, it } from "vitest";
import { OpenRange } from "../../data-types";
import { outputFeederWindows } from "./output-feeder-windows";

/** An output that falls to `low` when a window closes and is back at `block` `back` ticks after its end */
function outputOf(periods: number, period: number, window_ends: number[], block: number, back: number, low = 12): number[] {
    const output: number[] = [];
    for (let tick = 0; tick < periods * period; tick++) {
        const position = tick % period;
        const since = window_ends.map(end => (position - end + period) % period).filter(it => it > 0).reduce((min, it) => Math.min(min, it), Infinity);
        output.push(since === Infinity || since >= back ? block : low);
    }
    return output;
}

describe("outputFeederWindows", () => {
    const windows = [0, 96, 192, 288, 384].map(start => OpenRange.from(start, start + 36));
    const ends = windows.map(it => it.end_inclusive);

    it("enables the feeders from the start of an output window to the margin after the output is back at its block", () => {
        const output = outputOf(30, 480, ends, 28, 30);
        const result = outputFeederWindows(output, 28, windows, 480, 16)!;
        expect(result.latest_back_at_block_ticks).toBe(30);
        expect(result.enabled_after_output_window_ticks).toBe(32);
        expect(result.disabled_ticks).toBe(28);
        expect(result.windows).toEqual([0, 96, 192, 288, 384].map(start => OpenRange.from(start, start + 67)));
    });

    it("takes the latest tick of all the output windows of the run", () => {
        const output = outputOf(30, 480, ends, 28, 25);
        output[10 * 480 + 36 + 29] = 12;
        const result = outputFeederWindows(output, 28, windows, 480, 16)!;
        expect(result.latest_back_at_block_ticks).toBe(30);
    });

    it("leaves the feeders always enabled when the output is not back at its block after some output window", () => {
        const output = outputOf(30, 480, ends, 28, 30);
        output[20 * 480 + 96 + 95] = 12;
        expect(outputFeederWindows(output, 28, windows, 480, 16)).toBeNull();
    });

    it("leaves them always enabled when the stretch they would be disabled for is shorter than the least asked", () => {
        const output = outputOf(30, 480, ends, 28, 30);
        expect(outputFeederWindows(output, 28, windows, 480, 29)).toBeNull();
    });

    it("leaves them always enabled on a period that is not a whole number of ticks", () => {
        expect(outputFeederWindows(outputOf(30, 480, ends, 28, 30), 28, windows, 479.5, 16)).toBeNull();
    });

    it("does not judge the first third of the run, which carries its start-up", () => {
        const output = outputOf(30, 480, ends, 28, 30);
        output[2 * 480 + 36 + 5] = 12;
        for (let tick = 2 * 480 + 36 + 5; tick < 2 * 480 + 96; tick++) {
            output[tick] = 12;
        }
        expect(outputFeederWindows(output, 28, windows, 480, 16)).not.toBeNull();
    });

    it("wraps an enabled stretch that runs past the end of the period to the start of the next", () => {
        // the last window closes at 455: 32 enabled ticks after it end at 486, which is tick 6 of the next period
        const late = [40, 136, 232, 328, 424].map(start => OpenRange.from(start, start + 31));
        const output = outputOf(30, 480, late.map(it => it.end_inclusive), 28, 30);
        const result = outputFeederWindows(output, 28, late, 480, 16)!;
        expect(result.windows).toEqual([
            OpenRange.from(0, 6), OpenRange.from(40, 102), OpenRange.from(136, 198), OpenRange.from(232, 294),
            OpenRange.from(328, 390), OpenRange.from(424, 479),
        ]);
        expect(result.disabled_ticks).toBe(33);
    });

    it("enables from where an output window starts when it does not start at tick 0", () => {
        const shifted = [10, 106, 202, 298, 394].map(start => OpenRange.from(start, start + 36));
        const output = outputOf(30, 480, shifted.map(it => it.end_inclusive), 28, 30);
        const result = outputFeederWindows(output, 28, shifted, 480, 16)!;
        expect(result.windows).toEqual([10, 106, 202, 298, 394].map(start => OpenRange.from(start, start + 67)));
    });

    it("takes the windows of two output inserters together, and the gaps between the merged ones", () => {
        const first = [0, 96, 192, 288, 384].map(start => OpenRange.from(start, start + 36));
        const second = [0, 96, 192, 288, 384].map(start => OpenRange.from(start + 20, start + 50));
        const merged = [...first, ...second];
        const output = outputOf(30, 480, merged.map(it => it.end_inclusive), 28, 30);
        const result = outputFeederWindows(output, 28, merged, 480, 14)!;
        // the output windows are 0 to 50, so the feeders are on until 32 ticks after 50 and off for the 14 left
        expect(result.windows[0]).toEqual(OpenRange.from(0, 81));
        expect(result.disabled_ticks).toBe(14);
        expect(outputFeederWindows(output, 28, merged, 480, 15)).toBeNull();
    });

    it("judges the gap after each of unequal output windows by the next one's own start", () => {
        const unequal = [OpenRange.from(0, 36), OpenRange.from(100, 120), OpenRange.from(200, 236), OpenRange.from(300, 310), OpenRange.from(400, 420)];
        const output = outputOf(30, 480, unequal.map(it => it.end_inclusive), 28, 30);
        const result = outputFeederWindows(output, 28, unequal, 480, 16)!;
        expect(result.windows).toEqual([OpenRange.from(0, 67), OpenRange.from(100, 151), OpenRange.from(200, 267), OpenRange.from(300, 341), OpenRange.from(400, 451)]);
        expect(result.disabled_ticks).toBe(28);
    });
});
