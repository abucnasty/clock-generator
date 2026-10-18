import { describe, expect, it } from 'vitest';
import type { ClockRanking } from 'clock-generator/browser';
import { formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { BELT_COPY, beltQuestionOf, beltResultsLine, nonMovingBeltsFor, otherAnswer, standingBeltsHint, withBeltAnswer, type BeltAnswer } from './beltQuestion';
import { configKeyOf, generatedForOf, isStale } from './resultsStaleness';

/** A build as the page holds it: belt 1 feeds inserter 1, which puts into machine 1 */
function form(): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.updateTargetOutput(config, 'recipe', 'logistic-science-pack');
    config = edits.updateMachine(config, 0, 'recipe', 'logistic-science-pack');
    config = edits.addBelt(config);
    config = edits.addInserter(config);
    return edits.updateInserter(config, 0, { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } });
}

const fromBelt = (id: number) => ({ source: { type: 'belt', id } });
const fromMachine = (id: number) => ({ source: { type: 'machine', id } });
const fromChest = (id: number) => ({ source: { type: 'chest', id } });

describe('beltQuestionOf', () => {
    it('does not ask of an empty build', () => {
        expect(beltQuestionOf({ inserters: [], belts: [] })).toEqual({ ask: false, answer: 'moving' });
    });

    it('asks when an inserter takes from a belt of the build', () => {
        expect(beltQuestionOf({ inserters: [fromBelt(1)], belts: [{ id: 1 }] }).ask).toBe(true);
    });

    it('does not ask when every inserter takes from a machine or a chest', () => {
        expect(beltQuestionOf({ inserters: [fromMachine(1), fromChest(1)], belts: [{ id: 1 }] }).ask).toBe(false);
    });

    it('does not ask when a belt only receives', () => {
        const build = { inserters: [{ source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 } }], belts: [{ id: 1 }] };
        expect(beltQuestionOf(build).ask).toBe(false);
    });

    it('does not ask when the belt taken from is not in the build', () => {
        expect(beltQuestionOf({ inserters: [fromBelt(2)], belts: [{ id: 1 }] }).ask).toBe(false);
    });

    it('asks with two belt-fed inserters, or one of several', () => {
        expect(beltQuestionOf({ inserters: [fromBelt(1), fromBelt(2)], belts: [{ id: 1 }, { id: 2 }] }).ask).toBe(true);
        expect(beltQuestionOf({ inserters: [fromMachine(1), fromBelt(2), fromChest(1)], belts: [{ id: 2 }] }).ask).toBe(true);
    });

    it('reads the answer from the overrides, asked or not', () => {
        const build = { inserters: [fromBelt(1)], belts: [{ id: 1 }] };
        expect(beltQuestionOf(build).answer).toBe('moving');
        expect(beltQuestionOf({ ...build, overrides: { non_moving_belts: true } }).answer).toBe('standing');
        expect(beltQuestionOf({ ...build, overrides: { non_moving_belts: false } }).answer).toBe('moving');
        expect(beltQuestionOf({ inserters: [], belts: [], overrides: { non_moving_belts: true } }))
            .toEqual({ ask: false, answer: 'standing' });
    });

    it('gives the same for the form and for its config', () => {
        const moving = form();
        const standing = edits.updateOverrides(moving, 'non_moving_belts', true);
        expect(beltQuestionOf(moving)).toEqual({ ask: true, answer: 'moving' });
        expect(beltQuestionOf(formDataToConfig(moving))).toEqual(beltQuestionOf(moving));
        expect(beltQuestionOf(standing)).toEqual({ ask: true, answer: 'standing' });
        expect(beltQuestionOf(formDataToConfig(standing))).toEqual(beltQuestionOf(standing));
    });
});

describe('nonMovingBeltsFor', () => {
    it('stores nothing for Moving and true for Standing', () => {
        expect(nonMovingBeltsFor('moving')).toBeUndefined();
        expect(nonMovingBeltsFor('standing')).toBe(true);
    });

    it('leaves no overrides when Moving takes back the only one', () => {
        const standing = edits.updateOverrides(form(), 'non_moving_belts', nonMovingBeltsFor('standing'));
        expect(beltQuestionOf(standing).answer).toBe('standing');
        const moving = edits.updateOverrides(standing, 'non_moving_belts', nonMovingBeltsFor('moving'));
        expect(moving).not.toHaveProperty('overrides');
        expect(formDataToConfig(moving)).not.toHaveProperty('overrides');
        expect(beltQuestionOf(moving).answer).toBe('moving');
    });

    it('keeps the other overrides when Moving takes the answer back', () => {
        const withLcm = edits.updateOverrides(form(), 'lcm', 120);
        const standing = edits.updateOverrides(withLcm, 'non_moving_belts', nonMovingBeltsFor('standing'));
        const moving = edits.updateOverrides(standing, 'non_moving_belts', nonMovingBeltsFor('moving'));
        expect(moving.overrides).toEqual({ lcm: 120 });
    });
});

describe('withBeltAnswer', () => {
    const setOnForm = (config: ConfigFormData, answer: BeltAnswer) =>
        edits.updateOverrides(config, 'non_moving_belts', nonMovingBeltsFor(answer));
    const forms: [string, ConfigFormData][] = [
        ['no overrides', form()],
        ['an LCM override', edits.updateOverrides(form(), 'lcm', 120)],
        ['Standing already', setOnForm(form(), 'standing')],
        ['Standing beside an LCM override', setOnForm(edits.updateOverrides(form(), 'lcm', 120), 'standing')],
        ['an imported false', edits.updateOverrides(form(), 'non_moving_belts', false)],
    ];

    it.each(forms)('gives the key the form has once the answer is set, from %s', (_, start) => {
        for (const answer of ['moving', 'standing'] as const) {
            expect(configKeyOf(withBeltAnswer(formDataToConfig(start), answer)))
                .toBe(configKeyOf(formDataToConfig(setOnForm(start, answer))));
        }
    });

    it('leaves the config it was given alone', () => {
        const config = formDataToConfig(setOnForm(form(), 'standing'));
        const before = configKeyOf(config);
        withBeltAnswer(config, 'moving');
        expect(configKeyOf(config)).toBe(before);
    });
});

describe('otherAnswer and beltResultsLine', () => {
    it('gives the other answer', () => {
        expect(otherAnswer('moving')).toBe('standing');
        expect(otherAnswer('standing')).toBe('moving');
    });

    it('says which belt setting the run used, with the action for the other answer', () => {
        expect(beltResultsLine('moving')).toEqual({
            text: 'This run used your Moving belt setting.',
            actionLabel: 'My belts are backed up. Generate again',
            switchTo: 'standing',
        });
        expect(beltResultsLine('standing')).toEqual({
            text: 'This run used your Backed up belt setting.',
            actionLabel: 'My belts move. Generate again',
            switchTo: 'moving',
        });
        expect(beltResultsLine('moving').actionLabel).toBe(BELT_COPY.actionMoving);
        expect(beltResultsLine('standing').text).toBe(BELT_COPY.resultsStanding);
    });
});

describe('generatedForOf and the belt answer', () => {
    it('records the question as the config answered it', () => {
        const config = formDataToConfig(edits.updateOverrides(form(), 'non_moving_belts', true));
        expect(generatedForOf(config).beltQuestion).toEqual(beltQuestionOf(config));
        expect(generatedForOf(config).beltQuestion).toEqual({ ask: true, answer: 'standing' });
    });

    it('makes the results out of date when the answer changes', () => {
        const moving = formDataToConfig(form());
        const standing = formDataToConfig(edits.updateOverrides(form(), 'non_moving_belts', true));
        expect(configKeyOf(moving)).not.toBe(configKeyOf(standing));
        expect(isStale(generatedForOf(moving), configKeyOf(standing))).toBe(true);
        expect(isStale(generatedForOf(moving), configKeyOf(moving))).toBe(false);
    });
});

describe('standingBeltsHint', () => {
    /** A clock at the target rate made for a moving belt, with 10 wake-ups and 4 windows, unless told otherwise */
    const clock = (ranking: Partial<ClockRanking> = {}) => ({
        ranking: {
            meets_target_rate: true,
            rate_off_target: 0,
            holds_expected_output: true,
            matches_belt_choice: true,
            wake_ups_per_minute: 10,
            window_count: 4,
            ...ranking,
        },
    });
    const still = (wakeUps: number | null, ranking: Partial<ClockRanking> = {}) =>
        clock({ matches_belt_choice: false, wake_ups_per_minute: wakeUps, ...ranking });

    it('says how few wake-ups the build may do with on backed-up belts', () => {
        const clocks = [clock({ wake_ups_per_minute: 177 }), still(0)];
        expect(standingBeltsHint(clocks, 0, 'moving'))
            .toBe('On backed-up belts, this build may do with 0 wake-ups a minute instead of 177; fewer is better, as each one costs a little UPS.');
    });

    it('says nothing on a standing-belt result, or with no pick', () => {
        const clocks = [clock({ wake_ups_per_minute: 177 }), still(0)];
        expect(standingBeltsHint(clocks, 0, 'standing')).toBeNull();
        expect(standingBeltsHint(clocks, null, 'moving')).toBeNull();
        expect(standingBeltsHint([], 0, 'moving')).toBeNull();
    });

    it('says nothing when the clock for standing belts has as many wake-ups or more, to a thousandth', () => {
        expect(standingBeltsHint([clock({ wake_ups_per_minute: 12 }), still(12.0004)], 0, 'moving')).toBeNull();
        expect(standingBeltsHint([clock({ wake_ups_per_minute: 12 }), still(30)], 0, 'moving')).toBeNull();
    });

    it('says nothing when the best clock for standing belts does not meet the rate', () => {
        const clocks = [clock({ wake_ups_per_minute: 177 }), still(0, { meets_target_rate: false, rate_off_target: -10 })];
        expect(standingBeltsHint(clocks, 0, 'moving')).toBeNull();
    });

    it('says nothing when either wake-up count is missing', () => {
        expect(standingBeltsHint([clock({ wake_ups_per_minute: null }), still(0)], 0, 'moving')).toBeNull();
        expect(standingBeltsHint([clock({ wake_ups_per_minute: 177 }), still(null)], 0, 'moving')).toBeNull();
    });

    it('prints the numbers rounded, as the table does', () => {
        expect(standingBeltsHint([clock({ wake_ups_per_minute: 176.6 }), still(3.2)], 0, 'moving'))
            .toBe('On backed-up belts, this build may do with 3 wake-ups a minute instead of 177; fewer is better, as each one costs a little UPS.');
    });

    it('says nothing when the difference rounds away', () => {
        expect(standingBeltsHint([clock({ wake_ups_per_minute: 176.7 }), still(176.6)], 0, 'moving')).toBeNull();
    });
});
