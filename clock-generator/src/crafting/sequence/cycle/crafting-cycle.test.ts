import { describe, expect, it } from "vitest";
import { fraction } from "fractionability";
import { CraftingCyclePlan } from "./crafting-cycle";

describe("the ticks of a whole number of crafting cycles", () => {
    it("come out whole where the cycles are a whole number of ticks together", () => {
        // agricultural science: a hand of 16 every 19.2 ticks; 6 of them a cycle, 25 cycles a period
        const six_swings = { total_duration_ticks: fraction(96, 5).multiply(6) };
        expect(CraftingCyclePlan.ticksOfCycles(six_swings, 25)).toBe(2880);
        // the same in floating point is no whole number, which made the period a "fractional" one
        expect(19.2 * 6 * 25).not.toBe(2880);
        const three_swings = { total_duration_ticks: fraction(96, 5).multiply(3) };
        expect(CraftingCyclePlan.ticksOfCycles(three_swings, 25)).toBe(1440);
        expect(19.2 * 3 * 25).not.toBe(1440);
    });

    it("leave a period that is a fraction of a tick as it is", () => {
        // iron bacteria: 3 cycles of 576/19 ticks are 1728/19, 90.947 ticks
        const cycle = { total_duration_ticks: fraction(576, 19) };
        const period = CraftingCyclePlan.ticksOfCycles(cycle, 3);
        expect(Number.isInteger(period)).toBe(false);
        expect(period).toBeCloseTo(1728 / 19, 12);
        // and 19 of those periods are the 1728 whole ticks its subtick clock counts
        expect(CraftingCyclePlan.ticksOfCycles(cycle, 57)).toBe(1728);
        // metallurgic science: thirds
        expect(CraftingCyclePlan.ticksOfCycles({ total_duration_ticks: fraction(320, 3) }, 1)).toBeCloseTo(106.6666666667, 9);
    });
});
