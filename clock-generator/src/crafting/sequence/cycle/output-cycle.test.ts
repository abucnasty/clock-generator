import { describe, expect, it } from "vitest";
import { fraction } from "../../../data-types/fraction";
import { OutputCyclePlan } from "./output-cycle";

describe("the ticks of a whole number of crafting cycles", () => {
    it("come out whole where the cycles are a whole number of ticks together", () => {
        // agricultural science: a hand of 16 every 19.2 ticks; 6 of them a cycle, 25 cycles a window cycle
        const six_swings = { total_duration_ticks: fraction(96, 5).multiply(6) };
        expect(OutputCyclePlan.ticksOfCycles(six_swings, 25)).toBe(2880);
        // the same in floating point is no whole number, which made the window cycle a "fractional" one
        expect(19.2 * 6 * 25).not.toBe(2880);
        const three_swings = { total_duration_ticks: fraction(96, 5).multiply(3) };
        expect(OutputCyclePlan.ticksOfCycles(three_swings, 25)).toBe(1440);
        expect(19.2 * 3 * 25).not.toBe(1440);
    });

    it("leave a period that is a fraction of a tick as it is", () => {
        // iron bacteria: 3 cycles of 576/19 ticks are 1728/19, 90.947 ticks
        const cycle = { total_duration_ticks: fraction(576, 19) };
        const window_cycle_ticks = OutputCyclePlan.ticksOfCycles(cycle, 3);
        expect(Number.isInteger(window_cycle_ticks)).toBe(false);
        expect(window_cycle_ticks).toBeCloseTo(1728 / 19, 12);
        // and 19 of those window cycles are the 1728 whole ticks its subtick clock counts
        expect(OutputCyclePlan.ticksOfCycles(cycle, 57)).toBe(1728);
        // metallurgic science: thirds
        expect(OutputCyclePlan.ticksOfCycles({ total_duration_ticks: fraction(320, 3) }, 1)).toBeCloseTo(106.6666666667, 9);
    });
});
