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

const configOf = (edit: (config: ConfigFormData) => ConfigFormData = (c) => c): Config => formDataToConfig(edit(form()));

const problems = (...texts: string[]): Problem[] => texts.map((text) => ({ text, target: { kind: 'target-recipe' } }));

describe('decideGenerate', () => {
    const idle = { initialized: true, generating: false, checkStatus: 'none' as CheckStatus, problems: [] as Problem[] };

    it('waits while the page starts, a generation runs or a check runs, even with problems', () => {
        expect(decideGenerate({ ...idle, initialized: false, problems: problems('a') })).toEqual({ kind: 'wait' });
        expect(decideGenerate({ ...idle, generating: true, problems: problems('a') })).toEqual({ kind: 'wait' });
        expect(decideGenerate({ ...idle, checkStatus: 'running', problems: problems('a') })).toEqual({ kind: 'wait' });
    });

    it('goes to the first problem whatever the check says, a passed check included', () => {
        const [first, second] = problems('first', 'second');
        for (const checkStatus of ['none', 'valid', 'invalid', 'out-of-date'] as const) {
            expect(decideGenerate({ ...idle, checkStatus, problems: [first, second] })).toEqual({ kind: 'go-to-problem', problem: first });
        }
    });

    it('goes to the reason of a failed check without checking again', () => {
        expect(decideGenerate({ ...idle, checkStatus: 'invalid' })).toEqual({ kind: 'go-to-check-error' });
    });

    it('checks again after a check whose worker crashed, instead of going to its error', () => {
        expect(decideGenerate({ ...idle, checkStatus: 'invalid', lastCheckCrashed: true })).toEqual({ kind: 'check-first' });
        expect(decideGenerate({ ...idle, checkStatus: 'invalid', lastCheckCrashed: false })).toEqual({ kind: 'go-to-check-error' });
        // Check only is the same either way
        expect(decideCheckOnly({ ...idle, checkStatus: 'invalid', lastCheckCrashed: true })).toEqual({ kind: 'check' });
        expect(decideCheckOnly({ ...idle, checkStatus: 'invalid' })).toEqual({ kind: 'check' });
    });

    it('generates at once after a passed check for this build', () => {
        expect(decideGenerate({ ...idle, checkStatus: 'valid' })).toEqual({ kind: 'generate' });
    });

    it('goes to Items per Second for a target more than the machines can make, and never checks', () => {
        const problem: Problem = { text: PROBLEM_TEXT.rateAboveMax(252.656), target: { kind: 'target-rate' } };
        for (const checkStatus of ['none', 'valid', 'invalid', 'out-of-date'] as const) {
            expect(decideGenerate({ ...idle, checkStatus, problems: [problem] })).toEqual({ kind: 'go-to-problem', problem });
            expect(decideCheckOnly({ ...idle, checkStatus, problems: [problem] })).toEqual({ kind: 'show-problems' });
        }
    });

    it('checks first when there is no check for this build', () => {
        expect(decideGenerate({ ...idle, checkStatus: 'none' })).toEqual({ kind: 'check-first' });
        expect(decideGenerate({ ...idle, checkStatus: 'out-of-date' })).toEqual({ kind: 'check-first' });
    });
});

describe('decideCheckOnly', () => {
    const idle = { initialized: true, generating: false, checkStatus: 'none' as CheckStatus, problems: [] as Problem[] };

    it('waits while anything runs', () => {
        expect(decideCheckOnly({ ...idle, initialized: false })).toEqual({ kind: 'wait' });
        expect(decideCheckOnly({ ...idle, generating: true })).toEqual({ kind: 'wait' });
        expect(decideCheckOnly({ ...idle, checkStatus: 'running' })).toEqual({ kind: 'wait' });
    });

    it('shows the problems instead of checking, whatever the check says', () => {
        for (const checkStatus of ['none', 'valid', 'invalid', 'out-of-date'] as const) {
            expect(decideCheckOnly({ ...idle, checkStatus, problems: problems('a') })).toEqual({ kind: 'show-problems' });
        }
    });

    it('checks for every other status, again after a passed check too', () => {
        for (const checkStatus of ['none', 'valid', 'invalid', 'out-of-date'] as const) {
            expect(decideCheckOnly({ ...idle, checkStatus })).toEqual({ kind: 'check' });
        }
    });
});

describe('startsRun', () => {
    const idle = { initialized: true, generating: false, checkStatus: 'none' as CheckStatus, problems: [] as Problem[] };

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
    it('ignores the switches only the clock search reads', () => {
        const base = checkKeyOf(configOf());
        expect(checkKeyOf(configOf((c) => edits.updateOverrides(c, 'search_for_fewer_wake_ups', true)))).toBe(base);
        expect(checkKeyOf(configOf((c) => edits.updateOverrides(c, 'non_moving_belts', true)))).toBe(base);
        const both = configOf((c) => edits.updateOverrides(edits.updateOverrides(c, 'non_moving_belts', true), 'search_for_fewer_wake_ups', true));
        expect(both.overrides).toBeDefined();
        expect(checkKeyOf(both)).toBe(base);
        expect(configOf().overrides).toBeUndefined();
    });

    it('keeps the other overrides next to those switches', () => {
        const lcm = checkKeyOf(configOf((c) => edits.updateOverrides(c, 'lcm', 2)));
        const lcmAndSwitch = checkKeyOf(configOf((c) => edits.updateOverrides(edits.updateOverrides(c, 'search_for_fewer_wake_ups', true), 'lcm', 2)));
        expect(lcmAndSwitch).toBe(lcm);
    });

    it.each<[string, (config: ConfigFormData) => ConfigFormData]>([
        ['the LCM override', (c) => edits.updateOverrides(c, 'lcm', 2)],
        ['the forced output swings', (c) => edits.updateOverrides(c, 'terminal_swing_count', 3)],
        ['fractional swings', (c) => edits.updateOverrides(c, 'use_fractional_swings', true)],
        ['the ingredients left out of the LCM', (c) => edits.updateOverrides(c, 'ignored_lcm_ingredients', ['iron-plate'])],
        ['a machine recipe', (c) => edits.updateMachine(c, 0, 'recipe', 'automation-science-pack')],
        ['the target rate', (c) => edits.updateTargetOutput(c, 'items_per_second', 200)],
        ['an inserter enable rule', (c) => edits.updateInserter(c, 0, { overrides: { enable_control: { mode: 'ALWAYS' } } })],
    ])('changes with %s', (_, edit) => {
        expect(checkKeyOf(configOf(edit))).not.toBe(checkKeyOf(configOf()));
    });

    it('does not change the config it is given', () => {
        const config = configOf((c) => edits.updateOverrides(edits.updateOverrides(c, 'lcm', 2), 'non_moving_belts', true));
        const before = structuredClone(config);
        checkKeyOf(config);
        expect(config).toEqual(before);
    });
});

describe('checkStatusOf', () => {
    const config = configOf();
    const key = checkKeyOf(config);
    const valid: ValidationState = { status: 'valid', config, validation: {} as ConfigValidation };

    it('passes none and running through, and says valid or invalid for the same build', () => {
        expect(checkStatusOf({ status: 'none' }, key)).toBe('none');
        expect(checkStatusOf({ status: 'running', config }, key)).toBe('running');
        expect(checkStatusOf(valid, key)).toBe('valid');
        expect(checkStatusOf({ status: 'invalid', config, message: 'no' }, key)).toBe('invalid');
    });

    it('is out of date once the build changed', () => {
        const edited = checkKeyOf(configOf((c) => edits.updateTargetOutput(c, 'items_per_second', 200)));
        expect(checkStatusOf(valid, edited)).toBe('out-of-date');
        expect(checkStatusOf({ status: 'invalid', config, message: 'no' }, edited)).toBe('out-of-date');
    });

    it('stays valid after a generation-only switch', () => {
        const switched = checkKeyOf(configOf((c) => edits.updateOverrides(c, 'search_for_fewer_wake_ups', true)));
        expect(checkStatusOf(valid, switched)).toBe('valid');
    });
});

describe('checkChipOf', () => {
    it('shows a failed check, and a passed one only while no clocks for this build are on screen', () => {
        expect(checkChipOf({ checkStatus: 'invalid', clocksAreForThisBuild: false })).toEqual({ label: 'Check failed', color: 'error' });
        expect(checkChipOf({ checkStatus: 'valid', clocksAreForThisBuild: false })).toEqual({ label: 'Check passed', color: 'success' });
        expect(checkChipOf({ checkStatus: 'valid', clocksAreForThisBuild: true })).toBeNull();
        for (const checkStatus of ['none', 'running', 'out-of-date'] as const) {
            expect(checkChipOf({ checkStatus, clocksAreForThisBuild: false })).toBeNull();
        }
    });

});

describe('PendingChecks', () => {
    const passed: CheckOutcome = { kind: 'valid', validation: {} as ConfigValidation };

    it('resolves a check with its outcome', async () => {
        const pending = new PendingChecks();
        const check = pending.begin(1);
        pending.settle(1, passed);
        await expect(check).resolves.toEqual(passed);
    });

    it('drops an earlier check when a newer one begins', async () => {
        const pending = new PendingChecks();
        const first = pending.begin(1);
        const second = pending.begin(2);
        pending.settle(1, { kind: 'invalid', message: 'late' });
        pending.settle(2, passed);
        await expect(first).resolves.toEqual({ kind: 'dropped' });
        await expect(second).resolves.toEqual(passed);
    });

    it('ignores an unknown or already settled id', async () => {
        const pending = new PendingChecks();
        expect(() => pending.settle(7, passed)).not.toThrow();
        const check = pending.begin(1);
        pending.settle(1, passed);
        expect(() => pending.settle(1, { kind: 'invalid', message: 'again' })).not.toThrow();
        await expect(check).resolves.toEqual(passed);
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
        await expect(check).resolves.toEqual({ kind: 'dropped' });
        expect(afterCheck(await check)).toBe('stop');
    });

    it('resolves cancelled and failed checks without rejecting', async () => {
        const pending = new PendingChecks();
        const first = pending.begin(1);
        pending.dropAll();
        const second = pending.begin(2);
        pending.settle(2, { kind: 'invalid', message: 'The check stopped unexpectedly' });
        const third = pending.begin(3);
        pending.dropAll();
        const settled = await Promise.allSettled([first, second, third]);
        expect(settled.map((it) => it.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        expect(settled.map((it) => it.status === 'fulfilled' && it.value.kind)).toEqual(['dropped', 'invalid', 'dropped']);
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
