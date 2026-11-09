import type { ClockAlternative, ClockAlternativeRun } from "./alternatives";
import type { DefinitionStrategyId, StrategyId } from "./clock-strategy";
import { combineClockAlternativeRuns } from "./rank";

/**
 * Explore mode: strategies that are not proven yet run beside the shipped ones, on request. The shipped strategies make every clock
 * the generator selects; an explored strategy only reports whether its best clock would have been selected. Which strategy is which is
 * `STRATEGY_STATUS`, the one place that says.
 */

/** Whether a strategy takes part in every generation (shipped) or only when `explore_strategies` asks for it (explored) */
export type StrategyStatus = "shipped" | "explored";

/**
 * The strategies of the primary clock make the clock every other alternative is described against, so they are always shipped: the type
 * allows no other value for them.
 */
type PrimaryStrategyId = "takt_batches" | "round_robin_polling" | "exhaust";

/**
 * The status of every strategy the alternatives can run, and of Coordinated Sources, the router that composes a clock from the runs
 * before it. Promoting a strategy is changing its value to "shipped"; demoting it is changing it to "explored". Nothing else changes: a
 * strategy that is not shipped is left out of the generation unless it is asked for, and never selected.
 */
export const STRATEGY_STATUS: Record<PrimaryStrategyId, "shipped"> & Record<Exclude<StrategyId, PrimaryStrategyId> | "coordinated_sources", StrategyStatus> = {
    takt_batches: "shipped",
    round_robin_polling: "shipped",
    exhaust: "shipped",
    euclidean_swings: "shipped",
    time_division_windows: "shipped",
    time_study_windows: "shipped",
    moved_output_swing: "shipped",
    phase_shifted_batch: "shipped",
    pitch_pickups: "shipped",
    coordinated_sources: "shipped",
};

/** Whether the strategy a definition stands for is explored (batched swings is Takt Batches or Round-Robin Polling, which are shipped) */
export function isExplored(strategy: DefinitionStrategyId): boolean {
    return strategy !== "batched_swings" && STRATEGY_STATUS[strategy] === "explored";
}

/** What an explore generation reports beside the shipped selection: the clocks the explored strategies made and whether the best of them would win */
export interface ExploredClocks {
    /** The clocks the explored strategies made, in the order the ranking lists them; a clock the shipped runs made too is not listed again */
    alternatives: ClockAlternative[];
    /** The index in `alternatives` of the clock the ranking puts first among them; null when the explored strategies made none */
    best_index: number | null;
    /** The best explored clock ranks above the selected clock by the ranking that selects (a tie is not a win); false when there is none */
    beats_selection: boolean;
    /** The ids of the explored alternatives that made a clock a shipped run made too, so they have nothing to report */
    same_as_shipped: string[];
}

/** The explored clocks of a generation: the best of the explored runs and whether it beats the clock the shipped runs selected */
export function exploredClocksOf(
    selected: ClockAlternative | undefined,
    runs: (ClockAlternativeRun | null)[],
    same_as_shipped: string[],
): ExploredClocks {
    const { alternatives, selected_index } = combineClockAlternativeRuns(runs, it => it.ranking);
    if (alternatives.length === 0) {
        return { alternatives, best_index: null, beats_selection: false, same_as_shipped };
    }
    // the same ranking the selection uses, with the shipped clock listed first so that a tie leaves it selected
    const beats_selection = selected === undefined || combineClockAlternativeRuns([
        { signature: "selected", alternatives: [selected] },
        { signature: "best", alternatives: [alternatives[selected_index]] },
    ], it => it.ranking).selected_index === 1;
    return { alternatives, best_index: selected_index, beats_selection, same_as_shipped };
}
