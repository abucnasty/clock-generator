import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { Entity, EntityId } from "../entities";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { generateClockAlternatives, type BlueprintGenerationResult, type ClockAlternative, type ClockAlternativesResult } from "./generate-blueprint";

/** A logger for the generations whose log the test does not read */
export const quiet = { log() { }, warn() { }, error() { }, debug() { } };

export const SEARCH_IDS = ["derived", "uneven-output", "shifted-swings", "full-hand"];
export const SEARCH_LABELS = ["Observed windows", "Uneven output swings", "Shifted swings", "Full-hand output swings"];
export const alternativeIdsOf = (generated: ClockAlternativesResult) => generated.alternatives.map(alternative => alternative.id);
export const selectedAlternativeOf = (generated: ClockAlternativesResult) => generated.alternatives[generated.selected_index];

/**
 * The config with the four searches asked for (`overrides.search_for_fewer_wake_ups`): for a test of a search's clock
 * on a sample where a clock made without a search is stable, so that the searches would not run
 */
export const withSearches = (config: Config): Config =>
    ({ ...config, overrides: { ...config.overrides, search_for_fewer_wake_ups: true } });

export interface RocketFuelSample {
    config: Config;
    alternatives: ClockAlternative[];
    alternative: (id: string) => ClockAlternative;
    /** Items an inserter moves in the planned period */
    moved: (inserter_id: string) => number;
    period: number;
    jelly_inserter_ids: string[];
    output_inserter_ids: string[];
    jellynut_inserter_id: string;
    bioflux_inserter_ids: string[];
}

/** What the rocket fuel samples have in common: two rocket fuel biochambers fed jelly by one jellynut biochamber */
export const rocketFuelSample = async (path: string): Promise<RocketFuelSample> => {
    const config = await loadConfigFromFile(path);
    const ids = (matches: (inserter: Config["inserters"][number]) => boolean) =>
        config.inserters.filter(matches).map(inserter => EntityId.forInserter(inserter.id!).id);
    // with the searches, whose clocks the tests of these samples read as well: batched swings is stable on both
    const { alternatives } = generateClockAlternatives(withSearches(config));
    const alternative = (id: string) => alternatives.find(a => a.id === id)!;
    const moved = (inserter_id: string): number => alternative("planned").result.serializable_transfer_history.entities
        .find(entity => entity.entity_id === inserter_id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
    return {
        config,
        alternatives,
        alternative,
        moved,
        period: alternative("planned").result.simulation_duration.ticks,
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
