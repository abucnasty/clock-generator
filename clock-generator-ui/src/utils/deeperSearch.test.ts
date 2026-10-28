import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { build, machine } from '../test/fixtures';
import * as edits from './configForm/edits';
import { formDataToConfig } from './configForm/configMapping';
import type { ConfigFormData } from './configForm/formData';
import { configKeyOf, isStale } from './resultsStaleness';
import {
    DEEPER_SEARCH_OFFER,
    deeperSearchDoneKept,
    deeperSearchDoneOnce,
    deeperSearchNoticeOf,
    planGenerationRun,
    withDeeperSearch,
    type DeeperSearchNoticeKind,
} from './deeperSearch';

/** A form that can be turned into a config: a recipe, a rate and one machine */
const form = (): ConfigFormData => build({
    target_output: { recipe: 'electronic-circuit', items_per_second: 240, copies: 1 },
    machines: [machine(1, { recipe: 'electronic-circuit' })],
});

const config = (): Config => formDataToConfig(form());

describe('withDeeperSearch', () => {
    it('turns the search on for a config without overrides, and does not change its argument', () => {
        const plain = config();
        expect(withDeeperSearch(plain).overrides).toEqual({ search_for_fewer_wake_ups: true });
        expect(plain.overrides).toBeUndefined();
    });

    it('keeps the other overrides', () => {
        const withOthers = formDataToConfig({ ...form(), overrides: { lcm: 12, ignored_lcm_ingredients: ['copper-cable'] } });
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
        expect(planGenerationRun(withDeeperSearch(config()), false).searchedDeeper).toBe(true);
    });

    it.each<[string, () => ConfigFormData]>([
        ['no overrides', form],
        ['the LCM set', () => edits.updateOverrides(form(), 'lcm', 12)],
        ['the switch saved as off', () => ({ ...form(), overrides: { search_for_fewer_wake_ups: false } })],
    ])('keeping it on gives the key of the form with the switch turned on, with %s', (_, make) => {
        const before = make();
        const kept = withDeeperSearch(formDataToConfig(before));
        const formKey = configKeyOf(formDataToConfig(edits.updateOverrides(before, 'search_for_fewer_wake_ups', true)));
        expect(configKeyOf(kept)).toBe(formKey);
        expect(isStale(planGenerationRun(kept, false).generatedFor, formKey)).toBe(false);
    });
});

describe('deeperSearchNoticeOf', () => {
    const state = { searchesSkipped: false, searchedDeeper: false, keptOn: false, isRunning: false, stale: false };

    it.each<[string, Partial<typeof state>, DeeperSearchNoticeKind]>([
        ['shows nothing while a generation that does not search deeper runs, even when searches were skipped', { searchesSkipped: true, isRunning: true }, 'none'],
        ['says a deeper search is going while one runs, so the notice and its focus stay', { searchedDeeper: true, isRunning: true }, 'searching'],
        ['says a deeper search is going while one kept on runs', { searchedDeeper: true, keptOn: true, isRunning: true }, 'searching'],
        ['shows nothing while the results are out of date, instead of the offer', { searchesSkipped: true, stale: true }, 'none'],
        ['shows nothing while the results are out of date, after a deeper search', { searchedDeeper: true, stale: true }, 'none'],
        ['shows nothing while the results are out of date, while a deeper search runs', { searchedDeeper: true, isRunning: true, stale: true }, 'none'],
        ['offers a deeper search when a search was skipped', { searchesSkipped: true }, 'offer'],
        ['says the run searched deeper for this run', { searchedDeeper: true }, 'searched-once'],
        ['says the run searched deeper with it kept on', { searchedDeeper: true, keptOn: true }, 'searched-kept'],
        ['shows nothing when no search was skipped and none was asked for', {}, 'none'],
        ['says the run searched deeper when it also skipped a search, which should not happen', { searchesSkipped: true, searchedDeeper: true }, 'searched-once'],
    ])('%s', (_, change, notice) => {
        expect(deeperSearchNoticeOf({ ...state, ...change })).toBe(notice);
    });
});

describe('the notice\'s words', () => {
    it('offers in the plan\'s sentence', () => {
        expect(DEEPER_SEARCH_OFFER).toBe('We stopped once we found a working clock. A deeper, slower search might find one with fewer wake-ups.');
    });

    const pick = 'Shifted swings: 2 output swings per cycle';
    it.each([
        ['for this run', deeperSearchDoneOnce, 'We searched deeper for this run. These clocks include the slower searches.', ''],
        ['kept on', deeperSearchDoneKept, 'Deeper search is on for this build.', ' To stop it, turn off "Search for fewer wake-ups" under Advanced.'],
    ])('after a deeper search %s, names the new pick, and leaves it out when there is none', (_, done, start, end) => {
        expect(done(pick)).toBe(`${start} Recommended is now ${pick}.${end}`);
        expect(done(null)).toBe(`${start}${end}`);
    });
});
