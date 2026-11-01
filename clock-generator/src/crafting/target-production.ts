import type { judgeLongRun } from "./long-run";

/** Measured target production is independent of whether recurrence was proved. */
export interface TargetProduction {
    valid: boolean;
    shortfall: number;
    output_items_per_period: number;
    evidence: "sample" | "repeating-cycle";
}

/**
 * Review candidate; trial verdicts do not consume it yet. A hand-sized aggregate deficit is still
 * measured underproduction. Per-bin jitter and recurrence checks remain separate, and the rate
 * is the mean over the judged span rather than the first period's amount.
 */
export function assessTargetProduction(
    measured: Pick<ReturnType<typeof judgeLongRun>, "total" | "expected_total" | "output_items_per_period">,
    repetition_proven: boolean,
): TargetProduction {
    return {
        valid: measured.total >= measured.expected_total,
        shortfall: Math.max(0, measured.expected_total - measured.total),
        output_items_per_period: measured.output_items_per_period,
        evidence: repetition_proven ? "repeating-cycle" : "sample",
    };
}
