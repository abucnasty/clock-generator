import { describe, expect, it } from "vitest";
import { parseRecording } from "../verification/recording";
import { clockPeriods, outputInserters, outputPerPeriod } from "./recording-output";

const EMPTY_MACHINE_SAMPLES = { status: [], crafting_progress: [], bonus_progress: [], products_finished: [], inputs: {}, outputs: {} };

/** A gear machine feeding a circuit machine that is emptied into a chest, sampled once per clock value over periods of four ticks */
function recording(clock_values: number[]) {
    const samples = (held_count: number[]) => ({ held_count: held_count.slice(0, clock_values.length), held_item: [], status: [] });
    return parseRecording({
        format: "clock-generator-recording",
        version: 1,
        start_game_tick: 0,
        sample_count: clock_values.length,
        clock: { values: clock_values },
        config: { inserters: [], belts: [] },
        machines: [
            { id: 1, name: "assembling-machine-3", recipe: "iron-gear-wheel", samples: EMPTY_MACHINE_SAMPLES },
            { id: 2, name: "assembling-machine-3", recipe: "electronic-circuit", samples: EMPTY_MACHINE_SAMPLES },
        ],
        inserters: [
            // the output inserter drops two circuits in the first period, none in the second, and two right on the third's first tick
            { id: 1, name: "fast-inserter", source: { type: "machine", id: 2 }, sink: { type: "chest", id: 1 }, stack_size: 2,
              samples: samples([2, 0, 0, 0, 2, 2, 2, 2, 0, 2, 2, 2]) },
            // gears between the machines are not output
            { id: 2, name: "fast-inserter", source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 3,
              samples: samples([3, 0, 0, 3, 0, 0, 3, 0, 0, 3, 0, 0]) },
            // the gear machine's own output onto a belt is a different recipe's
            { id: 3, name: "fast-inserter", source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 }, stack_size: 1,
              samples: samples([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]) },
        ],
    });
}

describe("clockPeriods", () => {
    it("starts a period where the clock value falls, whatever the clock counts from", () => {
        expect(clockPeriods([0, 1, 2, 3, 0, 1, 2, 3])).toEqual([{ start: 0, end: 4 }, { start: 4, end: 8 }]);
        expect(clockPeriods([1, 2, 3, 4, 1, 2, 3, 4])).toEqual([{ start: 0, end: 4 }, { start: 4, end: 8 }]);
    });

    it("leaves out the ends of a recording that begins and ends in the middle of a period", () => {
        expect(clockPeriods([2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1])).toEqual([{ start: 2, end: 6 }, { start: 6, end: 10 }]);
    });

    it("has no periods without clock values", () => {
        expect(clockPeriods([])).toEqual([]);
    });
});

describe("outputInserters", () => {
    it("picks the inserters that take the recipe's product out of its machines", () => {
        expect(outputInserters(recording([]), ["electronic-circuit"]).map(inserter => inserter.id)).toEqual([1]);
        expect(outputInserters(recording([]), ["iron-gear-wheel"]).map(inserter => inserter.id)).toEqual([3]);
    });
});

describe("outputPerPeriod", () => {
    it("sums the drops of the output inserters in each period, counting a drop on the boundary in the period that starts there", () => {
        expect(outputPerPeriod(recording([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]), ["electronic-circuit"])).toEqual([
            { start: 0, end: 4, items: 2 },
            { start: 4, end: 8, items: 0 },
            { start: 8, end: 12, items: 2 },
        ]);
    });

    it("leaves out a last period the recording ends in the middle of", () => {
        expect(outputPerPeriod(recording([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3]), ["electronic-circuit"]).map(period => period.items)).toEqual([2, 0]);
    });
});
