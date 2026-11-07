import type { BlueprintGenerationResult } from "./plan/plan-run";
import type { BeltPickupSetting, ClockRouting, ClockSettings, OutputCountSetting, WindowCycleSetting } from "./strategy-catalog";

/**
 * The strategy of a clock alternative, as ids: which way of making a clock it is, what qualifies it, and which construction
 * made its windows. It holds no user text; the UI turns the ids into names and definitions.
 */

/** A way of making a clock, named for the practice it takes after (docs of the strategy names) */
export type StrategyFamily =
    | "takt-batches"
    | "round-robin-polling"
    | "euclidean-swings"
    | "time-division-slots"
    | "time-study-windows"
    | "moved-output-swing"
    | "signal-offset"
    | "pitch-pickups"
    | "exhaust"
    | "per-branch";

/**
 * What qualifies a clock beyond its family. `output-swings` and `hands-brought-in` are carried by every clock (its count is
 * `ClockStrategy.output_swings`); the others only where the clock has them.
 */
export type StrategyQualifier =
    /** The output inserter takes `output_swings` swings each time the crafting cycle repeats */
    | "output-swings"
    /** A target that counts an item destroyed: the inserters bring in `output_swings` hands each time the cycle repeats */
    | "hands-brought-in"
    /** Inserters that open on the same tick share one enable window and one decider (the grouped hands rule's) */
    | "shared-enable-windows"
    /** Inserters whose machines have room for more than the hands they need are enabled for one tick at each swing */
    | "window-a-swing"
    /** The same construction at the generator's own swing count, so the whole window cycle is shorter */
    | "shorter-window-cycle"
    /** A window cycle that is not a whole number of ticks is counted in fractions of a tick (the subtick clock) */
    | "phase-accumulator"
    /** The window cycle is rounded down to whole ticks and runs fast (`ClockAlternative.rounded` says by how much) */
    | "rounded-clock"
    /** The inserters of a loop of machines, and those that take out of it, have enable windows */
    | "loop-windows"
    /** Only the inserters that take out of a loop have enable windows */
    | "loop-exits-only"
    /** The windows of the drills that fill a chest were made a tick longer than planned */
    | "drill-windows-longer"
    /** The drills that fill a chest were left always enabled because their windows did not hold */
    | "drills-always-on"
    /** An inserter that takes fuel off a belt has room in its window for one more hand */
    | "fuel-hand-room"
    /** Found by trying placements in a simulation, not worked out from the build's numbers */
    | "found-by-search"
    /** Belt pickups are counted from the moment the inserter reaches the belt, not from the take that freed it */
    | "pickups-from-entry"
    /** An inserter that fills a machine and needs a fraction of a hand a cycle is planned at the next whole number, and the window cycle is cut to the crafting cycles after which the output inserters move whole hands (rule F) */
    | "harmonic-window-cycle";

/** Which construction made the windows of a clock built from batched swings */
export type StrategyConstruction =
    /** Read off the planning run: the ticks each inserter moved items */
    | "planning-run"
    /** Worked out from the plan's hands, the crafting cycle and the stock walk (batched-arithmetic.ts) */
    | "arithmetic"
    /** Built from the hands and what each source holds, one group after another (candidates/grouped-hands.ts) */
    | "grouped-hands";

export interface ClockStrategy {
    family: StrategyFamily;
    /**
     * What qualifies the clock, as the record names it.
     * @deprecated Derived from `settings` (with found by search and the drills left always enabled, which are not settings); read `settings`.
     */
    readonly qualifiers: readonly StrategyQualifier[];
    /** What the makers set on the clock (`ClockSettings`) */
    settings: ClockSettings;
    /** Set for the families made from batched swings (takt batches, round-robin polling, euclidean swings); absent for the others */
    construction?: StrategyConstruction;
    /** The output swings a crafting cycle the clock ended up with; for a target that counts an item destroyed, the hands brought in a cycle */
    output_swings: number;
    /** Which router gave the clock's entities their strategies, and for Coordinated Sources what each source's entities took */
    routing: ClockRouting;
}

/** The family of a definition: the batched swings' own is takt batches or round-robin polling by the construction that made the clock */
export type DefinitionFamily = StrategyFamily | "batched-swings";

/** What the drill windows of a chest fall back to, in the order tried */
export type ChestDrillFallbackKind = "tick-longer" | "always-on";

/** What the run of an alternative found that its definition does not say */
export interface StrategyFindings {
    /** The definition's own qualifiers, such as found by search or the window a swing */
    definition_qualifiers: readonly StrategyQualifier[];
    /** The chest drill fallback the clock ended with, when it fell back */
    chest_drill_fallback?: ChestDrillFallbackKind;
    destroyed_target: boolean;
}

/** The construction that made the windows of a clock built from batched swings */
export function constructionOf(result: Pick<BlueprintGenerationResult, "window_maker" | "grouped_hands" | "primitive_grouped">): StrategyConstruction {
    if (result.grouped_hands !== undefined || result.primitive_grouped !== undefined) return "grouped-hands";
    return result.window_maker === "arithmetic" ? "arithmetic" : "planning-run";
}

/** The families whose windows come from a batched swings maker */
const BATCHED_FAMILIES: readonly DefinitionFamily[] = ["batched-swings", "round-robin-polling", "euclidean-swings"];

/**
 * The strategy of the clock a run made. Its family comes from the definition, except for batched swings, which are round-robin
 * polling where the grouped hands rule built the windows and takt batches elsewhere. The qualifiers are read off the result and
 * what the run did (`findings`), never off a label.
 */
export function strategyOf(
    family: DefinitionFamily,
    result: Pick<BlueprintGenerationResult, "window_maker" | "grouped_hands" | "primitive_grouped" | "loop_windows" | "fuel_hand_room_ticks" | "used_terminal_swing_count" | "pickups_from_entry" | "per_branch">,
    findings: StrategyFindings,
): ClockStrategy {
    const construction = BATCHED_FAMILIES.includes(family) ? constructionOf(result) : undefined;
    const resolved: StrategyFamily = family !== "batched-swings" ? family
        : construction === "grouped-hands" ? "round-robin-polling" : "takt-batches";
    const output_count: OutputCountSetting = { kind: findings.destroyed_target ? "hands_brought_in" : "output_swings", count: result.used_terminal_swing_count };
    const settings: ClockSettings = { output_count, window_cycle: [], belt_pickups: [] };
    if (result.grouped_hands?.shared_windows === true) settings.shared_windows = "shared_enable_windows";
    if (result.grouped_hands?.harmonic_window_cycle === true) settings.window_cycle.push({ kind: "harmonic_window_cycle" });
    if (result.pickups_from_entry === true) settings.belt_pickups.push("counted_from_entry");
    for (const qualifier of findings.definition_qualifiers) {
        // found by search is the selection of the strategy, not a setting; a qualifier that is not a setting of a definition is the record's alone
        if (qualifier === "shorter-window-cycle") settings.window_cycle.push({ kind: "shorter_window_cycle" });
        else if (qualifier === "window-a-swing") settings.shared_windows = "window_a_swing";
    }
    if (result.loop_windows !== undefined) settings.loops = (result.loop_windows.in_loop_ids?.length ?? 0) > 0 ? "loop_windows" : "loop_exits_only";
    if (findings.chest_drill_fallback === "tick-longer") settings.drill_windows = "a_tick_longer";
    if (Object.keys(result.fuel_hand_room_ticks).length > 0) settings.belt_pickups.push("room_for_a_hand_of_fuel");
    const qualifiers = qualifiersOf(settings, {
        found_by_search: findings.definition_qualifiers.includes("found-by-search"),
        drills_always_on: findings.chest_drill_fallback === "always-on"
    });
    return { family: resolved, qualifiers, settings, ...(construction !== undefined && { construction }), output_swings: result.used_terminal_swing_count,
        routing: routingOf(resolved, result.per_branch) };
}

/**
 * The qualifiers the record names for settings, in the order the makers listed them: the output count, shared enable windows, a harmonic
 * window cycle, pickups counted from entry, found by search, a shorter window cycle, a window a swing, the loops, the drills, the fuel
 * hand room, then a subtick or rounded clock (what the listing of the clock adds)
 */
function qualifiersOf(settings: ClockSettings, not_settings: { found_by_search: boolean; drills_always_on: boolean }): StrategyQualifier[] {
    const cycle = (kind: WindowCycleSetting["kind"]) => settings.window_cycle.some(it => it.kind === kind);
    const pickup = (kind: BeltPickupSetting) => settings.belt_pickups.includes(kind);
    return [
        settings.output_count.kind === "hands_brought_in" ? "hands-brought-in" : "output-swings",
        ...(settings.shared_windows === "shared_enable_windows" ? ["shared-enable-windows" as const] : []),
        ...(cycle("harmonic_window_cycle") ? ["harmonic-window-cycle" as const] : []),
        ...(pickup("counted_from_entry") ? ["pickups-from-entry" as const] : []),
        ...(not_settings.found_by_search ? ["found-by-search" as const] : []),
        ...(cycle("shorter_window_cycle") ? ["shorter-window-cycle" as const] : []),
        ...(settings.shared_windows === "window_a_swing" ? ["window-a-swing" as const] : []),
        ...(settings.loops === undefined ? [] : [settings.loops === "loop_windows" ? "loop-windows" as const : "loop-exits-only" as const]),
        ...(settings.drill_windows === "a_tick_longer" ? ["drill-windows-longer" as const] : []),
        ...(not_settings.drills_always_on ? ["drills-always-on" as const] : []),
        ...(pickup("room_for_a_hand_of_fuel") ? ["fuel-hand-room" as const] : []),
        ...(cycle("subtick_clock") ? ["phase-accumulator" as const] : []),
        ...(settings.window_cycle.some(it => it.kind === "rounded_clock") ? ["rounded-clock" as const] : []),
    ];
}

/**
 * The strategy of a clock as it is listed: what its listing adds to the settings of the run's clock, a subtick clock or a clock rounded
 * down (`rounded` says to what and by how much)
 */
export function strategyListedAs(strategy: ClockStrategy, listing: { qualifiers?: readonly StrategyQualifier[]; rounded?: { period_ticks: number; runs_fast: number } }): ClockStrategy {
    const added = listing.qualifiers ?? [];
    const window_cycle: WindowCycleSetting[] = [...strategy.settings.window_cycle];
    if (added.includes("phase-accumulator")) window_cycle.push({ kind: "subtick_clock" });
    if (added.includes("rounded-clock")) {
        if (listing.rounded === undefined) throw new Error("a rounded clock is listed with the ticks it is rounded to");
        window_cycle.push({ kind: "rounded_clock", period_ticks: listing.rounded.period_ticks, runs_fast: listing.rounded.runs_fast });
    }
    return { ...strategy, qualifiers: [...strategy.qualifiers, ...added], settings: { ...strategy.settings, window_cycle } };
}

/** The route of a clock: Coordinated Sources for the per-branch clock, whose sources the run recorded; the direct route for every other */
function routingOf(family: StrategyFamily, per_branch: BlueprintGenerationResult["per_branch"]): ClockRouting {
    if (family !== "per-branch") return { router: "direct" };
    return { router: "coordinated_sources", ...(per_branch !== undefined && { sources: per_branch.sources }) };
}
