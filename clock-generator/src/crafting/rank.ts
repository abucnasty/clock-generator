import { ClockAlternative, ClockAlternativeRun } from "./alternatives";
import { SerializableClockWindows } from "./clock";
import { BlueprintGenerationResult } from "./plan/plan-run";

/** What the selection compares between two alternatives, in this order; see `combineClockAlternativeRuns` */
export interface ClockRanking {
    meets_target_rate: boolean;
    /** Items per second the clock is above the target rate, or below it when negative; compared between clocks that do not meet it */
    rate_off_target: number;
    matches_belt_choice: boolean;
    rank_first: boolean;
    /** Null when they were not counted, which ranks after any count */
    wake_ups_per_minute: number | null;
    window_count: number;
}


export function clockRankingOf(alternative: ClockAlternative): ClockRanking {
    return {
        meets_target_rate: alternative.meets_target_rate,
        rate_off_target: alternative.rate_off_target,
        matches_belt_choice: alternative.matches_belt_choice,
        rank_first: alternative.rank_first,
        wake_ups_per_minute: alternative.wake_ups_per_minute,
        window_count: alternative.ranking_window_count,
    };
}

/**
 * The windows an alternative is ranked by, between clocks with the same wake-ups: those it has without the windows of
 * its output feeders, which only reduce idle checks and must never count against a clock, so its windows rank as they
 * would with its feeders always enabled.
 */
export function rankingWindowCount(
    inserter_window_count: number,
    clock_windows: SerializableClockWindows,
    output_feeders: BlueprintGenerationResult["output_feeders"],
): number {
    if (output_feeders === undefined) {
        return inserter_window_count;
    }
    const with_feeder_windows = output_feeders.inserter_ids.reduce((sum, id) => sum + (clock_windows[id]?.length ?? 0), 0);
    return inserter_window_count - with_feeder_windows + output_feeders.window_count_without_feeder_windows;
}

/**
 * Lists runs in order, skipping duplicates, and selects one. The alternatives that meet the target rate (goal 1) come
 * first; among them those made for the belt the config asks for, so that the count of wake-ups never drops belt
 * pickup slack on its own; among those the ones ranked first; then the fewest wake-ups a minute (goal 2); then the fewest windows. Of equals
 * the first listed is selected.
 *
 * Where none meets the target rate, the one whose rate is nearest to it comes first, above or below, whatever belt
 * it is made for: the build then runs as near to what was asked as any clock on offer gets it. The rest of the order
 * only parts clocks at the same rate.
 */
export function combineClockAlternativeRuns<T>(
    runs: (ClockAlternativeRun<T> | null)[],
    rankingOf: (alternative: T) => ClockRanking,
): { alternatives: T[]; selected_index: number } {
    const seen = new Set<string>();
    const alternatives: T[] = [];
    for (const run of runs) {
        if (run && !seen.has(run.signature)) {
            seen.add(run.signature);
            alternatives.push(...run.alternatives);
        }
    }
    const rank = (alternative: T): number[] => {
        const ranking = rankingOf(alternative);
        return [
            ranking.meets_target_rate ? 0 : 1,
            // to a thousandth of an item a second, as the wake-ups below
            ranking.meets_target_rate ? 0 : Math.round(Math.abs(ranking.rate_off_target) * 1000),
            ranking.matches_belt_choice ? 0 : 1,
            ranking.rank_first ? 0 : 1,
            // to a thousandth: less than that is the rounding of a division, not a difference between two clocks
            ranking.wake_ups_per_minute === null ? Infinity : Math.round(ranking.wake_ups_per_minute * 1000),
            ranking.window_count,
        ];
    };
    const beats = (a: T, b: T): boolean => {
        const [ra, rb] = [rank(a), rank(b)];
        for (let i = 0; i < ra.length; i++) {
            if (ra[i] !== rb[i]) return ra[i] < rb[i];
        }
        return false;
    };
    let selected_index = 0;
    alternatives.forEach((alternative, index) => {
        if (beats(alternative, alternatives[selected_index])) {
            selected_index = index;
        }
    });
    return { alternatives, selected_index };
}
