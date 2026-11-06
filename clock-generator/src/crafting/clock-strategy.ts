import type { BlueprintGenerationResult } from "./plan/plan-run";

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
    | "exhaust";

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
    | "found-by-search";

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
    qualifiers: StrategyQualifier[];
    /** Set for the families made from batched swings (takt batches, round-robin polling, euclidean swings); absent for the others */
    construction?: StrategyConstruction;
    /** The output swings a crafting cycle the clock ended up with; for a target that counts an item destroyed, the hands brought in a cycle */
    output_swings: number;
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
    result: Pick<BlueprintGenerationResult, "window_maker" | "grouped_hands" | "primitive_grouped" | "loop_windows" | "fuel_hand_room_ticks" | "used_terminal_swing_count">,
    findings: StrategyFindings,
): ClockStrategy {
    const construction = BATCHED_FAMILIES.includes(family) ? constructionOf(result) : undefined;
    const resolved: StrategyFamily = family !== "batched-swings" ? family
        : construction === "grouped-hands" ? "round-robin-polling" : "takt-batches";
    const qualifiers: StrategyQualifier[] = [findings.destroyed_target ? "hands-brought-in" : "output-swings"];
    if (result.grouped_hands?.shared_windows === true) qualifiers.push("shared-enable-windows");
    qualifiers.push(...findings.definition_qualifiers);
    if (result.loop_windows !== undefined) {
        qualifiers.push((result.loop_windows.in_loop_ids?.length ?? 0) > 0 ? "loop-windows" : "loop-exits-only");
    }
    if (findings.chest_drill_fallback !== undefined) {
        qualifiers.push(findings.chest_drill_fallback === "tick-longer" ? "drill-windows-longer" : "drills-always-on");
    }
    if (Object.keys(result.fuel_hand_room_ticks).length > 0) qualifiers.push("fuel-hand-room");
    return { family: resolved, qualifiers, ...(construction !== undefined && { construction }), output_swings: result.used_terminal_swing_count };
}
