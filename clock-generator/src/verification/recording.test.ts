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

describe("the recorded clock of a build's own clock", () => {
    const stamped = (values: number[], stamp: { first_value?: number; period?: number }) => ({
        ...recording(values),
        clock: { values, ...stamp },
    });

    it("may count from 0, and its values are the positions", () => {
        const parsed = parseRecording(stamped([0, 1, 2, 3, 0, 1, 2, 3], { first_value: 0, period: 4 }));
        expect(parsed.clock?.values).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
        expect(recordedClockPeriod(parsed)).toBe(4);
    });

    it("may count from 1 with a period, as a generated clock does", () => {
        const parsed = parseRecording(stamped([1, 2, 3, 1, 2, 3], { first_value: 1, period: 3 }));
        expect(parsed.clock?.values).toEqual([0, 1, 2, 0, 1, 2]);
    });

    it("needs its period when it counts from 0", () => {
        expect(() => parseRecording(stamped([0, 1, 2, 3], { first_value: 0 }))).toThrow(/needs its period/);
    });

    it("is refused when the clock signal was absent (always 0)", () => {
        expect(() => parseRecording(stamped([0, 0, 0, 0], { first_value: 0, period: 4 }))).toThrow(/shows 1/);
    });

    it("is refused when a value is skipped, repeated or starts late", () => {
        expect(() => parseRecording(stamped([0, 1, 3, 0], { first_value: 0, period: 4 }))).toThrow(/shows 2/);
        expect(() => parseRecording(stamped([0, 1, 1, 2], { first_value: 0, period: 4 }))).toThrow(/shows 2/);
        expect(() => parseRecording(stamped([1, 2, 3, 0], { first_value: 0, period: 4 }))).toThrow(/shows 0/);
    });

    it("is refused when the period is not the one named, or the recording holds part of a period", () => {
        expect(() => parseRecording(stamped([0, 1, 2, 3, 4, 5], { first_value: 0, period: 4 }))).toThrow(/shows 0/);
        expect(() => parseRecording(stamped([0, 1, 2, 3, 0, 1], { first_value: 0, period: 4 }))).toThrow(/not whole periods/);
    });

    it("leaves a generated clock as it was: no stamp, a 0 is refused", () => {
        expect(() => parseRecording(stamped([1, 2, 0, 1], {}))).toThrow(/counts 1 to its period/);
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

    it("preserves layout and model format in both recorded targets and embedded config", () => {
        const source = {type: "belt", id: 1, near_lane: 2, pickup_length: 0.5, pickup_layout: "front-exit",
            pickup_capture: {status: "supported", model: "belt", model_version: 2, entity_type: "underground-belt"}};
        const target = inserter({source, sink: {type: "machine", id: 1}}, {});
        const parsed = parseRecording({...withInserter(target), config: {inserters: [target], belts: []}});
        expect(parsed.inserters[0].source).toEqual(source);
        expect(parsed.config.inserters[0].source).toEqual(source);
    });

    it("are rejected when a count is not a whole number of at least 0", () => {
        expect(() => parseRecording(withInserter(inserter({}, { drop_lane_items: [-1, 0] })))).toThrow();
        expect(() => parseRecording(withInserter(inserter({}, { drop_lane_items: [1.5, 0] })))).toThrow();
    });
});
