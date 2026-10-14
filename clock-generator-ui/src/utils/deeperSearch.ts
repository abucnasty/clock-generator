import type { Config } from 'clock-generator/browser';
import { generatedForOf, type GeneratedFor } from './resultsStaleness';

/** The offer under the clock table when the slower searches were left out */
export const DEEPER_SEARCH_OFFER = 'We stopped once we found a working clock. A deeper, slower search might find one with fewer wake-ups.';

export const DEEPER_SEARCH_BUTTON = 'Search deeper';

export const DEEPER_SEARCH_KEEP_ON = 'Keep it on for this build';

export const DEEPER_SEARCH_KEEP_ON_NOTE = 'Turns on "Search for fewer wake-ups" in Advanced Overrides.';

/** Said after a deeper search for one run */
export const DEEPER_SEARCH_DONE_ONCE = 'We searched deeper for this run. These clocks include the slower searches.';

/** Said after every run while "Search for fewer wake-ups" is on */
export const DEEPER_SEARCH_DONE_KEPT = 'Deeper search is on for this build. To stop it, turn off "Search for fewer wake-ups" under Advanced Overrides.';

/** What the notice under the clock table says: nothing, the offer, or that the run searched deeper */
export type DeeperSearchNoticeKind = 'none' | 'offer' | 'searched-once' | 'searched-kept';

/** `config` with "Search for fewer wake-ups" on; a copy, and the same again when it already is */
export function withDeeperSearch(config: Config): Config {
    return { ...config, overrides: { ...config.overrides, search_for_fewer_wake_ups: true } };
}

/**
 * What a generation of the form's `config` runs: the config the engine is given (with the deeper search when
 * `searchDeeper`, for this run only), what the results are recorded as made for, and whether the searches run because
 * they were asked for. The record is the form's config, not the engine's, so a one-run deeper search does not make
 * the results look out of date the moment they arrive.
 */
export function planGenerationRun(
    config: Config,
    searchDeeper: boolean,
): { engineConfig: Config; generatedFor: GeneratedFor; searchedDeeper: boolean } {
    const engineConfig = searchDeeper ? withDeeperSearch(config) : config;
    return {
        engineConfig,
        generatedFor: generatedForOf(config),
        searchedDeeper: engineConfig.overrides?.search_for_fewer_wake_ups === true,
    };
}

/**
 * Which notice shows under the clock table. Nothing while a generation runs or the results are out of date; after a
 * run that searched deeper, whether it was for that run or is kept on (`keptOn`, the form's switch); otherwise the
 * offer when a search was left out.
 */
export function deeperSearchNoticeOf(state: {
    searchesSkipped: boolean;
    searchedDeeper: boolean;
    keptOn: boolean;
    isRunning: boolean;
    stale: boolean;
}): DeeperSearchNoticeKind {
    if (state.isRunning || state.stale) {
        return 'none';
    }
    if (state.searchedDeeper) {
        return state.keptOn ? 'searched-kept' : 'searched-once';
    }
    return state.searchesSkipped ? 'offer' : 'none';
}
