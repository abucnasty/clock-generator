import { expect, test } from "vitest";
import { judgeProvenCycle } from "./long-run";
import { assessTargetProduction } from "./target-production";

test("a proven recurrence can produce below its requested target", () => {
    // An exactly repeating ten-tick hand trajectory drops two, against a target of three.
    const measured = judgeProvenCycle([[2, 2, 0, 0, 0, 0, 0, 0, 0, 0]], 10,
        {bin_ticks: 10, periods_per_bin: 1, from_bin: 0, cycle_bins: 1}, 3, 16);
    expect(assessTargetProduction(measured, true)).toEqual({
        valid: false, shortfall: 1, output_items_per_period: 2, evidence: "repeating-cycle",
    });
});

test("per-bin jitter can meet the target exactly across the complete judged cycle", () => {
    // A two-period recurrence drops zero then four. Target amount and per-bin jitter are independent.
    const measured = judgeProvenCycle([[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0]], 20,
        {bin_ticks: 10, periods_per_bin: 1, from_bin: 0, cycle_bins: 2}, 2, 4);
    expect(measured.judged).toEqual([0, 4]);
    expect(measured.keeps_up).toBe(true);
    expect(assessTargetProduction(measured, true)).toEqual({
        valid: true, shortfall: 0, output_items_per_period: 2, evidence: "repeating-cycle",
    });
    expect(assessTargetProduction(measured, false).evidence).toBe("sample");
});
