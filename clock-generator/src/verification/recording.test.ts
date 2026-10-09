import { describe, expect, it } from "vitest";
import { parseRecording, recordedClockPeriod } from "./recording";

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
