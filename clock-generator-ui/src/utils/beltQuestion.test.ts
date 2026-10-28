import { describe, expect, it } from 'vitest';
import type { ClockRanking } from 'clock-generator/browser';
import { belt, build, inserter } from '../test/fixtures';
import { formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import type { ConfigFormData } from './configForm/formData';
import { BELT_COPY, beltQuestionOf, beltResultsLine, backedUpBeltsFor, otherAnswer, backedUpBeltsHint, withBeltAnswer, type BeltAnswer } from './beltQuestion';
import { configKeyOf, generatedForOf, isStale } from './resultsStaleness';

/** Belt 1 feeds inserter 1, which puts into machine 1 */
const form = () => build({ belts: [belt()], inserters: [inserter(1, { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } })] });
const withLcm = () => edits.updateOverrides(form(), 'lcm', 120);
/** `config` with `answer` stored as the page stores it */
const answered = (config: ConfigFormData, answer: BeltAnswer) => edits.updateOverrides(config, 'backed_up_belts', backedUpBeltsFor(answer));

type Pickup = { source: { type: string; id: number }; sink?: { type: string; id: number } };
const from = (type: string, id = 1): Pickup => ({ source: { type, id } });

describe('beltQuestionOf', () => {
    it.each<[string, Pickup[], number[], boolean]>([
        ['does not ask of an empty build', [], [], false],
        ['asks when an inserter takes from a belt of the build', [from('belt')], [1], true],
        ['does not ask when every inserter takes from a machine or a chest', [from('machine'), from('chest')], [1], false],
        ['does not ask when a belt only receives', [{ ...from('machine'), sink: { type: 'belt', id: 1 } }], [1], false],
        ['does not ask when the belt taken from is not in the build', [from('belt', 2)], [1], false],
        ['asks with two belt-fed inserters', [from('belt'), from('belt', 2)], [1, 2], true],
        ['asks with one belt-fed inserter of several', [from('machine'), from('belt', 2), from('chest')], [2], true],
    ])('%s', (_, inserters, beltIds, ask) => {
        expect(beltQuestionOf({ inserters, belts: beltIds.map(id => ({ id })) })).toEqual({ ask, answer: 'moving' });
    });

    it('reads the answer from the overrides, asked or not', () => {
        const asked = { inserters: [from('belt')], belts: [{ id: 1 }] };
        expect(beltQuestionOf({ ...asked, overrides: { backed_up_belts: true } })).toEqual({ ask: true, answer: 'backed_up' });
        expect(beltQuestionOf({ ...asked, overrides: { backed_up_belts: false } })).toEqual({ ask: true, answer: 'moving' });
        expect(beltQuestionOf({ inserters: [], belts: [], overrides: { backed_up_belts: true } })).toEqual({ ask: false, answer: 'backed_up' });
    });

    it.each(['moving', 'backed_up'] as const)('gives the same for the form and for its config, answered %s', (answer) => {
        const config = answered(form(), answer);
        expect(beltQuestionOf(config)).toEqual({ ask: true, answer });
        expect(beltQuestionOf(formDataToConfig(config))).toEqual({ ask: true, answer });
    });
});

describe('backedUpBeltsFor', () => {
    it('stores nothing for Moving and true for BackedUp', () => {
        expect(backedUpBeltsFor('moving')).toBeUndefined();
        expect(backedUpBeltsFor('backed_up')).toBe(true);
    });

    it('leaves no overrides when Moving takes back the only one', () => {
        const backedUp = answered(form(), 'backed_up');
        expect(beltQuestionOf(backedUp).answer).toBe('backed_up');
        const moving = answered(backedUp, 'moving');
        expect(moving).not.toHaveProperty('overrides');
        expect(formDataToConfig(moving)).not.toHaveProperty('overrides');
        expect(beltQuestionOf(moving).answer).toBe('moving');
    });

    it('keeps the other overrides when Moving takes the answer back', () => {
        expect(answered(answered(withLcm(), 'backed_up'), 'moving').overrides).toEqual({ lcm: 120 });
    });
});

describe('withBeltAnswer', () => {
    it.each<[string, ConfigFormData]>([
        ['no overrides', form()],
        ['an LCM override', withLcm()],
        ['BackedUp already', answered(form(), 'backed_up')],
        ['BackedUp beside an LCM override', answered(withLcm(), 'backed_up')],
        ['an imported false', edits.updateOverrides(form(), 'backed_up_belts', false)],
    ])('gives the key the form has once the answer is set, from %s', (_, start) => {
        for (const answer of ['moving', 'backed_up'] as const) {
            expect(configKeyOf(withBeltAnswer(formDataToConfig(start), answer))).toBe(configKeyOf(formDataToConfig(answered(start, answer))));
        }
    });

    it('leaves the config it was given alone', () => {
        const config = formDataToConfig(answered(form(), 'backed_up'));
        const before = configKeyOf(config);
        withBeltAnswer(config, 'moving');
        expect(configKeyOf(config)).toBe(before);
    });
});

describe('otherAnswer and beltResultsLine', () => {
    it.each([
        ['moving', BELT_COPY.resultsMoving, BELT_COPY.actionMoving, 'backed_up'],
        ['backed_up', BELT_COPY.resultsBackedUp, BELT_COPY.actionBackedUp, 'moving'],
    ] as const)('says the run used the %s belt setting, with the action for the other answer', (answer, text, actionLabel, switchTo) => {
        expect(otherAnswer(answer)).toBe(switchTo);
        expect(beltResultsLine(answer)).toEqual({ text, actionLabel, switchTo });
    });
});

describe('generatedForOf and the belt answer', () => {
    const moving = formDataToConfig(form());
    const backedUp = formDataToConfig(answered(form(), 'backed_up'));

    it('records the question as the config answered it', () => {
        expect(generatedForOf(backedUp).beltQuestion).toEqual(beltQuestionOf(backedUp));
        expect(generatedForOf(backedUp).beltQuestion).toEqual({ ask: true, answer: 'backed_up' });
    });

    it('makes the results out of date when the answer changes', () => {
        expect(configKeyOf(moving)).not.toBe(configKeyOf(backedUp));
        expect(isStale(generatedForOf(moving), configKeyOf(backedUp))).toBe(true);
        expect(isStale(generatedForOf(moving), configKeyOf(moving))).toBe(false);
    });
});

describe('backedUpBeltsHint', () => {
    /** A clock at the target rate made for a moving belt, with 4 windows, unless told otherwise */
    const clock = (wake_ups_per_minute: number | null, ranking: Partial<ClockRanking> = {}) => ({
        ranking: { meets_target_rate: true, rate_off_target: 0, holds_expected_output: true, matches_belt_choice: true, wake_ups_per_minute, window_count: 4, ...ranking },
    });
    const backedUp = (wakeUps: number | null, ranking: Partial<ClockRanking> = {}) => clock(wakeUps, { matches_belt_choice: false, ...ranking });
    const clocks = [clock(177), backedUp(0)];

    it.each([
        ['says how few wake-ups the build may do with on backed-up belts', 177, 0, BELT_COPY.hint(0, 177)],
        ['prints the numbers rounded, as the table does', 176.6, 3.2, BELT_COPY.hint(3, 177)],
    ])('%s', (_, pickWakeUps, backedUpWakeUps, hint) => {
        expect(backedUpBeltsHint([clock(pickWakeUps), backedUp(backedUpWakeUps)], 0, 'moving')).toBe(hint);
    });

    it.each<[string, ReturnType<typeof clock>[], number | null, BeltAnswer]>([
        ['on a backed-up belt result', clocks, 0, 'backed_up'],
        ['with no pick', clocks, null, 'moving'],
        ['with no clocks', [], 0, 'moving'],
        ['when the clock for backed-up belts has as many wake-ups, to a thousandth', [clock(12), backedUp(12.0004)], 0, 'moving'],
        ['when the clock for backed-up belts has more wake-ups', [clock(12), backedUp(30)], 0, 'moving'],
        ['when the best clock for backed-up belts does not meet the rate', [clock(177), backedUp(0, { meets_target_rate: false, rate_off_target: -10 })], 0, 'moving'],
        ['when the pick\'s wake-up count is missing', [clock(null), backedUp(0)], 0, 'moving'],
        ['when the backed-up clock\'s wake-up count is missing', [clock(177), backedUp(null)], 0, 'moving'],
        ['when the difference rounds away', [clock(176.7), backedUp(176.6)], 0, 'moving'],
    ])('says nothing %s', (_, alternatives, pick, used) => {
        expect(backedUpBeltsHint(alternatives, pick, used)).toBeNull();
    });
});
