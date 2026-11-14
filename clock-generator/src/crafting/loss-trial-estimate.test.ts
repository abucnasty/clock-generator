import { describe, expect, it } from "vitest";
import { lossTrialEstimateOf, ticksOfTrial, trialsOfLoss } from "./loss-trial-estimate";
import { LOSS_PLACES, LOSS_SHARES, MAX_RECOVERY_WINDOW_CYCLES } from "./disturbance-trial";

describe("the estimate of a clock's disturbance trials", () => {
    it("plans a trial for each place and share of a loss, one place each for a fixed loss or an excess, and one run with nothing cut", () => {
        expect(trialsOfLoss({ kind: "supply" })).toBe(LOSS_PLACES.length * LOSS_SHARES.length);
        expect(trialsOfLoss({ kind: "output" })).toBe(16);
        expect(trialsOfLoss({ kind: "output", fixed_loss_ticks: 600 })).toBe(LOSS_PLACES.length);
        expect(trialsOfLoss({ kind: "excess" })).toBe(4);
        expect(trialsOfLoss({ kind: "none" })).toBe(1);
    });

    it("counts a trial as its whole window of recovery, in bins of a window cycle or of the repeat of a fractional one", () => {
        expect(ticksOfTrial({ kind: "supply" }, { ticks: 1152, window_cycles: 1 })).toBe(MAX_RECOVERY_WINDOW_CYCLES * 1152);
        // a fractional window cycle that repeats in 3 window cycles of 1,001 ticks: 14 bins cover the 40 window cycles
        expect(ticksOfTrial({ kind: "supply" }, { ticks: 1001, window_cycles: 3 })).toBe(14 * 1001);
        expect(ticksOfTrial({ kind: "output", fixed_loss_ticks: 600, max_recovery_window_cycles: 16 }, { ticks: 100, window_cycles: 1 })).toBe(16 * 100 + 600);
    });

    it("multiplies the trials of every loss by the starts each is run from", () => {
        // 7 losses and the run with nothing cut, from the modeled start, 139 other lane phases and 4 other taker orders
        const planned = [{ kind: "none" as const }, ...Array.from({ length: 5 }, () => ({ kind: "supply" as const })), { kind: "output" as const }, { kind: "output" as const }];
        expect(lossTrialEstimateOf(planned, 144, { ticks: 1152, window_cycles: 1 }))
            .toEqual({ losses: 7, starts: 144, trials: (1 + 7 * 16) * 144, ticks: (1 + 7 * 16) * 144 * 40 * 1152 });
    });
});
