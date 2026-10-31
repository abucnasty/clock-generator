import { Config } from "../config";
import { ClockAlternative, ClockAlternativeRun } from "./alternatives";
import type { ClockAssessment } from "./trial";
import { SerializableClockWindows } from "./clock";
import { BlueprintGenerationResult } from "./plan/plan-run";

/**
 * What the selection compares between two alternatives, in this order (see `combineClockAlternativeRuns`), worked out
 * from a clock's assessment, its belt, and the build's deadlock risks by `rankingOf`.
 */
export interface ClockRanking {
    /**
     * Goal 1: the clock is stable and runs the build at the target rate. A clock whose period is rounded down to whole
     * ticks meets it when it runs at most 0.1% fast and within what the machines can make, tried on its own period
     * (`runs_fast`; GOALS.md, goal 1).
     * On a build with a deadlock risk a clock that holds its expected output at the target rate meets it, whether it
     * gets back from every backpressure loss or not: the trials do not see the deadlock, so what they say of the
     * clocks of such a build does not decide which is selected (GOALS.md, "Two inserters that bring the same item").
     */
    meets_target_rate: boolean;
    /**
     * The clock meets the target rate and its backpressure losses could not be tried on it (the assessment's
     * `backpressure_loss_not_tried` says why): whether it gets back is not known. It ranks below every clock that meets
     * the target rate and was tried, and above every clock that does not meet it, those tried and not getting back
     * included. False on a build with a deadlock risk, where the trials do not decide. The engine always sets it; a
     * ranking kept from before it (a stored result) lacks it, which reads as false.
     */
    recovery_untried?: boolean;
    /**
     * Set when the clock meets the target rate as a clock rounded down to whole ticks: how much faster than the target
     * it runs, as a share (0.0002 for 0.02%), at most `ROUNDED_CLOCK_MAX_FAST`. It ranks below every clock that meets
     * the target rate exactly and was tried, and above every other.
     */
    runs_fast?: number;
    /**
     * Set when the clock does not meet the target rate and is stable above it: it holds its expected output, gets back
     * from every backpressure loss (on a build with a deadlock risk: holds it) and runs over the target, at its exact
     * period. Where no clock meets the target rate, these come first, the nearest to it first: a stable clock over the
     * target is selected before an unstable one nearer to it, and never one under it (decided 2026-10-28, Thaeln's
     * cell 07: a stable clock 2.3% over before an unstable one 0.2% under).
     */
    stable_above_target?: boolean;
    /**
     * Items per second the clock is above the target rate; negative when it is short of it. Where no clock meets
     * the target rate and none is stable above it, the one nearest to it is selected.
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
     * does not say the input belts are backed up: its windows omit the extra margin for late moving pickups. True for every clock when the config says the input belts are backed up (`overrides.backed_up_belts`),
     * and for a clock with a period that is not a whole number of ticks, which never gets the slack.
     */
    matches_belt_choice: boolean;
    /** Null when they were not counted, which ranks after any count */
    wake_ups_per_minute: number | null;
    /**
     * The most periods the clock took to be back at its expected output over its backpressure loss trials
     * (`BackpressureLossVerdict.recovered_after_periods`); null where it was not tried or does not get back, and absent
     * from a ranking kept from before 0.26.0. Of clocks equal on wake-ups the one that recovers sooner comes first
     * (decided 2026-10-31: on the container wagons, even hands recovered from the second cut of an input within 5
     * periods in the game where another clock of 0 wake-ups too took 33 to 48).
     */
    recovery_periods?: number | null;
    window_count: number;
}

/** Items per second an alternative may be off the target rate by and still meet it */
const TARGET_RATE_TOLERANCE = 1e-6;

/**
 * The share of the target rate a clock rounded down to whole ticks may run above it and still meet goal 1 (decided
 * 2026-10-23: Atlan cell 29's 2,888-tick clock of a 2,888.666-tick period runs 0.02% fast, and held and recovered in
 * the game, #332)
 */
export const ROUNDED_CLOCK_MAX_FAST = 0.001;

/** A clock of a period that is not a whole number of ticks, exported rounded down to whole ticks */
export interface RoundedClock {
    /** The ticks its blueprint counts: the period rounded down */
    period_ticks: number;
    /** How much faster than the target it runs, as a share: 0.0002 for 0.02% */
    runs_fast: number;
    /** Its rate is at most what the machines that make the target item can make together */
    within_machines: boolean;
    /**
     * Its verdict is of its own period: the clock-only check and the loss trials ran on the clock of whole ticks. Only
     * a clock that can meet goal 1 (`ROUNDED_CLOCK_MAX_FAST`, `within_machines`) is tried so; another keeps the verdict
     * of the exact period, which its rate keeps from meeting the target.
     */
    tried_on_its_period: boolean;
}

/** Whether a rounded clock's rate is one that meets the target: at most `ROUNDED_CLOCK_MAX_FAST` fast, within the machines */
export function roundedRateAllowed(rounded: Pick<RoundedClock, "runs_fast" | "within_machines">): boolean {
    return rounded.within_machines && rounded.runs_fast > 0 && rounded.runs_fast <= ROUNDED_CLOCK_MAX_FAST + 1e-12;
}

/** How a clock ranks, from its assessment and verdict, the belt it is made for, and the deadlock risks of its build */
export function rankingOf(clock: Omit<ClockAlternative, "ranking">, config: Config): ClockRanking {
    const target = config.target_output.items_per_second;
    const rate_off_target = clock.assessment.items_per_second - target;
    // on a build with a deadlock risk the recovery verdict does not decide: see `meets_target_rate`
    const counts_as_holding = clock.deadlock_risks.length > 0 ? clock.verdict !== "unstable" : clock.verdict === "stable";
    const exact = Math.abs(rate_off_target) <= TARGET_RATE_TOLERANCE;
    // a rounded clock is judged by the rate it runs at on its own period, which it was tried on
    const runs_fast = !exact && clock.rounded?.tried_on_its_period === true && rate_off_target > 0
        && roundedRateAllowed({ runs_fast: rate_off_target / target, within_machines: clock.rounded.within_machines })
        ? rate_off_target / target : undefined;
    const meets_target_rate = counts_as_holding && (exact || runs_fast !== undefined);
    // a clock rounded down that runs further over than a rounded clock may keeps the verdict of the exact period, which
    // is not of the clock it is; a clock whose recovery could not be tried is not known to be stable
    const stable_above_target = !meets_target_rate && counts_as_holding && rate_off_target > TARGET_RATE_TOLERANCE
        && clock.rounded === undefined && (clock.deadlock_risks.length > 0 || !recoveryUntried(clock.assessment));
    return {
        meets_target_rate,
        recovery_untried: meets_target_rate && clock.deadlock_risks.length === 0 && recoveryUntried(clock.assessment),
        ...(meets_target_rate && runs_fast !== undefined && { runs_fast }),
        ...(stable_above_target && { stable_above_target }),
        rate_off_target,
        holds_expected_output: clock.verdict !== "unstable",
        // with backed-up belts every clock goes without the slack, which is the choice
        matches_belt_choice: config.overrides?.backed_up_belts === true || !clock.result.belt_pickup_slack_left_out,
        wake_ups_per_minute: clock.assessment.wake_ups_per_minute,
        recovery_periods: clock.assessment.backpressure_loss?.recovered_after_periods ?? null,
        window_count: clock.ranking_window_count,
    };
}

/** The clock holds its expected output and its backpressure losses could not be tried on it */
export function recoveryUntried(assessment: Pick<ClockAssessment, "holds" | "backpressure_loss" | "backpressure_loss_not_tried">): boolean {
    return assessment.holds && assessment.backpressure_loss === null && assessment.backpressure_loss_not_tried !== undefined;
}

/**
 * A clock the selection can end on as stable: it meets goal 1 at exactly the target rate, its recovery was tried, and
 * it is made for the belt the config asks for. Such a clock comes before every clock that is not (see
 * `combineClockAlternativeRuns`), so once one is on offer the selected clock is one of them, whatever else is made. A
 * clock rounded down that meets goal 1 is not one: the searches still look for an exact one.
 */
export function selectableAsStable(ranking: ClockRanking): boolean {
    return ranking.meets_target_rate && !ranking.recovery_untried && ranking.runs_fast === undefined && ranking.matches_belt_choice;
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
    // a run's clock made with shared windows is on offer as much as the run's own
    const offersStable = (run: ClockAlternativeRun<T> | null): boolean => run !== null
        && (run.alternatives.some(alternative => selectableAsStable(rankingOf(alternative))) || (run.also ?? []).some(offersStable));
    return !runs.some(offersStable);
}

/**
 * What the selection minimises among clocks of the same rank: wake-ups a minute (goal 2). Null where they were not
 * counted. The one place the selection and the targeted searches read a clock's cost from.
 */
export function clockCost(ranking: Pick<ClockRanking, "wake_ups_per_minute">): number | null {
    return ranking.wake_ups_per_minute;
}

/** A cost as the selection compares it: to a thousandth, less than that being the rounding of a division */
function costKey(ranking: Pick<ClockRanking, "wake_ups_per_minute">): number {
    const cost = clockCost(ranking);
    return cost === null ? Infinity : Math.round(cost * 1000);
}

/**
 * The searches run where a clock made without one can already be selected as stable, in the order listed: the two that
 * found a clock with fewer wake-ups on a sample (measured on every sample as built and with backed-up belts, the four
 * searches run on every one: observed windows on 8 of 106 jobs, shifted swings on 3; uneven output swings and full-hand
 * output on none, while costing 61% of the searches' builds). The others run only where no clock made without a search
 * can be selected as stable, or where the config asks for every search (`overrides.search_for_fewer_wake_ups`).
 */
export const SEARCHES_THAT_CAN_IMPROVE: readonly string[] = ["derived", "shifted-swings"];

/**
 * The longest period of the primary clock on which those searches still run past a stable clock: every improvement
 * measured was on a period of at most 432 ticks, and a search's builds grow with the period (the periods of 672 to 1,728
 * ticks held most of their cost), as the 2,400-tick limit of observed windows also bounds it
 */
export const IMPROVING_SEARCH_MAX_PERIOD_TICKS = 480;

/**
 * The searches to run once the clocks made without one are in: every one where none of them can be selected as stable
 * (`searchesAreNeeded`); else those of SEARCHES_THAT_CAN_IMPROVE, where the clock the selection ends on so far has a cost
 * above 0 (none can beat a clock of no wake-ups) and the primary period is at most IMPROVING_SEARCH_MAX_PERIOD_TICKS;
 * else none.
 */
export function searchesToRun<T, S extends { id: string }>(
    runs: (ClockAlternativeRun<T> | null)[],
    rankingOf: (alternative: T) => ClockRanking,
    searches: readonly S[],
    primary_period_ticks: number,
): S[] {
    if (searchesAreNeeded(runs, rankingOf)) {
        return [...searches];
    }
    const { alternatives, selected_index } = combineClockAlternativeRuns(runs, rankingOf);
    const selected = alternatives[selected_index];
    if (selected === undefined || costKey(rankingOf(selected)) <= 0 || primary_period_ticks > IMPROVING_SEARCH_MAX_PERIOD_TICKS) {
        return [];
    }
    return searches.filter(search => SEARCHES_THAT_CAN_IMPROVE.includes(search.id));
}

/**
 * The windows an alternative is ranked by, between clocks with the same wake-ups: those it has without the windows of
 * the inserters of a loop, which only reduce idle checks and must never count against a clock, so its windows rank as
 * they would with those inserters always enabled.
 */
export function rankingWindowCount(
    inserter_window_count: number,
    clock_windows: SerializableClockWindows,
    loop_windows: BlueprintGenerationResult["loop_windows"],
): number {
    if (loop_windows === undefined) {
        return inserter_window_count;
    }
    const with_loop_windows = loop_windows.inserter_ids.reduce((sum, id) => sum + (clock_windows[id]?.length ?? 0), 0);
    return inserter_window_count - with_loop_windows + loop_windows.window_count_without_loop_windows;
}

/**
 * Lists runs in order, skipping duplicates, and selects one. The alternatives that meet the target rate (goal 1) come
 * first: those at exactly the target rate and tried, then those rounded down to whole ticks that run at most 0.1% fast
 * and were tried, then those whose recovery could not be tried; among them those made for the belt the
 * config asks for, so that the count of wake-ups never drops belt pickup slack on its own; then the fewest wake-ups a
 * minute (goal 2); then the fewest periods to get back from a loss; then the fewest windows. Of equals the first listed
 * is selected.
 *
 * Where none meets the target rate, those stable above it come first (`stable_above_target`), the nearest to it
 * first: the build then runs at least at what was asked, on a clock that holds and recovers. Where none is either, the
 * one whose rate is nearest to the target comes first, above or below, whatever belt it is made for: the build then
 * runs as near to what was asked as any clock on offer gets it. Of two equally near, the one that holds its expected
 * output from the generator's start comes before one that does not. The rest of the order only parts clocks at the
 * same rate.
 */
export function combineClockAlternativeRuns<T>(
    runs: (ClockAlternativeRun<T> | null)[],
    rankingOf: (alternative: T) => ClockRanking,
): { alternatives: T[]; selected_index: number } {
    const seen = new Set<string>();
    const alternatives: T[] = [];
    const list = (run: ClockAlternativeRun<T> | null): void => {
        if (run && !seen.has(run.signature)) {
            seen.add(run.signature);
            alternatives.push(...run.alternatives);
            // the same clock with shared windows follows it
            run.also?.forEach(list);
        }
    };
    runs.forEach(list);
    const rank = (alternative: T): number[] => {
        const ranking = rankingOf(alternative);
        return [
            // a rounded clock meets goal 1 a little fast, after the exact ones; a clock whose recovery could not be tried is
            // not known to meet it, after those that are; then the stable clocks over the target, before the rest
            ranking.meets_target_rate ? (ranking.recovery_untried ? 2 : ranking.runs_fast !== undefined ? 1 : 0)
                : ranking.stable_above_target === true ? 3 : 4,
            // to a thousandth of an item a second, as the wake-ups below
            ranking.meets_target_rate ? 0 : Math.round(Math.abs(ranking.rate_off_target) * 1000),
            ranking.meets_target_rate || ranking.holds_expected_output ? 0 : 1,
            ranking.matches_belt_choice ? 0 : 1,
            // to a thousandth: less than that is the rounding of a division, not a difference between two clocks
            costKey(ranking),
            // of equals on cost, the one that gets back from a loss sooner
            ranking.recovery_periods ?? Infinity,
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
