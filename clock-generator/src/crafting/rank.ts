import { Config } from "../config";
import { ClockAlternative, ClockAlternativeRun } from "./alternatives";
import { SerializableClockWindows } from "./clock";
import { BlueprintGenerationResult } from "./plan/plan-run";

/**
 * What the selection compares between two alternatives, in this order (see `combineClockAlternativeRuns`), worked out
 * from a clock's assessment, its belt, and the build's deadlock risks by `rankingOf`.
 */
export interface ClockRanking {
    /**
     * Goal 1: the clock is stable and runs the build at the target rate, which a clock with a rounded period does not.
     * On a build with a deadlock risk a clock that holds its expected output at the target rate meets it, whether it
     * gets back from every backpressure loss or not: the trials do not see the deadlock, so what they say of the
     * clocks of such a build does not decide which is selected (GOALS.md, "Two inserters that bring the same item").
     */
    meets_target_rate: boolean;
    /**
     * Items per second the clock is above the target rate; negative when it is short of it. Where no clock meets
     * the target rate, the one nearest to it is selected.
     */
    rate_off_target: number;
    /**
     * The clock holds its expected output from the start the generator gives it: its verdict is not "unstable". Where
     * no clock meets the target rate and two are equally near it, the one that holds comes first: a clock that only
     * fails to get back from a loss is nearer to goal 1 than one that drifts from a clean start (GOALS.md, "Wake-ups").
     */
    holds_expected_output: boolean;
    /**
     * False when the clock is not made for the belt the config asks for; such a clock is only selected when no other
     * meets the target rate. It is a clock whose belt-fed inserters go without belt pickup slack though the config
     * does not say the belts do not move: the simulator's belts do not move, so it looks better there than it is on a
     * moving belt. True for every clock when the config says the belts do not move (`overrides.non_moving_belts`),
     * and for a clock with a period that is not a whole number of ticks, which never gets the slack.
     */
    matches_belt_choice: boolean;
    /** Null when they were not counted, which ranks after any count */
    wake_ups_per_minute: number | null;
    window_count: number;
}

/** Items per second an alternative may be off the target rate by and still meet it */
const TARGET_RATE_TOLERANCE = 1e-6;

/** How a clock ranks, from its assessment and verdict, the belt it is made for, and the deadlock risks of its build */
export function rankingOf(clock: Omit<ClockAlternative, "ranking">, config: Config): ClockRanking {
    const rate_off_target = clock.assessment.items_per_second - config.target_output.items_per_second;
    // on a build with a deadlock risk the recovery verdict does not decide: see `meets_target_rate`
    const counts_as_holding = clock.deadlock_risks.length > 0 ? clock.verdict !== "unstable" : clock.verdict === "stable";
    return {
        meets_target_rate: counts_as_holding && Math.abs(rate_off_target) <= TARGET_RATE_TOLERANCE,
        rate_off_target,
        holds_expected_output: clock.verdict !== "unstable",
        // with belts that do not move every clock goes without the slack, which is the choice
        matches_belt_choice: config.overrides?.non_moving_belts === true || !clock.result.belt_pickup_slack_left_out,
        wake_ups_per_minute: clock.assessment.wake_ups_per_minute,
        window_count: clock.ranking_window_count,
    };
}

/**
 * A clock the selection can end on as stable: it meets goal 1 and is made for the belt the config asks for. Such a
 * clock comes before every clock that is not (see `combineClockAlternativeRuns`), so once one is on offer the
 * selected clock is one of them, whatever else is made.
 */
export function selectableAsStable(ranking: ClockRanking): boolean {
    return ranking.meets_target_rate && ranking.matches_belt_choice;
}

/**
 * Whether the searches have to run: none of `runs`, the clocks made without a search, can be selected as stable. A
 * search then is the only way left to a stable clock. Where one can, a search could only find a clock with fewer
 * wake-ups, which is looked for when the config asks for it (`overrides.search_for_fewer_wake_ups`).
 */
export function searchesAreNeeded<T>(
    runs: (ClockAlternativeRun<T> | null)[],
    rankingOf: (alternative: T) => ClockRanking,
): boolean {
    return !runs.some(run => run !== null && run.alternatives.some(alternative => selectableAsStable(rankingOf(alternative))));
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
 * pickup slack on its own; then the fewest wake-ups a minute (goal 2); then the fewest windows. Of equals the first
 * listed is selected.
 *
 * Where none meets the target rate, the one whose rate is nearest to it comes first, above or below, whatever belt
 * it is made for: the build then runs as near to what was asked as any clock on offer gets it. Of two equally near,
 * the one that holds its expected output from the generator's start comes before one that does not. The rest of the
 * order only parts clocks at the same rate.
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
            ranking.meets_target_rate || ranking.holds_expected_output ? 0 : 1,
            ranking.matches_belt_choice ? 0 : 1,
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
