import { describe, expect, it } from "vitest";
import { CLOCK_TO_WINDOW_TICKS, parseRecording, recordedClockPeriod } from "./recording";
import { windowPositions } from "./recording-history";

const recording = (clock_values: number[]) => ({
    format: "clock-generator-recording",
    version: 1,
    start_game_tick: 0,
    sample_count: clock_values.length,
    clock: { values: clock_values },
    config: { inserters: [], belts: [] },
    inserters: [],
    machines: [],
});

describe("the recorded clock", () => {
    it("counts 1 to its period in the game and is read as 0-based positions in the period", () => {
        const parsed = parseRecording(recording([1, 2, 3, 4, 1, 2, 3, 4]));
        expect(parsed.clock?.values).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
        expect(recordedClockPeriod(parsed)).toBe(4);
    });

    it("is rejected when it reads 0, which a clock counting from 1 never does", () => {
        expect(() => parseRecording(recording([0, 1, 2, 3]))).toThrow(/counts 1 to its period/);
    });
});

describe("the positions of the windows", () => {
    it("are the recorded positions less the tick the lock filter takes, around the period", () => {
        const parsed = parseRecording(recording([1, 2, 3, 4, 1, 2, 3, 4]));
        expect(CLOCK_TO_WINDOW_TICKS).toBe(1);
        expect(windowPositions(parsed)).toEqual([3, 0, 1, 2, 3, 0, 1, 2]);
        // the periods stay where the clock wraps
        expect(parsed.clock?.values).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    });

    it("are the sample index without a clock", () => {
        const { clock: _, ...unclocked } = recording([1, 2, 3]);
        expect(windowPositions(parseRecording({ ...unclocked, sample_count: 3 }))).toEqual([0, 1, 2]);
    });
});
