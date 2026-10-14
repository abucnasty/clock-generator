import { describe, expect, it } from 'vitest';
import { createDefaultRuleSet } from '../components/ruleSetUtils';
import type { EnableControlOverride, RuleSet } from './configForm/formData';
import { buildEnableControlOverride, enableControlDraftChanged, enableControlDraftOf } from './enableControlDraft';

const ruleSet = { operator: 'OR', rules: [] } as unknown as RuleSet;
const release = { operator: 'AND', rules: [] } as unknown as RuleSet;

const clocked: EnableControlOverride = { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }, { start: 20, end: 30 }], period_duration_ticks: 60 };
const conditional: EnableControlOverride = { mode: 'CONDITIONAL', rule_set: ruleSet, latch: { release } };

describe('enableControlDraftOf', () => {
    it('starts from AUTO, one range of 0 to 100, no period and the default rule set when there is no rule', () => {
        expect(enableControlDraftOf()).toEqual({
            mode: 'AUTO',
            ranges: [{ start: 0, end: 100 }],
            periodDuration: '',
            ruleSet: createDefaultRuleSet(),
            latchEnabled: false,
            releaseCondition: undefined,
        });
    });

    it('takes the fields of a stored rule', () => {
        expect(enableControlDraftOf(clocked)).toMatchObject({ mode: 'CLOCKED', ranges: clocked.ranges, periodDuration: '60' });
        expect(enableControlDraftOf(conditional)).toMatchObject({ mode: 'CONDITIONAL', ruleSet, latchEnabled: true, releaseCondition: release });
    });
});

describe('buildEnableControlOverride', () => {
    it('saves no rule for AUTO, including a stored AUTO rule', () => {
        expect(buildEnableControlOverride(enableControlDraftOf())).toBeUndefined();
        expect(buildEnableControlOverride(enableControlDraftOf({ mode: 'AUTO' }))).toBeUndefined();
    });

    it('saves only the mode for ALWAYS and NEVER', () => {
        expect(buildEnableControlOverride({ ...enableControlDraftOf(clocked), mode: 'ALWAYS' })).toEqual({ mode: 'ALWAYS' });
        expect(buildEnableControlOverride({ ...enableControlDraftOf(conditional), mode: 'NEVER' })).toEqual({ mode: 'NEVER' });
    });

    it('saves a stored CLOCKED rule as it is', () => {
        expect(buildEnableControlOverride(enableControlDraftOf(clocked))).toEqual(clocked);
    });

    it('drops CLOCKED ranges that do not end after they start', () => {
        const draft = { ...enableControlDraftOf(clocked), ranges: [{ start: 0, end: 10 }, { start: 5, end: 5 }, { start: 9, end: 3 }] };
        expect(buildEnableControlOverride(draft)).toEqual({ mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 });
    });

    it.each(['', '0', '-5'])('leaves out a CLOCKED period of %j', (periodDuration) => {
        const override = buildEnableControlOverride({ ...enableControlDraftOf(clocked), periodDuration });
        expect(override).toEqual({ mode: 'CLOCKED', ranges: clocked.ranges });
        expect('period_duration_ticks' in override!).toBe(false);
    });

    it('gives a CONDITIONAL rule a latch only when it is on and has a release condition', () => {
        const draft = enableControlDraftOf(conditional);
        expect(buildEnableControlOverride(draft)).toEqual(conditional);
        const off = buildEnableControlOverride({ ...draft, latchEnabled: false });
        expect(off).toEqual({ mode: 'CONDITIONAL', rule_set: ruleSet });
        expect('latch' in off!).toBe(false);
        expect('latch' in buildEnableControlOverride({ ...draft, releaseCondition: undefined })!).toBe(false);
    });
});

describe('enableControlDraftChanged', () => {
    it.each<[string, EnableControlOverride | undefined]>([
        ['no rule', undefined],
        ['AUTO', { mode: 'AUTO' }],
        ['ALWAYS', { mode: 'ALWAYS' }],
        ['NEVER', { mode: 'NEVER' }],
        ['CLOCKED', clocked],
        ['CLOCKED with an inverted range', { mode: 'CLOCKED', ranges: [{ start: 10, end: 0 }, { start: 20, end: 30 }] }],
        ['CONDITIONAL', conditional],
    ])('is false for an untouched draft of %s', (_label, stored) => {
        const initial = enableControlDraftOf(stored);
        expect(enableControlDraftChanged(enableControlDraftOf(stored), initial)).toBe(false);
    });

    it('is true after changing the mode, a range end, the rule set or the latch', () => {
        const initial = enableControlDraftOf(clocked);
        expect(enableControlDraftChanged({ ...initial, mode: 'ALWAYS' }, initial)).toBe(true);
        expect(enableControlDraftChanged({ ...initial, ranges: [{ start: 0, end: 11 }, { start: 20, end: 30 }] }, initial)).toBe(true);
        const cond = enableControlDraftOf(conditional);
        expect(enableControlDraftChanged({ ...cond, ruleSet: createDefaultRuleSet() }, cond)).toBe(true);
        expect(enableControlDraftChanged({ ...cond, latchEnabled: false }, cond)).toBe(true);
    });

    it('is false after changing a range while ALWAYS is picked, as the save leaves ranges out', () => {
        const initial = enableControlDraftOf({ mode: 'ALWAYS' });
        expect(enableControlDraftChanged({ ...initial, ranges: [{ start: 5, end: 50 }] }, initial)).toBe(false);
    });

    it('is false after changing a value and changing it back', () => {
        const initial = enableControlDraftOf(clocked);
        const changed = { ...initial, periodDuration: '61' };
        expect(enableControlDraftChanged(changed, initial)).toBe(true);
        expect(enableControlDraftChanged({ ...changed, periodDuration: '60' }, initial)).toBe(false);
    });
});
