import { Config } from "../config";
import { Entity } from "../entities";
import { ClockAlternative, ClockAlternativeRun } from "./alternatives";
import { SerializableClockWindows } from "./clock";
import { BlueprintGenerationResult } from "./plan/plan-run";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";

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
     * False when the clock is not made for the belt the config asks for; such a clock is only selected when no other
     * meets the target rate. It is a clock whose belt-fed inserters go without belt pickup slack though the config
     * does not say the belts do not move: the simulator's belts do not move, so it looks better there than it is on a
     * moving belt. True for every clock when the config says the belts do not move (`overrides.non_moving_belts`),
     * and for a clock with a period that is not a whole number of ticks, which never gets the slack.
     */
    matches_belt_choice: boolean;
    /**
     * Ranked ahead of the other alternatives that meet the target rate, whatever their wake-ups: full-hand output
     * swings where a machine can make more in a period than its plan. Such a machine crafts ahead from its stock
     * whenever an output window lets the surplus out, its ingredient stock drains, and in the end an extra ingredient
     * hand fits and the build over-produces; short output windows that only ever take a full hand leave the surplus
     * inside, where the output block stops it.
     */
    rank_first: boolean;
    /** Null when they were not counted, which ranks after any count */
    wake_ups_per_minute: number | null;
    window_count: number;
}

/** Items per second an alternative may be off the target rate by and still meet it */
const TARGET_RATE_TOLERANCE = 1e-6;

/** How much more a machine could make in a period than its plan asks of it before it counts as having spare speed */
const SPARE_SPEED_MARGIN = 1.05;

/**
 * True when the machines making the target can craft noticeably more in a period than the plan expects of them:
 * such a machine never idles for lack of speed, so an open output window drains its ingredient stock over time.
 */
function machineHasSpareSpeed(config: Config, result: BlueprintGenerationResult): boolean {
    const period = result.simulation_duration.ticks;
    const expected = result.stability_check.expected_output_items;
    if (!(period > 0) || !(expected > 0)) {
        return false;
    }
    const registry = createEntityRegistryFromConfig(config);
    const makers = registry.getAll().filter(Entity.isMachine).filter(machine => machine.output.item_name === config.target_output.recipe);
    if (makers.length === 0) {
        return false;
    }
    const capacity = makers.reduce((sum, machine) => sum + period * (
        machine.output.production_rate.amount_per_tick.toDecimal()
        + machine.bonus_productivity_rate.bonus_crafts_per_tick * machine.bonus_productivity_rate.amount_per_bonus
    ), 0);
    return capacity >= expected * SPARE_SPEED_MARGIN;
}

/** How a clock ranks, from its assessment and verdict, the belt it is made for, and the deadlock risks of its build */
export function rankingOf(clock: Omit<ClockAlternative, "ranking">, config: Config): ClockRanking {
    const rate_off_target = clock.assessment.items_per_second - config.target_output.items_per_second;
    // on a build with a deadlock risk the recovery verdict does not decide: see `meets_target_rate`
    const counts_as_holding = clock.deadlock_risks.length > 0 ? clock.verdict !== "unstable" : clock.verdict === "stable";
    return {
        meets_target_rate: counts_as_holding && Math.abs(rate_off_target) <= TARGET_RATE_TOLERANCE,
        rate_off_target,
        // with belts that do not move every clock goes without the slack, which is the choice
        matches_belt_choice: config.overrides?.non_moving_belts === true || !clock.result.belt_pickup_slack_left_out,
        rank_first: clock.id.replace(/-subtick$/, "") === "full-hand" && machineHasSpareSpeed(config, clock.result),
        wake_ups_per_minute: clock.assessment.wake_ups_per_minute,
        window_count: clock.ranking_window_count,
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
