import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { Entity, EntityId } from "../entities";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { generateClockAlternatives, type BlueprintGenerationResult, type ClockAlternative, type ClockAlternativesResult } from "./generate-blueprint";
import { OutputCyclePlan } from "./sequence/cycle/output-cycle";
import { TargetProductionRate } from "./target-production-rate";
import { fraction } from "../data-types/fraction";

/** A logger for the generations whose log the test does not read */
export const quiet = { log() { }, warn() { }, error() { }, debug() { } };

export const SEARCH_MAKERS = ["derived", "uneven-output", "shifted-swings", "full-hand"];
export const SEARCH_LABELS = ["Time-Study Windows", "Moved Output Swing", "Phase-Shifted Batch", "Pitch Pickups"];
export const alternativeMakersOf = (generated: ClockAlternativesResult) => generated.alternatives.map(alternative => alternative.maker);
export const selectedAlternativeOf = (generated: ClockAlternativesResult) => generated.alternatives[generated.selected_index];

/**
 * The config with the four searches asked for (`overrides.search_for_fewer_wake_ups`): for a test of a search's clock
 * on a sample where a clock made without a search is stable, so that the searches would not run
 */
export const withSearches = (config: Config): Config =>
    ({ ...config, overrides: { ...config.overrides, search_for_fewer_wake_ups: true } });

/**
 * The clock as the "Euclidean Swings" alternative would have made it: its cycle plan made again at its output swings
 * a cycle with fractional swings asked for, which the checks of the clock read (`fractionalSwingsOf`)
 */
export function plannedFractionally(planned_on: Config, made: BlueprintGenerationResult): BlueprintGenerationResult {
    const count = made.used_terminal_swing_count;
    const output_cycle_plan = OutputCyclePlan.create(TargetProductionRate.fromConfig(planned_on.setpoint),
        createEntityRegistryFromConfig(planned_on), planned_on, fraction(count), { ...planned_on.overrides, terminal_swing_count: count }, undefined, true);
    return { ...made, output_cycle_plan };
}

/**
 * The production science sample with the two pickups of its input belt made one inserter with two filters, and the packs
 * put onto that belt: the build whose input inserter has a fractional hand count (3/2 swings a cycle) when fractional
 * swings are on. Built from the sample, with no override.
 */
export const productionScienceSharedPickup = (config: Config): Config => {
    const [output_belt, input_belt] = config.belts;
    const pickups = config.inserters.filter(inserter => inserter.source.type === "belt" && inserter.source.id === input_belt.id);
    const [first, ...others] = pickups;
    const merged = { ...first, filters: pickups.flatMap(inserter => inserter.filters ?? []) };
    return {
        ...config,
        belts: [input_belt],
        inserters: config.inserters
            .filter(inserter => !others.includes(inserter))
            .map(inserter => inserter === first ? merged
                : inserter.sink.type === "belt" && inserter.sink.id === output_belt.id ? { ...inserter, sink: { ...inserter.sink, id: input_belt.id } } : inserter),
    };
};

export interface RocketFuelSample {
    config: Config;
    alternatives: ClockAlternative[];
    alternative: (id: string) => ClockAlternative;
    /** Items an inserter moves in the planned window cycle */
    moved: (inserter_id: string) => number;
    window_cycle_ticks: number;
    jelly_inserter_ids: string[];
    output_inserter_ids: string[];
    jellynut_inserter_id: string;
    bioflux_inserter_ids: string[];
}

/** What the rocket fuel samples have in common: two rocket fuel biochambers fed jelly by one jellynut biochamber */
export const rocketFuelSample = async (source: string | Config): Promise<RocketFuelSample> => {
    const config = typeof source === "string" ? await loadConfigFromFile(source) : source;
    const ids = (matches: (inserter: Config["inserters"][number]) => boolean) =>
        config.inserters.filter(matches).map(inserter => EntityId.forInserter(inserter.id!).id);
    // with the searches, whose clocks the tests of these samples read as well: batched swings is stable on both
    const { alternatives } = generateClockAlternatives(withSearches(config));
    const alternative = (id: string) => alternatives.find(a => a.maker === id)!;
    const moved = (inserter_id: string): number => alternative("planned-belt-slack").result.serializable_transfer_history.entities
        .find(entity => entity.entity_id === inserter_id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
    return {
        config,
        alternatives,
        alternative,
        moved,
        window_cycle_ticks: alternative("planned-belt-slack").result.simulation_duration.ticks,
        jelly_inserter_ids: ids(it => it.source.type === "machine" && it.sink.type === "machine"),
        output_inserter_ids: ids(it => it.source.type === "machine" && it.sink.type === "belt" && it.source.id !== 2),
        // belt 1 carries bioflux and jellynut: machine 2 takes the jellynut, the rocket fuel machines the bioflux
        jellynut_inserter_id: ids(it => it.source.type === "belt" && it.source.id === 1 && it.sink.id === 2)[0],
        bioflux_inserter_ids: ids(it => it.source.type === "belt" && it.source.id === 1 && it.sink.id !== 2),
    };
};

/**
 * Where the clock's inserters and drills are always on and the result says nothing of why, or says why for one that has
 * windows (or a clock of its own): "swings-2: inserter:2", "planned: drill:1 has windows". Empty when every one that is on
 * all the time names its reason.
 */
export function alwaysOnReasonProblems(config: Config, result: BlueprintGenerationResult, label: string): string[] {
    const ids = createEntityRegistryFromConfig(config).getAll().filter(it => Entity.isInserter(it) || Entity.isDrill(it)).map(it => it.entity_id.id);
    const on = (id: string) => result.clock_windows[id] === undefined && result.unplanned_inserter_clocks?.[id]?.own_clock !== true;
    return [
        ...ids.filter(id => on(id) && result.always_on_reasons?.[id] === undefined).map(id => `${label}: ${id} is always on with no reason`),
        ...Object.keys(result.always_on_reasons ?? {}).filter(id => !ids.includes(id) || !on(id)).map(id => `${label}: ${id} has a reason and is not always on`),
    ];
}

/** The problems of every alternative of a generation (see alwaysOnReasonProblems) */
export const alwaysOnReasonProblemsOf = (config: Config, generated: Pick<ClockAlternativesResult, "alternatives">): string[] =>
    generated.alternatives.flatMap(alternative => alwaysOnReasonProblems(config, alternative.result, alternative.id));
