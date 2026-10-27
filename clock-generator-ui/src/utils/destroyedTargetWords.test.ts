import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { rateVerbs } from './targetCounts';
import { SUMMARY_COPY, differenceFromRecommended, foldedMakes, plainClockName, type SummaryClock } from './clockSummary';
import { makesHeader } from './numberText';
import { recommendationReason, type PickRule } from './recommendedClock';
import { generatedForOf, generatedForText, staleResultsMessage } from './resultsStaleness';
import { sharedBuildSummary } from './shareLink';
import { exampleSummary, readExampleManifest } from './exampleBuilds';

// the words of the results for a build whose target counts the item destroyed: a clock destroys the rate, it does not make it

const ranking = { meets_target_rate: true, rate_off_target: 0, holds_expected_output: true, matches_belt_choice: true,
    wake_ups_per_minute: 0, window_count: 3 } as SummaryClock['ranking'];
const clock = (id: string, counts?: 'destroyed', rate = 400, off = 0): SummaryClock => ({
    id, label: id, verdict: 'stable', deciders: 2, beltLabel: '', deadlockRisk: null, ...(counts && { counts }),
    ranking: { ...ranking, rate_off_target: off, meets_target_rate: off === 0 },
    assessment: { items_per_second: rate, holds: true, wake_ups_per_minute: 0 } as SummaryClock['assessment'],
});

describe('rateVerbs', () => {
    it('says make for the item made and destroy for the item destroyed', () => {
        expect(rateVerbs(undefined)).toEqual({ title: 'Makes', third: 'makes', base: 'make', ing: 'making' });
        expect(rateVerbs('made')).toEqual(rateVerbs(undefined));
        expect(rateVerbs('destroyed')).toEqual({ title: 'Destroys', third: 'destroys', base: 'destroy', ing: 'destroying' });
    });
});

describe('the results of a target that counts the item destroyed', () => {
    it('name a clock that is another way to reach the rate by what it destroys', () => {
        // wake-ups not counted: the one with the fewest wake windows is named so, the other is another way
        const withWindows = (id: string, window_count: number) => {
            const it = clock(id, 'destroyed');
            return { ...it, ranking: { ...it.ranking, wake_ups_per_minute: null, window_count } };
        };
        const clocks = [withWindows('a', 5), withWindows('b', 3)];
        expect(plainClockName(clocks, 0)).toBe('Another way to destroy 400/s');
        expect(SUMMARY_COPY.another('400')).toBe('Another way to make 400/s');
    });

    it('say what a clock off the rate destroys, as the recommended clock is compared', () => {
        const base = clock('s', 'destroyed', 392, -8);
        const selected = { ...base, verdict: 'unstable' as const, assessment: { ...base.assessment, holds: false } };
        expect(differenceFromRecommended(selected, clock('r', 'destroyed'))).toBe('This one destroys 392/s, not 400/s. It does not hold its rate.');
        expect(differenceFromRecommended({ ...selected, counts: undefined }, clock('r'))).toBe('This one makes 392/s, not 400/s. It does not hold its rate.');
    });

    it('fold the table\'s column into one line that says destroy', () => {
        expect(foldedMakes([clock('a', 'destroyed'), clock('b', 'destroyed'), clock('c', 'destroyed')])).toBe('All 3 clocks destroy 400/s.');
        expect(foldedMakes([clock('a'), clock('b'), clock('c')])).toBe('All 3 clocks make 400/s.');
    });

    it('head the column Destroys', () => {
        expect(makesHeader(1, 'destroyed')).toBe('Destroys (items/s)');
        expect(makesHeader(4, 'destroyed')).toBe('Destroys (items/s,\u00a0all\u00a04\u00a0copies)');
        expect(makesHeader(4)).toBe('Makes (items/s,\u00a0all\u00a04\u00a0copies)');
    });

    it('say the clocks keep destroying the rate in the reason for the pick', () => {
        const rule: PickRule = { backedUpBelts: false, searchedForFewerWakeUps: false };
        const clocks = [{ ...clock('a', 'destroyed'), inserterWindowCount: 3, wake_ups: 0 }, { ...clock('b', 'destroyed', 400), inserterWindowCount: 3 }]
            .map((it, index) => ({ ...it, ranking: { ...it.ranking, wake_ups_per_minute: index === 0 ? 0 : 5 } }));
        expect(recommendationReason(clocks, 0, rule, true)).toBe('Fewest wake-ups of the clocks that keep destroying 400/s and recover.');
        expect(recommendationReason(clocks.map(it => ({ ...it, counts: undefined })), 0, rule, true))
            .toBe('Fewest wake-ups of the clocks that keep making 400/s and recover.');
    });
});

describe('the sentences about a build that count the item destroyed', () => {
    const config = (counts?: 'destroyed'): Config => ({ target_output: { recipe: 'iron-ore', items_per_second: 400, copies: 1, ...(counts && { counts }) },
        machines: [{ id: 1, recipe: '', crafting_speed: 16.875, productivity: 0, prototype: 'recycler' }], inserters: [], belts: [], chests: [] });
    const label = (id: string) => (id === 'iron-ore' ? 'Iron ore' : id);

    it('name what the old clocks were made for', () => {
        const destroyed = generatedForOf(config('destroyed'), 0);
        expect(destroyed.counts).toBe('destroyed');
        expect('counts' in generatedForOf(config(), 0)).toBe(false);
        expect(generatedForText(destroyed, label)).toBe('Iron ore at 400/s destroyed');
        expect(generatedForText(generatedForOf(config(), 0), label)).toBe('Iron ore at 400/s');
        expect(staleResultsMessage(destroyed, [], { recipeLabel: label, now: Date.UTC(2026, 9, 24, 15), locale: 'en-US' }))
            .toContain('These clocks are for Iron ore at 400/s destroyed, made ');
    });

    it('summarise a shared build and an example by the rate and that it is destroyed', () => {
        expect(sharedBuildSummary(config('destroyed'), label)).toBe('Iron ore at 400/s destroyed · 1 copy · 1 machine');
        expect(sharedBuildSummary(config('destroyed'), label, { withRecipe: false })).toBe('400/s destroyed · 1 copy · 1 machine');
        expect(sharedBuildSummary(config(), label)).toBe('Iron ore at 400/s · 1 copy · 1 machine');
        const example = { id: 'ore-voider', file: 'ore-voider.json', recipe: 'iron-ore', items_per_second: 400, counts: 'destroyed' as const, copies: 1, machines: 1, inserters: 6, belts: 0, chests: 2 };
        expect(exampleSummary(example)).toBe('400/s destroyed · 1 copy · 1 machine, 6 inserters');
        const { counts: _, ...made } = example;
        void _;
        expect(exampleSummary(made)).toBe('400/s · 1 copy · 1 machine, 6 inserters');
        expect(readExampleManifest(JSON.stringify([example]))).toEqual([example]);
        expect(readExampleManifest(JSON.stringify([{ ...example, counts: 'sold' }]))).toEqual([]);
    });
});
