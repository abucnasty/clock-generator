import type { judgeLongRun } from "./long-run";

/** Measured target production is independent of whether recurrence was proved. */
export interface TargetProduction {
    valid: boolean;
    shortfall: number;
    output_items_per_window_cycle: number;
    evidence: "sample" | "repeating-cycle";
}

/**
 * A hand-sized aggregate deficit is still measured underproduction. The final checks of a clock (trial.ts) hold it to
 * the strict target amount: they conjoin this with their per-bin,
 * recurrence and recovery checks, which stay separate; the rate is the mean over the judged span, not rounded.
 */
export function assessTargetProduction(
    measured: Pick<ReturnType<typeof judgeLongRun>, "total" | "expected_total" | "output_items_per_window_cycle">,
    repetition_proven: boolean,
): TargetProduction {
    return {
        valid: measured.total >= measured.expected_total,
        shortfall: Math.max(0, measured.expected_total - measured.total),
        output_items_per_window_cycle: measured.output_items_per_window_cycle,
        evidence: repetition_proven ? "repeating-cycle" : "sample",
    };
}
