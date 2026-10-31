import { Config } from "../config";
import { ClockAlternative, ClockAlternativeRun } from "./alternatives";
import type { ClockAssessment } from "./trial";
import { SerializableClockWindows } from "./clock";
import { BlueprintGenerationResult } from "./plan/plan-run";
import type { InserterCounters } from "./inserter-counters";

/**
 * What the selection compares between two alternatives, in this order (see `combineClockAlternativeRuns`), worked out
 * from a clock's assessment, its belt, its counters and the build's deadlock risks by `rankingOf`.
 *
 * The rule (decided 2026-10-31, from the timed strategy pairs of the inserter cost series): robustness is a gate, the cost ranks those
 * that pass it. A clock that holds the target rate and gets back from every loss (goal 1) is ranked among the clocks
 * that do, and only those; among them the priced cost (`clockCost`) decides, two costs closer than the floor
 * (`COST_TIE_FLOOR`) being a tie; of tied clocks the one that gets back from a loss in fewer periods comes first. The
 * wake-ups are reported beside the cost and decide nothing. Every alternative ranked is a whole clock of the build,
 * every group's windows with every other group's: a group's way of being clocked is judged in the cell it is part of,
 * never swapped into another clock alone, since what one group's windows cost depends on the others' (the machines
 * they share wake them).
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
    /**
     * Wake-ups a minute of one copy (`ClockAssessment.wake_ups_per_minute`); null when they were not counted. Reported,
     * not ranked: the cost, which prices them, decides (decided 2026-10-31).
     */
    wake_ups_per_minute: number | null;
    /**
     * What the clock is estimated to cost the game, priced from its counters (`clockCost`); null where its wake-ups were
     * not counted, which ranks after any cost. Absent from a ranking kept from before 0.26.0, which reads as null.
     */
    cost?: ClockCost | null;
    /**
     * The most periods the clock took to be back at its expected output over its backpressure loss trials
     * (`BackpressureLossVerdict.recovered_after_periods`); null where it was not tried or does not get back, and absent
     * from a ranking kept from before 0.26.0. Of clocks tied on cost (`costsTie`) the one that recovers sooner comes
     * first (decided 2026-10-31: on the container wagons, even hands recovered from the second cut of an input within 5
     * periods in the game where another clock of 0 wake-ups too took 33 to 48; made the tie-break of the cost the same
     * day).
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
        cost: clockCost(clock.result.stability_check.as_built?.counters, clock.assessment.wake_ups_per_minute),
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
 * The prices `clockCost` puts on what a clock's inserters do, in ns of the game's update a tick: the inserter cost
 * series' price estimate with its output wake-up patch (decided 2026-10-31; measured on one desktop machine, Factorio
 * 2.1.21: relative figures, not times for another machine). Each is a price the engine can put on its own counters
 * without asking which machine or item an inserter serves.
 */
export const CLOCK_PRICES_NS = {
    /** A wake-up from the list of the machine an inserter puts into: the 85 ns unit (series 02's belt cell) */
    input_wake_up: 85,
    /**
     * A wake-up from the list of the machine it takes from: the assembler's price (session B p192), for every machine.
     * The estimate prices the electromagnetic plant's at 242, the foundry's at 300 and the cryogenic plant's at 140, by
     * the machine's name, which the engine never branches on: those are left out.
     */
    output_wake_up: 308,
    /** An output wake-up of a machine that starts more than `busy_craft_starts_per_tick` crafts a tick: the busy price (Session H, 1.75 starts a tick) */
    busy_output_wake_up: 152.3,
    busy_craft_starts_per_tick: 1,
    /** A tick an enabled inserter that picks up from a belt waits for items there, whatever its hand holds: the waiting tick (PRICES.md row 10) */
    belt_wait_tick: 135.8,
    /** A switch-on: its two edges and the switch-on at rest (session D, series 04) */
    window: 146.9,
    /** A wired inserter a tick that puts into a machine (series 01) */
    wire_into_machine: 3.08,
    /** A wired inserter a tick that puts anywhere else (series 01) */
    wire_other: 2.29,
    /** A window decider combinator a tick (series 07) */
    decider: 31,
} as const;

/** A clock's priced cost, ns of the game's update a tick for one copy of the build, by what it is paid for */
export interface ClockCost {
    /** The whole: the sum of the rest */
    ns_per_tick: number;
    /** Wake-ups from the lists of the machines the inserters put into */
    input_wake_ups: number;
    /** Wake-ups from the lists of the machines they take from */
    output_wake_ups: number;
    /** Ticks the inserters that pick up from a belt wait there, enabled */
    belt_waits: number;
    /** Switch-ons of the clock's windows */
    windows: number;
    /** The wired inserters */
    wires: number;
    /** The window deciders of the blueprint */
    deciders: number;
}

/** The part of a cost only fewer wake-ups and shorter waits can lower: what the inserters do while enabled */
export function wakeSideOf(cost: ClockCost): number {
    return cost.input_wake_ups + cost.output_wake_ups + cost.belt_waits;
}

const TICKS_PER_MINUTE = 3600;

/**
 * What the selection minimises among clocks of the same rank (goal 2): the series' estimate of what the clock costs the
 * game, from the counters of one copy over its long run (`as_built.counters`), at the prices of CLOCK_PRICES_NS:
 *
 *   input wake-ups x 85 + output wake-ups x 308 (152.3 out of a machine starting more than one craft a tick)
 *   + belt pickup waiting ticks x 135.8 + switch-ons x 146.9 (each a minute, / 3600)
 *   + wired inserters x 3.08 (into a machine) or 2.29 (elsewhere) + window deciders x 31
 *
 * Where the wake-ups that rank the clock are their mean over the starts (`wake_ups_from_starts`), the counters' own,
 * of the cold start, are scaled to that mean (priced at 85 where the cold start counted none). Left out: what the estimate prices
 * by the machine's name (output wake-ups of electromagnetic plants, foundries and cryogenic plants); wake-ups of an
 * inserter waiting at a belt or a chest, which the simulator does not count; the hands (extra grabs and held-open
 * hands); and the machines' and belts' own update. Null where the wake-ups were not counted. The one place the
 * selection and the targeted searches read a clock's cost from.
 */
export function clockCost(counters: InserterCounters | undefined, wake_ups_per_minute: number | null): ClockCost | null {
    if (counters === undefined || wake_ups_per_minute === null) {
        return null;
    }
    const prices = CLOCK_PRICES_NS;
    let input = 0;
    let output = 0;
    let counted = 0;
    let belt_waits = 0;
    let windows = 0;
    let wires = 0;
    for (const inserter of counters.inserters) {
        const busy = (inserter.source_craft_starts_per_tick ?? 0) > prices.busy_craft_starts_per_tick;
        input += inserter.input_wake_ups_per_minute * prices.input_wake_up;
        output += inserter.output_wake_ups_per_minute * (busy ? prices.busy_output_wake_up : prices.output_wake_up);
        counted += inserter.input_wake_ups_per_minute + inserter.output_wake_ups_per_minute;
        if (inserter.pickup_kind === "belt") {
            belt_waits += inserter.waiting_for_items.ticks_per_minute * prices.belt_wait_tick;
        }
        windows += inserter.switch_ons_per_minute * prices.window;
        // an inserter its clock switches; null until the blueprint is known, which only a wired one is
        if (inserter.network_width !== 0) {
            wires += inserter.drop_kind === "machine" ? prices.wire_into_machine : prices.wire_other;
        }
    }
    const scale = counted > 0 ? wake_ups_per_minute / counted : 0;
    const cost = {
        input_wake_ups: (counted > 0 ? input * scale : wake_ups_per_minute * prices.input_wake_up) / TICKS_PER_MINUTE,
        output_wake_ups: output * scale / TICKS_PER_MINUTE,
        belt_waits: belt_waits / TICKS_PER_MINUTE,
        windows: windows / TICKS_PER_MINUTE,
        wires,
        deciders: (counters.deciders ?? 0) * prices.decider,
    };
    return { ns_per_tick: cost.input_wake_ups + cost.output_wake_ups + cost.belt_waits + cost.windows + cost.wires + cost.deciders, ...cost };
}

/**
 * The floor under which two clocks' costs tie (decided 2026-10-31): the series' materiality floor for a timed pair,
 * max(3u, 0.5% of the clocked build's whole update), for one copy, as `clockCost` counts it. The engine
 * knows neither figure of a build, so each is the smallest honest stand-in:
 * - 3u: u is 13 ns a copy, the series' figure for cells (the cell02 experiment),
 *   so 39 ns for one copy;
 * - 0.5% of the whole update: of which the engine knows only the part it prices, the cost of the cheaper clock, a
 *   lower bound of the whole.
 */
export const COST_TIE_FLOOR = {
    ns_per_copy: 39,
    share_of_cost: 0.005,
} as const;

/** The floor of `COST_TIE_FLOOR` beside a clock of this cost, ns a tick for one copy */
export function costTieFloor(cheaper_ns_per_tick: number): number {
    return Math.max(COST_TIE_FLOOR.ns_per_copy, COST_TIE_FLOOR.share_of_cost * cheaper_ns_per_tick);
}

/** A ranking's cost as the selection compares it, ns a tick: Infinity where it was not counted */
export function costOf(ranking: Pick<ClockRanking, "cost">): number {
    return ranking.cost?.ns_per_tick ?? Infinity;
}

/** Whether a clock of cost `cost` ties with the cheapest of the clocks it is ranked with: it is above it by less than the floor */
export function costsTie(cost: number, cheapest: number): boolean {
    return cost === cheapest || cost - cheapest < costTieFloor(cheapest);
}

/**
 * The position a cost takes in an order of clocks whose cheapest costs `cheapest`: 0 for a clock tied with it, which
 * leaves the order to what follows the cost (the recovery, the windows), else the cost itself
 */
export function costPlace(cost: number, cheapest: number): number {
    return costsTie(cost, cheapest) ? 0 : cost;
}

/**
 * Whether a clock cheaper than this one by more than the floor could be one with fewer wake-ups: the part of its cost
 * that fewer wake-ups and shorter waits lower is at least the floor. True where the cost was not counted.
 */
export function wakeSideAboveFloor(ranking: Pick<ClockRanking, "cost">): boolean {
    const cost = ranking.cost;
    return cost === undefined || cost === null || wakeSideOf(cost) >= costTieFloor(cost.ns_per_tick);
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
 * (`searchesAreNeeded`); else those of SEARCHES_THAT_CAN_IMPROVE, where the clock the selection ends on so far pays at
 * least the floor for its wake-ups and waits (`wakeSideAboveFloor`: a clock with fewer could not beat it by more, and one
 * that only ties it is no improvement the cost can see) and the primary period is at most
 * IMPROVING_SEARCH_MAX_PERIOD_TICKS; else none.
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
    if (selected === undefined || !wakeSideAboveFloor(rankingOf(selected)) || primary_period_ticks > IMPROVING_SEARCH_MAX_PERIOD_TICKS) {
        return [];
    }
    return searches.filter(search => SEARCHES_THAT_CAN_IMPROVE.includes(search.id));
}

/**
 * The windows an alternative is ranked by, between clocks tied on cost and recovery: those it has without the windows of
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
 * config asks for, so that the cost never drops belt pickup slack on its own; then the lowest cost (goal 2, `clockCost`),
 * every clock whose cost is above the cheapest of those it is ranked with by less than the floor (`costsTie`) tied with
 * it; then, of tied clocks, the fewest periods to get back from a loss; then the fewest windows. Of equals the first
 * listed is selected. The wake-ups decide nothing: they are in the cost, priced.
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
    // what comes before the cost: the gate of goal 1, the rate, the output held and the belt
    const before_cost = (ranking: ClockRanking): number[] => [
        // a rounded clock meets goal 1 a little fast, after the exact ones; a clock whose recovery could not be tried is
        // not known to meet it, after those that are; then the stable clocks over the target, before the rest
        ranking.meets_target_rate ? (ranking.recovery_untried ? 2 : ranking.runs_fast !== undefined ? 1 : 0)
            : ranking.stable_above_target === true ? 3 : 4,
        // to a thousandth of an item a second: less than that is the rounding of a division, not a difference between two clocks
        ranking.meets_target_rate ? 0 : Math.round(Math.abs(ranking.rate_off_target) * 1000),
        ranking.meets_target_rate || ranking.holds_expected_output ? 0 : 1,
        ranking.matches_belt_choice ? 0 : 1,
    ];
    const ranked = alternatives.map(alternative => {
        const ranking = rankingOf(alternative);
        return { ranking, before: before_cost(ranking), cost: costOf(ranking) };
    });
    // a cost ties with the cheapest of the clocks equal to it on everything before the cost
    const cheapest = new Map<string, number>();
    for (const { before, cost } of ranked) {
        const key = before.join(",");
        cheapest.set(key, Math.min(cheapest.get(key) ?? Infinity, cost));
    }
    const ranks = ranked.map(({ ranking, before, cost }) => [
        ...before,
        costPlace(cost, cheapest.get(before.join(","))!),
        // of clocks tied on cost, the one that gets back from a loss sooner
        ranking.recovery_periods ?? Infinity,
        ranking.window_count,
    ]);
    const beats = (a: number, b: number): boolean => {
        const [ra, rb] = [ranks[a], ranks[b]];
        for (let i = 0; i < ra.length; i++) {
            if (ra[i] !== rb[i]) return ra[i] < rb[i];
        }
        return false;
    };
    let selected_index = 0;
    alternatives.forEach((_, index) => {
        if (beats(index, selected_index)) {
            selected_index = index;
        }
    });
    return { alternatives, selected_index };
}
