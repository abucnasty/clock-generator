import type { Config, ConfigValidation } from 'clock-generator/browser';
import { describe, expect, it } from 'vitest';
import type { ValidationState } from '../hooks/useSimulationWorker';
import {
    CHECK_TEXT,
    PendingChecks,
    afterCheck,
    checkChipOf,
    checkKeyOf,
    checkStatusOf,
    decideCheckOnly,
    decideGenerate,
    startsRun,
    type CheckOutcome,
    type CheckStatus,
} from './checkThenGenerate';
import { formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { PROBLEM_TEXT, type Problem } from './firstProblem';

/** A build as the page holds it: a target, a machine, and two inserters */
function form(): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.updateTargetOutput(config, 'recipe', 'logistic-science-pack');
    config = edits.updateTargetOutput(config, 'items_per_second', 240);
    config = edits.updateMachine(config, 0, 'recipe', 'logistic-science-pack');
    return edits.addInserter(edits.addInserter(config));
}

type Edit = (config: ConfigFormData) => ConfigFormData;
type Overrides = NonNullable<ConfigFormData['overrides']>;

const configOf = (edit: Edit = (c) => c): Config => formDataToConfig(edit(form()));
const keyOf = (edit?: Edit) => checkKeyOf(configOf(edit));

/** An edit setting these overrides, in this order */
const withOverrides = (overrides: Overrides): Edit => (config) =>
    Object.entries(overrides).reduce((c, [field, value]) => edits.updateOverrides(c, field as keyof Overrides, value), config);

const problems = (...texts: string[]): Problem[] => texts.map((text) => ({ text, target: { kind: 'target-recipe' } }));

const idle = { initialized: true, generating: false, checkStatus: 'none' as CheckStatus, problems: [] as Problem[] };

describe('decideGenerate and decideCheckOnly', () => {
    it.each([
        ['the page starts', { initialized: false }],
        ['a generation runs', { generating: true }],
        ['a check runs', { checkStatus: 'running' }],
    ] as const)('both wait while %s, even with problems', (_, running) => {
        for (const listed of [[], problems('a')]) {
            expect(decideGenerate({ ...idle, ...running, problems: listed })).toEqual({ kind: 'wait' });
            expect(decideCheckOnly({ ...idle, ...running, problems: listed })).toEqual({ kind: 'wait' });
        }
    });

    const rateAboveMax: Problem = { text: PROBLEM_TEXT.rateAboveMax(252.656), target: { kind: 'target-rate' } };
    it.each([
        ['the first problem', problems('first', 'second')],
        ['Items per Second for a target more than the machines can make', [rateAboveMax]],
    ])('Generate goes to %s and Check only shows the problems, never checking, whatever the check says, a passed check included', (_, listed) => {
        for (const checkStatus of ['none', 'valid', 'invalid', 'out-of-date'] as const) {
            expect(decideGenerate({ ...idle, checkStatus, problems: listed })).toEqual({ kind: 'go-to-problem', problem: listed[0] });
            expect(decideCheckOnly({ ...idle, checkStatus, problems: listed })).toEqual({ kind: 'show-problems' });
        }
    });

    // with no problems; Check only checks again whatever the last check said, a passed one or a crash included
    it.each([
        ['no check for this build', { checkStatus: 'none' }, 'check-first'],
        ['an out-of-date check', { checkStatus: 'out-of-date' }, 'check-first'],
        ['a passed check for this build', { checkStatus: 'valid' }, 'generate'],
        ['a failed check', { checkStatus: 'invalid' }, 'go-to-check-error'],
        ['a failed check whose worker did not crash', { checkStatus: 'invalid', lastCheckCrashed: false }, 'go-to-check-error'],
        ['a check whose worker crashed', { checkStatus: 'invalid', lastCheckCrashed: true }, 'check-first'],
    ] as const)('after %s, Generate does %s', (_, check, kind) => {
        expect(decideGenerate({ ...idle, ...check })).toEqual({ kind });
        expect(decideCheckOnly({ ...idle, ...check })).toEqual({ kind: 'check' });
    });
});

describe('startsRun', () => {
    // every kind of both decisions, made the way a press makes it; a new kind that `startsRun` does not classify fails
    // the build (its table is typed by both decisions' kinds), and belongs in this list
    it.each([
        ['Generate', 'generate', decideGenerate({ ...idle, checkStatus: 'valid' }), true],
        ['Generate', 'check-first (no check)', decideGenerate({ ...idle, checkStatus: 'none' }), true],
        ['Generate', 'wait (generating)', decideGenerate({ ...idle, generating: true }), false],
        ['Generate', 'go-to-problem', decideGenerate({ ...idle, problems: problems('a') }), false],
        ['Generate', 'go-to-check-error', decideGenerate({ ...idle, checkStatus: 'invalid' }), false],
        ['Check only', 'check', decideCheckOnly({ ...idle, checkStatus: 'valid' }), true],
        ['Check only', 'show-problems', decideCheckOnly({ ...idle, problems: problems('a') }), false],
    ] as const)('%s, %s: %s', (_press, _kind, decision, expected) => {
        expect(startsRun(decision)).toBe(expected);
    });
});

describe('afterCheck', () => {
    it('generates after a pass, goes to the reason after a failure, and stops when the check was dropped', () => {
        expect(afterCheck({ kind: 'valid', validation: {} as ConfigValidation })).toBe('generate');
        expect(afterCheck({ kind: 'invalid', message: 'no' })).toBe('go-to-check-error');
        expect(afterCheck({ kind: 'dropped' })).toBe('stop');
    });
});

describe('checkKeyOf', () => {
    const base = keyOf();

    it('ignores the switches only the clock search reads', () => {
        expect(keyOf(withOverrides({ search_for_fewer_wake_ups: true }))).toBe(base);
        expect(keyOf(withOverrides({ backed_up_belts: true }))).toBe(base);
        const both = configOf(withOverrides({ backed_up_belts: true, search_for_fewer_wake_ups: true }));
        expect(both.overrides).toBeDefined();
        expect(checkKeyOf(both)).toBe(base);
        expect(configOf().overrides).toBeUndefined();
    });

    it('keeps the other overrides next to those switches', () => {
        expect(keyOf(withOverrides({ search_for_fewer_wake_ups: true, lcm: 2 }))).toBe(keyOf(withOverrides({ lcm: 2 })));
    });

    it.each<[string, Edit]>([
        ['the LCM override', withOverrides({ lcm: 2 })],
        ['the forced output swings', withOverrides({ terminal_swing_count: 3 })],
        ['fractional swings', withOverrides({ use_fractional_swings: true })],
        ['the ingredients left out of the LCM', withOverrides({ ignored_lcm_ingredients: ['iron-plate'] })],
        ['a machine recipe', (c) => edits.updateMachine(c, 0, 'recipe', 'automation-science-pack')],
        ['the target rate', (c) => edits.updateTargetOutput(c, 'items_per_second', 200)],
        ['an inserter enable rule', (c) => edits.updateInserter(c, 0, { overrides: { enable_control: { mode: 'ALWAYS' } } })],
    ])('changes with %s', (_, edit) => {
        expect(keyOf(edit)).not.toBe(base);
    });

    it('does not change the config it is given', () => {
        const config = configOf(withOverrides({ lcm: 2, backed_up_belts: true }));
        const before = structuredClone(config);
        checkKeyOf(config);
        expect(config).toEqual(before);
    });
});

describe('checkStatusOf', () => {
    const config = configOf();
    const key = checkKeyOf(config);
    const valid: ValidationState = { status: 'valid', config, validation: {} as ConfigValidation };
    const invalid: ValidationState = { status: 'invalid', config, message: 'no' };

    it('passes none and running through, and says valid or invalid for the same build', () => {
        expect(checkStatusOf({ status: 'none' }, key)).toBe('none');
        expect(checkStatusOf({ status: 'running', config }, key)).toBe('running');
        expect(checkStatusOf(valid, key)).toBe('valid');
        expect(checkStatusOf(invalid, key)).toBe('invalid');
    });

    it('is out of date once the build changed', () => {
        const edited = keyOf((c) => edits.updateTargetOutput(c, 'items_per_second', 200));
        expect(checkStatusOf(valid, edited)).toBe('out-of-date');
        expect(checkStatusOf(invalid, edited)).toBe('out-of-date');
    });

    it('stays valid after a generation-only switch', () => {
        expect(checkStatusOf(valid, keyOf(withOverrides({ search_for_fewer_wake_ups: true })))).toBe('valid');
    });
});

describe('checkChipOf', () => {
    it('shows a failed check, and a passed one only while no clocks for this build are on screen', () => {
        expect(checkChipOf({ checkStatus: 'invalid', clocksAreForThisBuild: false })).toEqual({ label: CHECK_TEXT.chipFailed, color: 'error' });
        expect(checkChipOf({ checkStatus: 'valid', clocksAreForThisBuild: false })).toEqual({ label: CHECK_TEXT.chipPassed, color: 'success' });
        expect(checkChipOf({ checkStatus: 'valid', clocksAreForThisBuild: true })).toBeNull();
        for (const checkStatus of ['none', 'running', 'out-of-date'] as const) {
            expect(checkChipOf({ checkStatus, clocksAreForThisBuild: false })).toBeNull();
        }
    });
});

describe('PendingChecks', () => {
    const passed: CheckOutcome = { kind: 'valid', validation: {} as ConfigValidation };
    const dropped: CheckOutcome = { kind: 'dropped' };

    it('resolves a check with its outcome, and ignores an unknown or already settled id', async () => {
        const pending = new PendingChecks();
        expect(() => pending.settle(7, passed)).not.toThrow();
        const check = pending.begin(1);
        pending.settle(1, passed);
        expect(() => pending.settle(1, { kind: 'invalid', message: 'again' })).not.toThrow();
        await expect(check).resolves.toEqual(passed);
    });

    it('drops an earlier check when a newer one begins', async () => {
        const pending = new PendingChecks();
        const first = pending.begin(1);
        const second = pending.begin(2);
        pending.settle(1, { kind: 'invalid', message: 'late' });
        pending.settle(2, passed);
        await expect(first).resolves.toEqual(dropped);
        await expect(second).resolves.toEqual(passed);
    });

    it('keeps the current check pending when an unrelated answer arrives', async () => {
        const pending = new PendingChecks();
        let settled = false;
        const check = pending.begin(2).then(outcome => { settled = true; return outcome; });
        pending.settle(1, passed);
        await Promise.resolve();
        expect(settled).toBe(false);
        pending.settle(2, passed);
        await expect(check).resolves.toEqual(passed);
    });

    it('resolves a cancelled check as dropped, and ignores its late answer', async () => {
        const pending = new PendingChecks();
        const check = pending.begin(1);
        pending.dropAll();
        pending.settle(1, passed);
        await expect(check).resolves.toEqual(dropped);
        expect(afterCheck(await check)).toBe('stop');
    });

    it('resolves cancelled and failed checks without rejecting', async () => {
        const pending = new PendingChecks();
        const crashed: CheckOutcome = { kind: 'invalid', message: CHECK_TEXT.crashText };
        const first = pending.begin(1);
        pending.dropAll();
        const second = pending.begin(2);
        pending.settle(2, crashed);
        const third = pending.begin(3);
        pending.dropAll();
        expect(await Promise.allSettled([first, second, third])).toEqual([dropped, crashed, dropped].map((value) => ({ status: 'fulfilled', value })));
    });
});

describe('CHECK_TEXT', () => {
    it('uses Check for actions, names Build validation as the failure destination, and uses three dots while busy', () => {
        for (const text of Object.values(CHECK_TEXT)) {
            expect(text).not.toMatch(/\b(?:validate|validated|valid)\b/i);
        }
        expect(CHECK_TEXT.planFailed).toContain('Build validation');
        expect(CHECK_TEXT.checking).toBe('Checking...');
        expect(CHECK_TEXT.generating).toBe('Generating...');
        expect(CHECK_TEXT.cancel).toBe('Cancel');
        expect(PROBLEM_TEXT.validationFailed).not.toMatch(/valid/i);
    });
});
