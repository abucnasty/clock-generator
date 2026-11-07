import type { BlueprintGenerationResult } from "./plan/unclocked-run";
import { fixedTuningMethodOf, type ClockRouting, type ClockSettings, type OutputCountSetting, type TuningMethod, type WindowCycleSetting } from "./strategy-catalog";

/**
 * The strategy of a clock alternative, as ids: which Enable Control Strategy it follows, its tuning method, the settings the makers
 * set on it and the router that gave its entities their strategies. It holds no user text; the strategy catalog and the UI turn the
 * ids into names and definitions.
 */

/** An Enable Control Strategy, named for the practice it takes after; its words are in the strategy catalog (CATALOG.md) */
export type StrategyId =
    | "takt_batches"
    | "round_robin_polling"
    | "euclidean_swings"
    | "time_division_windows"
    | "time_study_windows"
    | "moved_output_swing"
    | "phase_shifted_batch"
    | "pitch_pickups"
    | "exhaust";

/** A strategy as the catalog identifies it: its id and its tuning method (the two Takt Batches differ by the tuning method) */
export interface StrategyRef {
    id: StrategyId;
    tuning_method: TuningMethod;
}

/**
 * The strategy a definition of an alternative stands for. Batched swings is Takt Batches or Round-Robin Polling by what the run made;
 * Coordinated Sources is a router, which gives each source's entities a strategy of its own.
 */
export type DefinitionStrategyId = StrategyId | "batched_swings" | "coordinated_sources";

/** What a definition sets on its clock beyond what the result shows */
export interface DefinitionSettings {
    /** The same construction at the generator's own swing count, so the whole window cycle is shorter */
    shorter_window_cycle?: true;
    /** Inserters whose machines have room for more than the hands they need are enabled for one tick at each swing */
    window_a_swing?: true;
}

/** What the listing of a clock adds to the settings of the run's clock: a subtick clock, or a clock rounded down to whole ticks */
export interface ListingSettings {
    subtick_clock?: true;
    /** The ticks the window cycle is rounded down to, and how much faster than the setpoint it runs, as a share */
    rounded?: { period_ticks: number; runs_fast: number };
}

export interface ClockStrategy {
    /** The strategy; null for a Coordinated Sources clock, whose sources each take a strategy of their own (`routing.sources`) */
    id: StrategyId | null;
    /** How the windows are found; null for a Coordinated Sources clock, as for its router */
    tuning_method: TuningMethod | null;
    /** What the makers set on the clock (`ClockSettings`) */
    settings: ClockSettings;
    /** The output swings an output cycle the clock ended up with; for a target that counts an item destroyed, the hands brought in a cycle */
    output_swings: number;
    /** Which router gave the clock's entities their strategies, and for Coordinated Sources what each source's entities took */
    routing: ClockRouting;
}

/** What the drill windows of a chest fall back to, in the order tried */
export type ChestDrillFallbackKind = "tick-longer" | "always-on";

/** What the run of an alternative found that its definition does not say */
export interface StrategyFindings {
    /** The settings the definition itself sets, such as the shorter window cycle */
    definition_settings?: DefinitionSettings;
    /** The chest drill fallback the clock ended with, when it fell back */
    chest_drill_fallback?: ChestDrillFallbackKind;
    destroyed_target: boolean;
}

/** The strategy of the clock a run made. A batched swings clock is Round-Robin Polling where that rule built its windows, else Takt Batches. */
export function strategyOf(
    definition: DefinitionStrategyId,
    result: Pick<BlueprintGenerationResult, "window_maker" | "round_robin_polling" | "primitive_round_robin_polling" | "loop_windows" | "fuel_hand_room_ticks" | "used_terminal_swing_count" | "pickups_from_entry" | "coordinated_sources">,
    findings: StrategyFindings,
): ClockStrategy {
    const output_count: OutputCountSetting = { kind: findings.destroyed_target ? "hands_brought_in" : "output_swings", count: result.used_terminal_swing_count };
    const settings: ClockSettings = { output_count, window_cycle: [], belt_pickups: [] };
    if (result.round_robin_polling?.shared_windows === true) settings.shared_windows = "shared_enable_windows";
    if (result.round_robin_polling?.harmonic_window_cycle === true) settings.window_cycle.push({ kind: "harmonic_window_cycle" });
    if (result.pickups_from_entry === true) settings.belt_pickups.push("counted_from_entry");
    if (findings.definition_settings?.shorter_window_cycle === true) settings.window_cycle.push({ kind: "shorter_window_cycle" });
    if (findings.definition_settings?.window_a_swing === true) settings.shared_windows = "window_a_swing";
    if (result.loop_windows !== undefined) settings.loops = (result.loop_windows.in_loop_ids?.length ?? 0) > 0 ? "loop_windows" : "loop_exits_only";
    if (findings.chest_drill_fallback === "tick-longer") settings.drill_windows = "a_tick_longer";
    if (Object.keys(result.fuel_hand_room_ticks).length > 0) settings.belt_pickups.push("room_for_a_hand_of_fuel");
    const common = { settings, output_swings: result.used_terminal_swing_count };
    if (definition === "coordinated_sources") {
        return { id: null, tuning_method: null, ...common,
            routing: { router: "coordinated_sources", ...(result.coordinated_sources !== undefined && { sources: result.coordinated_sources.sources }) } };
    }
    const id: StrategyId = definition !== "batched_swings" ? definition
        : result.round_robin_polling !== undefined || result.primitive_round_robin_polling !== undefined ? "round_robin_polling" : "takt_batches";
    // the windows of Takt Batches are calculated where the arithmetic made them, else read off the unclocked run; every other strategy has one method
    const tuning_method = fixedTuningMethodOf(id) ?? (result.window_maker === "arithmetic" ? "calculated" : "observed");
    return { id, tuning_method, ...common, routing: { router: "direct" } };
}

/**
 * The strategy of a clock as it is listed: what its listing adds to the settings of the run's clock, a subtick clock or a clock rounded
 * down (`rounded` says to what and by how much)
 */
export function strategyListedAs(strategy: ClockStrategy, listing: ListingSettings): ClockStrategy {
    const window_cycle: WindowCycleSetting[] = [...strategy.settings.window_cycle];
    if (listing.subtick_clock === true) window_cycle.push({ kind: "subtick_clock" });
    if (listing.rounded !== undefined) window_cycle.push({ kind: "rounded_clock", period_ticks: listing.rounded.period_ticks, runs_fast: listing.rounded.runs_fast });
    return { ...strategy, settings: { ...strategy.settings, window_cycle } };
}

/**
 * The id of an alternative, derived from the strategy and the settings of its clock (the maker that made it is `ClockAlternative.maker`):
 * the router's id for Coordinated Sources, else the strategy's, with `_observed` for the Takt Batches of the observed tuning method; then
 * `_swings_N` where the maker offers another output count than the plan's, `_shorter_window_cycle`, `_shared` or `_per_hand`, and
 * `_subtick` for the subtick clock. Two clocks of one build with the same id are an error of the makers, found by `assertDistinctIds`.
 */
export function alternativeIdOf(strategy: ClockStrategy, maker: { offers_output_count?: boolean }): string {
    const cycle = (kind: WindowCycleSetting["kind"]) => strategy.settings.window_cycle.some(it => it.kind === kind);
    if (strategy.id === null) return strategy.routing.router;
    return [
        strategy.id,
        ...(strategy.id === "takt_batches" && strategy.tuning_method === "observed" ? ["observed"] : []),
        ...(maker.offers_output_count === true ? ["swings", String(strategy.output_swings)] : []),
        ...(cycle("shorter_window_cycle") ? ["shorter_window_cycle"] : []),
        ...(strategy.settings.shared_windows === "shared_enable_windows" ? ["shared"] : strategy.settings.shared_windows === "window_a_swing" ? ["per_hand"] : []),
        ...(cycle("subtick_clock") ? ["subtick"] : []),
    ].join("_");
}
