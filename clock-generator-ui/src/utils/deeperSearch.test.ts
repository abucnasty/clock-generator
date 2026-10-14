import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import * as edits from './configForm/edits';
import { formDataToConfig } from './configForm/configMapping';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { configKeyOf, isStale } from './resultsStaleness';
import {
    DEEPER_SEARCH_OFFER,
    deeperSearchDoneKept,
    deeperSearchDoneOnce,
    deeperSearchNoticeOf,
    planGenerationRun,
    withDeeperSearch,
} from './deeperSearch';

/** A form that can be turned into a config: a recipe, a rate and one machine */
function form(): ConfigFormData {
    const config = createDefaultConfig();
    return {
        ...config,
        target_output: { ...config.target_output, recipe: 'electronic-circuit', items_per_second: 240 },
        machines: config.machines.map(machine => ({ ...machine, recipe: 'electronic-circuit' })),
    };
}

const config = (): Config => formDataToConfig(form());

describe('withDeeperSearch', () => {
    it('turns the search on for a config without overrides', () => {
        const plain = config();
        expect(plain.overrides).toBeUndefined();
        expect(withDeeperSearch(plain).overrides).toEqual({ search_for_fewer_wake_ups: true });
    });

    it('keeps the other overrides', () => {
        const withOthers = formDataToConfig(edits.updateOverrides(
            edits.updateOverrides(form(), 'lcm', 12), 'ignored_lcm_ingredients', ['copper-cable'],
        ));
        expect(withDeeperSearch(withOthers).overrides).toEqual({
            lcm: 12,
            ignored_lcm_ingredients: ['copper-cable'],
            search_for_fewer_wake_ups: true,
        });
    });

    it('is the same when applied twice', () => {
        const once = withDeeperSearch(config());
        expect(withDeeperSearch(once)).toEqual(once);
        expect(configKeyOf(withDeeperSearch(once))).toBe(configKeyOf(once));
    });

    it('does not change its argument', () => {
        const plain = config();
        withDeeperSearch(plain);
        expect(plain.overrides).toBeUndefined();
    });
});

describe('planGenerationRun', () => {
    it('runs the config as it is for a plain Generate', () => {
        const plain = config();
        const run = planGenerationRun(plain, false);
        expect(run.engineConfig).toBe(plain);
        expect(run.searchedDeeper).toBe(false);
    });

    it('searches deeper for one run and records the form\'s key, so the results do not look out of date', () => {
        const plain = config();
        const run = planGenerationRun(plain, true);
        expect(run.engineConfig.overrides?.search_for_fewer_wake_ups).toBe(true);
        expect(run.generatedFor.key).toBe(configKeyOf(plain));
        expect(isStale(run.generatedFor, configKeyOf(plain))).toBe(false);
        expect(run.generatedFor.key).not.toBe(configKeyOf(run.engineConfig));
        expect(run.searchedDeeper).toBe(true);
    });

    it('says the run searched deeper when the form already has the switch on', () => {
        const kept = withDeeperSearch(config());
        expect(planGenerationRun(kept, false).searchedDeeper).toBe(true);
    });

    describe('keeping it on gives the key of the form with the switch turned on', () => {
        const forms: [string, () => ConfigFormData][] = [
            ['no overrides', form],
            ['the LCM set', () => edits.updateOverrides(form(), 'lcm', 12)],
            ['the switch saved as off', () => ({ ...form(), overrides: { search_for_fewer_wake_ups: false } })],
        ];
        it.each(forms)('with %s', (_, make) => {
            const before = make();
            const kept = withDeeperSearch(formDataToConfig(before));
            const formKey = configKeyOf(formDataToConfig(edits.updateOverrides(before, 'search_for_fewer_wake_ups', true)));
            expect(configKeyOf(kept)).toBe(formKey);
            expect(isStale(planGenerationRun(kept, false).generatedFor, formKey)).toBe(false);
        });
    });
});

describe('deeperSearchNoticeOf', () => {
    const state = { searchesSkipped: false, searchedDeeper: false, keptOn: false, isRunning: false, stale: false };

    it('shows nothing while a generation that does not search deeper runs, even when searches were skipped', () => {
        expect(deeperSearchNoticeOf({ ...state, searchesSkipped: true, isRunning: true })).toBe('none');
    });

    it('says a deeper search is going while one runs, so the notice and its focus stay', () => {
        expect(deeperSearchNoticeOf({ ...state, searchedDeeper: true, isRunning: true })).toBe('searching');
        expect(deeperSearchNoticeOf({ ...state, searchedDeeper: true, keptOn: true, isRunning: true })).toBe('searching');
    });

    it('shows nothing while the results are out of date', () => {
        expect(deeperSearchNoticeOf({ ...state, searchesSkipped: true, stale: true })).toBe('none');
        expect(deeperSearchNoticeOf({ ...state, searchedDeeper: true, stale: true })).toBe('none');
        expect(deeperSearchNoticeOf({ ...state, searchedDeeper: true, isRunning: true, stale: true })).toBe('none');
    });

    it('offers a deeper search when a search was skipped', () => {
        expect(deeperSearchNoticeOf({ ...state, searchesSkipped: true })).toBe('offer');
    });

    it('says the run searched deeper, for this run or kept on', () => {
        expect(deeperSearchNoticeOf({ ...state, searchedDeeper: true })).toBe('searched-once');
        expect(deeperSearchNoticeOf({ ...state, searchedDeeper: true, keptOn: true })).toBe('searched-kept');
    });

    it('shows nothing when no search was skipped and none was asked for', () => {
        expect(deeperSearchNoticeOf(state)).toBe('none');
    });

    it('says the run searched deeper when it also skipped a search, which should not happen', () => {
        expect(deeperSearchNoticeOf({ ...state, searchesSkipped: true, searchedDeeper: true })).toBe('searched-once');
    });
});

describe('DEEPER_SEARCH_OFFER', () => {
    it('is the plan\'s sentence', () => {
        expect(DEEPER_SEARCH_OFFER).toBe('We stopped once we found a working clock. A deeper, slower search might find one with fewer wake-ups.');
    });
});

describe('after a deeper search', () => {
    it('names the new pick', () => {
        expect(deeperSearchDoneOnce('Shifted swings: 2 output swings per cycle'))
            .toBe('We searched deeper for this run. These clocks include the slower searches. Recommended is now Shifted '
                + 'swings: 2 output swings per cycle.');
        expect(deeperSearchDoneKept('Shifted swings: 2 output swings per cycle'))
            .toBe('Deeper search is on for this build. Recommended is now Shifted swings: 2 output swings per cycle. To '
                + 'stop it, turn off "Search for fewer wake-ups" under Advanced Overrides.');
    });

    it('leaves the pick out when there is none', () => {
        expect(deeperSearchDoneOnce(null)).toBe('We searched deeper for this run. These clocks include the slower searches.');
        expect(deeperSearchDoneKept(null))
            .toBe('Deeper search is on for this build. To stop it, turn off "Search for fewer wake-ups" under Advanced Overrides.');
    });
});
