import { describe, expect, it } from "vitest";
import { counterOverLimitOf, wholeCounterOf } from "../plan/clock-period-limit";

describe("periods whose whole counter one run cannot hold, ", () => {
    it("a fractional period's counter of 500,000 ticks or more is over the limit; a whole-tick period has no counter", () => {
        expect(counterOverLimitOf(576_000 / 997)).toBe(576_000);
        expect(counterOverLimitOf(12_672 / 23)).toBeNull();
        expect(counterOverLimitOf(160)).toBeNull();
    });

    it("such a counter is none to check over: its clock keeps the sampled checks", () => {
        expect(wholeCounterOf(576_000 / 997)).toBeNull();
        expect(wholeCounterOf(12_672 / 23)).toEqual({ period_ticks: 12_672, scale: 23 });
        expect(wholeCounterOf(160)).toBeNull();
    });
});
