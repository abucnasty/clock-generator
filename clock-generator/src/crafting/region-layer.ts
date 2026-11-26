/**
 * The region step: where the build has repeated groups of machines (the detection made before planning, graph/build-regions.ts),
 * the first group is cut out of the build (graph/region-config.ts) and planned alone by the whole generation, its stagger step
 * judging on the whole build (candidates/region-lift.ts). Its recommended clock, and every stable clock of it with fewer wakeups
 * than the whole build's own recommended clock, is lifted onto every group (no shift; the shift a shared machine forces where the
 * clock does not hold as built without it) and listed beside the whole build's clocks, judged as every listed clock is. The
 * ranking, unchanged, recommends one: where no lifted clock holds, the whole build's clock stands.
 *
 * The step runs after Coordinated Sources and before the final ranking; the generation of the cut group runs no region step.
 */
import type { Config } from "../config";
import type { ClockStrategy } from "./clock-strategy";
import type { SerializableClockWindows } from "./clock";
import { OpenRange } from "../data-types";
import type { AlwaysOnReason } from "./enable-control-router";
import { firstOrbitOf, type BuildRegions } from "./graph/build-regions";
import { cutRegionConfig } from "./graph/region-config";
import { liftedSources, offsetsOf, regionLiftOf, shiftedLift, wholePlanOn, type RegionLift, type RegionStaggerEntry } from "./candidates/region-lift";
import { finishedClock } from "./candidates/round-robin-polling";
import { fractionalSwingsOf, type BlueprintGenerationResult, type GenerateClockOptions } from "./plan/unclocked-run";

/** What the result of a lifted clock says of it (`BlueprintGenerationResult.region_layer`) */
export interface RegionLayerDecision {
    /** The group solved ("machine:4/region:1") */
    region: string;
    /** The id of the clock of the cut group that was lifted */
    strategy: string;
    /** The arms and drills of the other groups that took the solved group's windows */
    lifted: string[];
    /** Each other group's shift in ticks, by its key, where a machine the groups share forced one; absent with no shift */
    shift?: Record<string, number>;
}

/** The whole build's recommended clock before the region step: its wakeups (the threshold of what is lifted) and windows (the shift) */
export interface RecommendedForRegions {
    id: string;
    wake_ups: number | null;
    window_cycle_ticks: number;
    windows: SerializableClockWindows;
}

/** What the region step is given: the detection, and the whole build's recommended clock of the clocks listed before it */
export interface RegionLayerInput {
    regions: BuildRegions;
    recommended: RecommendedForRegions;
}

/** A clock of the cut group, as the step reads it from the cut group's listing */
export interface CutClock {
    id: string;
    label: string;
    verdict: string;
    wake_ups: number | null;
    strategy: ClockStrategy;
    result: BlueprintGenerationResult;
}

/** A lifted clock, made on the whole build, for the listing to judge */
export interface LiftedClock {
    from: CutClock;
    result: BlueprintGenerationResult;
}

/** The cut of the first group and its lift; null where the build has no orbit or the first group cannot be cut */
export function regionCutOf(config: Config, regions: BuildRegions): { cut: Config; region: string; lift: RegionLift } | null {
    const orbit = firstOrbitOf(regions);
    if (orbit === null) return null;
    const cut = cutRegionConfig(config, orbit, 0);
    if (cut.kind !== "cut") return null;
    return { cut: cut.config, region: cut.region, lift: regionLiftOf(config, orbit, 0) };
}

/** The clocks of the cut group to lift: its recommended clock, and each other stable clock with fewer wakeups than the whole build's */
export function clocksToLift(clocks: readonly CutClock[], recommended_index: number, whole_wake_ups: number | null): CutClock[] {
    return clocks.filter((clock, index) => index === recommended_index
        || (clock.verdict === "stable" && clock.wake_ups !== null && (whole_wake_ups === null || clock.wake_ups < whole_wake_ups)));
}

/**
 * A clock of the cut group on the whole build: lifted with no shift, made on the whole build planned on its window cycle; where it
 * does not hold as built and the groups take from one anchor machine, made again with each other group at the offset the whole
 * build's recommended clock has (`offsetsOf`). Null where it cannot be made on the whole build.
 */
export function liftedClockOf(whole: Config, lift: RegionLift, region: string, clock: CutClock, recommended: RecommendedForRegions,
    options: GenerateClockOptions): LiftedClock | null {
    const period = clock.result.simulation_duration.ticks;
    if (!Number.isInteger(period)) return null;
    const swings = fractionalSwingsOf(clock.result.output_cycle_plan).fractional_swings === true ? { fractional_swings: true as const } : {};
    const plan = wholePlanOn(whole, { terminal_swing_count: clock.result.used_terminal_swing_count, lcm: clock.result.used_lcm }, period, swings);
    if (plan === null) return null;
    const open = new Map<string, AlwaysOnReason>(Object.entries(clock.result.always_on_reasons ?? {}));
    const lifted = lift.lift(clock.result.clock_windows, open);
    if (lifted.code === "no_drill_map") return null;
    const finish = { ...options, loop_windows: false as const };
    const made = (windows: SerializableClockWindows) => finishedClock(plan, new Map(Object.entries(windows)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const)), [], finish, lifted.left_open);
    let result = made(lifted.windows);
    let shift: Record<string, number> | undefined;
    if (result.stability_check.as_built?.holds !== true && lift.shared_anchor_machine && recommended.window_cycle_ticks === period) {
        const offsets = offsetsOf(lift, recommended.windows, period);
        const shifted = shiftedLift(lift, lifted.windows, offsets, period);
        if (shifted !== null && [...offsets.values()].some(it => it !== 0)) {
            result = made(shifted);
            shift = Object.fromEntries([...offsets].map(([k, value]) => [lift.orbit.regions[k].key, value!]));
        }
    }
    const others = lift.orbit.regions.flatMap((_, k) => k === lift.solved ? [] : lift.takersIn(k));
    const decision: RegionLayerDecision = { region, strategy: clock.id, lifted: others, ...(shift !== undefined && { shift }) };
    const sources = clock.result.coordinated_sources;
    return { from: clock, result: { ...result, region_layer: decision,
        ...(sources !== undefined && { coordinated_sources: { parts: sources.parts, sources: liftedSources(lift, sources.sources) } }) } };
}

/** The maker-log events of the step's stagger proposals, one a proposal */
export function regionStaggerEvents(region: string, entries: readonly RegionStaggerEntry[]) {
    return entries.map(entry => ({ event: "region_stagger" as const, region, ...entry }));
}
