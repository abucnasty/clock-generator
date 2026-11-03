import { afterAll, describe, expect, it, vi } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { WHOLE_COUNTER_CHECKS, counterOverLimitOf } from "../plan/clock-period-limit";
import { planOfSample } from "./plan-test-helpers";

// whole-counter checks are on under the new dispatch only, which is read from the environment when the engine loads
const dispatch = vi.hoisted(() => {
    const before = process.env.CLOCK_NEW_DISPATCH;
    process.env.CLOCK_NEW_DISPATCH = "1";
    return before;
});
afterAll(() => {
    if (dispatch === undefined) delete process.env.CLOCK_NEW_DISPATCH;
    else process.env.CLOCK_NEW_DISPATCH = dispatch;
});

describe("periods whose whole counter one run cannot hold, under whole-counter checks", () => {
    it("a fractional period's counter of 500,000 ticks or more is over the limit; a whole-tick period has no counter", () => {
        expect(WHOLE_COUNTER_CHECKS).toBe(true);
        expect(counterOverLimitOf(576_000 / 997)).toBe(576_000);
        expect(counterOverLimitOf(12_672 / 23)).toBeNull();
        expect(counterOverLimitOf(160)).toBeNull();
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
