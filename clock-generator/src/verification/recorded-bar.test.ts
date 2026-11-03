import { describe, expect, it } from "vitest";
import { barAtFirstSample } from "./recorded-bar";
import type { RecordedMachine } from "./recording";

type Samples = RecordedMachine["samples"];

const samples = (status: [number, string][], crafting_progress: number[], bonus_progress: number[], products_finished: number[]): Samples =>
    ({ status, crafting_progress, bonus_progress, products_finished, inputs: {}, outputs: {} });

// the first samples of two recordings of Factorio 2.1.24 (sim-game-check's stored games)
// an electromagnetic plant at +175% on electromagnetic science packs, crafting speed 109.475, 10 s a craft
const EM_PLANT = { crafts_per_tick: 109.475 / 10 / 60, bonus_per_craft: 1.75 };
// a chemical plant at +300% on plastic bars, crafting speed 38.936, 1 s a craft: its bar fills about 1.95 a tick
const PLASTIC_PLANT = { crafts_per_tick: 38.936 / 60, bonus_per_craft: 3 };

describe("the productivity bar of a recording's first sample", () => {
    it("is the recorded value where the bar shows less than full", () => {
        expect(barAtFirstSample(samples([[0, "working"]], [0.2358, 1], [0.3537, 0.5], [10, 12]), EM_PLANT)).toEqual({ bar: 0.3537, from_sample: 0 });
    });

    it("works back what is over a full bar from the next sample that shows less", () => {
        // shown 1, then 0.4713 after filling 0.3193 and one payout with no craft finished: it held 1.152
        const em = samples([[0, "working"]], [0.3726, 0.555, 0.7375], [1, 0.4713, 0.7906], [3184, 3185, 3185]);
        expect(barAtFirstSample(em, EM_PLANT)).toEqual({ bar: 1.152, from_sample: 1 });
    });

    it("works back over several full samples, payouts being the products finished less the crafts", () => {
        // shown 1 twice, then 0.734: two crafts finished and 8 products, so 6 payouts against 3.8936 filled
        const plastic = samples([[0, "working"], [5, "full_output"]], [0.9468, 0.5957, 0.2447, 0.8936], [1, 1, 0.734, 1], [2564, 2568, 2572, 2572]);
        expect(barAtFirstSample(plastic, PLASTIC_PLANT)).toEqual({ bar: 2.8404, from_sample: 2 });
    });

    it("counts the ticks a machine stands still as no progress", () => {
        // an assembler at +100% on tungsten carbide (crafting speed 40.3125, 1 s a craft) stands at a full output with its craft
        // and bar at 1, then works: one craft finished and one payout, 0.6719 filled
        const carbide = samples([[0, "full_output"], [4, "working"]], [1, 1, 1, 1, 0.6719], [1, 1, 1, 1, 0.6719], [5394, 5394, 5394, 5394, 5396]);
        expect(barAtFirstSample(carbide, { crafts_per_tick: 40.3125 / 60, bonus_per_craft: 1 })).toEqual({ bar: 1, from_sample: 4 });
    });

    it("gives no value where a tick that is not working moves the machine", () => {
        const stopped = samples([[0, "working"], [1, "full_output"]], [0.9468, 1, 1, 1], [1, 1, 1, 0.5], [10, 12, 12, 12]);
        const result = barAtFirstSample(stopped, PLASTIC_PLANT);
        expect(result.bar).toBeNull();
        expect(result).toMatchObject({ reason: expect.stringContaining("full_output at sample 1") });
    });

    it("gives no value where the crafting progress does not follow the full rate", () => {
        const slow = samples([[0, "working"]], [0.3726, 0.45, 0.7375], [1, 0.4713, 0.7906], [3184, 3185, 3185]);
        expect(barAtFirstSample(slow, EM_PLANT).bar).toBeNull();
    });

    it("gives no value where the bar shows full in every sample searched", () => {
        expect(barAtFirstSample(samples([[0, "working"]], [0.1, 0.2], [1, 1], [0, 1]), EM_PLANT).bar).toBeNull();
    });
});
