/**
 * The region step as a task (region-layer.ts): what the site's pool needs to run it after every other task, without the engine. It
 * runs where the detection found repeated groups of machines, after Coordinated Sources, from the clock the runs before it
 * recommend. Light: it reads the detection and the runs, and plans nothing.
 */
import type { SerializableClockWindows } from "./clock";
import type { BuildRegions } from "./graph/build-regions";
import type { ClockAlternativeRun } from "./alternatives";
import { combineClockAlternativeRuns, type ClockRanking } from "./rank";

/** The maker slot of the region step: its seconds and ticks, the generation of the cut group's included */
export const REGION_LAYER_MAKER = "region-layer";
export const REGION_LAYER_LABEL = "One group's clock on every repeated group";

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

/** The task of the region step, made last: where the detection found repeated groups of machines that may be cut, else null */
export function regionLayerTaskOf(context: { regions?: BuildRegions }): { id: string; label: string; only_when_needed: false; region_layer: true } | null {
    return context.regions?.orbits?.some(it => it.kind === "orbit") === true
        ? { id: REGION_LAYER_MAKER, label: REGION_LAYER_LABEL, only_when_needed: false, region_layer: true } : null;
}

/**
 * What the region step is given, from the runs before it: the detection, and the clock they recommend (`recommendedOf` reads it of
 * a listed clock). Null where the build has no repeated groups of machines or no clock was made.
 */
export function regionLayerInputOf<T>(runs: readonly (ClockAlternativeRun<T> | null)[], regions: BuildRegions | undefined,
    rankingOf: (alternative: T) => ClockRanking, recommendedOf: (alternative: T) => RecommendedForRegions): RegionLayerInput | null {
    if (regionLayerTaskOf({ regions }) === null) return null;
    const so_far = combineClockAlternativeRuns([...runs], rankingOf);
    const recommended = so_far.alternatives[so_far.selected_index];
    return recommended === undefined ? null : { regions: regions!, recommended: recommendedOf(recommended) };
}
