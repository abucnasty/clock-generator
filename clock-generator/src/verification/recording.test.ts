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

describe("the belt lanes of an inserter", () => {
    const inserter = (extra: object, samples: object) => ({
        id: 1,
        name: "bulk-inserter",
        source: { type: "machine", id: 1 },
        sink: { type: "belt", id: 1 },
        stack_size: 16,
        samples: { held_count: [0, 16], held_item: [], status: [], ...samples },
        ...extra,
    });
    const withInserter = (it: object) => ({ ...recording([1, 2]), inserters: [it] });

    it("are optional, so a recording made before they were recorded still parses", () => {
        const parsed = parseRecording(withInserter(inserter({}, {})));
        expect(parsed.inserters[0].drop_lane).toBeUndefined();
        expect(parsed.inserters[0].samples.drop_lane_items).toBeUndefined();
        expect(parsed.inserters[0].samples.pickup_lane_items).toBeUndefined();
    });

    it("are read when the recording has them", () => {
        const parsed = parseRecording(withInserter(inserter(
            { drop_lane: { index: 2, length: 1 } },
            { drop_lane_items: [3, 4], drop_lane_stacks: [1, 1], drop_lane_room: [1, 0], pickup_lane_items: { "1": [0, 2], "2": [] } },
        )));
        const [read] = parsed.inserters;
        expect(read.drop_lane).toEqual({ index: 2, length: 1 });
        expect(read.samples.drop_lane_items).toEqual([3, 4]);
        expect(read.samples.drop_lane_stacks).toEqual([1, 1]);
        expect(read.samples.drop_lane_room).toEqual([1, 0]);
        expect(read.samples.pickup_lane_items).toEqual({ "1": [0, 2], "2": [] });
    });

    it("are rejected when a count is not a whole number of at least 0", () => {
        expect(() => parseRecording(withInserter(inserter({}, { drop_lane_items: [-1, 0] })))).toThrow();
        expect(() => parseRecording(withInserter(inserter({}, { drop_lane_items: [1.5, 0] })))).toThrow();
    });
});
