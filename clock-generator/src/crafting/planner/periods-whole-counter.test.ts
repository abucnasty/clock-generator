import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { counterOverLimitOf, wholeCounterOf } from "../plan/clock-period-limit";
import { planOfSample } from "./plan-test-helpers";

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

    it("atlan's cell 29: P-limit prunes the periods of 576,000/997 and 1,152,000/997 ticks by their counters", async () => {
        const { plan } = await planOfSample(ConfigPaths.REAL_ATLAN_CELL29);
        const brief = plan.groups[0].periods.map(choice => [choice.swings, choice.listed_as,
            "kept" in choice ? "kept" : choice.pruned.rule === "P-limit" ? choice.pruned.terms.counter_ticks : choice.pruned.rule]);
        expect(brief).toEqual([
            [6, "main", 576_000], [7, "higher", "kept"], [8, "higher", "kept"], [5, "lower", "kept"],
            [4, "lower", 1_152_000], [3, "lower", 576_000], [2, "lower", 576_000], [1, "lower", 576_000], [6, "fractional", 576_000],
        ]);
    });
});
