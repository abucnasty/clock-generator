import { describe, expect, it } from 'vitest';
import { createDefaultRuleSet } from '../components/ruleSetUtils';
import type { EnableControlOverride, RuleSet } from './configForm/formData';
import {
    buildEnableControlOverride,
    enableControlDraftChanged,
    enableControlDraftOf,
    enableControlOverrideChanged,
    type EnableControlDraft,
} from './enableControlDraft';

const ruleSet = { operator: 'OR', rules: [] } as unknown as RuleSet;
const release = { operator: 'AND', rules: [] } as unknown as RuleSet;

const clocked: EnableControlOverride = { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }, { start: 20, end: 30 }], period_duration_ticks: 60 };
const clockedWindows = [{ start: '0', end: '10' }, { start: '20', end: '30' }];
const conditional: EnableControlOverride = { mode: 'CONDITIONAL', rule_set: ruleSet, latch: { release } };

/** The form as it opens on each stored rule; a row edits a copy */
const clockedDraft = enableControlDraftOf(clocked);
const conditionalDraft = enableControlDraftOf(conditional);
const alwaysDraft = enableControlDraftOf({ mode: 'ALWAYS' });

describe('enableControlDraftOf', () => {
    it('starts from AUTO, one empty wake window, no period and the default rule set when there is no rule', () => {
        expect(enableControlDraftOf()).toEqual({
            mode: 'AUTO',
            ranges: [{ start: '', end: '' }],
            periodDuration: '',
            ruleSet: createDefaultRuleSet(),
            latchEnabled: false,
            releaseCondition: undefined,
        });
    });

    /** The clock's wake windows for the entity and its period, and the same as the form shows them */
    const planned = { ranges: [{ start: 12, end: 20 }, { start: 80, end: 95 }], periodTicks: 264 };
    const plannedWindows = [{ start: '12', end: '20' }, { start: '80', end: '95' }];

    it.each<{ why: string; stored?: EnableControlOverride; plan?: typeof planned; draft: Partial<EnableControlDraft> }>([
        { why: 'takes the fields of a stored CLOCKED rule', stored: clocked, draft: { mode: 'CLOCKED', ranges: clockedWindows, periodDuration: '60' } },
        { why: 'takes the fields of a stored CONDITIONAL rule', stored: conditional, draft: { mode: 'CONDITIONAL', ruleSet, latchEnabled: true, releaseCondition: release } },
        { why: 'starts the Clocked fields of no rule from the clock\'s windows and period', plan: planned, draft: { mode: 'AUTO', ranges: plannedWindows, periodDuration: '264' } },
        { why: 'starts the Clocked fields of an ALWAYS rule from the clock\'s windows and period', stored: { mode: 'ALWAYS' }, plan: planned,
            draft: { mode: 'ALWAYS', ranges: plannedWindows, periodDuration: '264' } },
        { why: 'starts the Clocked fields of a CONDITIONAL rule from the clock\'s windows and period', stored: conditional, plan: planned,
            draft: { mode: 'CONDITIONAL', ranges: plannedWindows, periodDuration: '264' } },
        { why: 'keeps a stored Clocked rule\'s own windows and period over the clock\'s', stored: clocked, plan: planned,
            draft: { mode: 'CLOCKED', ranges: clockedWindows, periodDuration: '60' } },
    ])('$why', ({ stored, plan, draft }) => {
        expect(enableControlDraftOf(stored, plan)).toMatchObject(draft);
    });
});

describe('buildEnableControlOverride', () => {
    type Saving = { why: string; draft: EnableControlDraft; saved: EnableControlOverride | undefined };
    it.each<Saving>([
        { why: 'no rule for AUTO', draft: enableControlDraftOf(), saved: undefined },
        { why: 'no rule for a stored AUTO rule', draft: enableControlDraftOf({ mode: 'AUTO' }), saved: undefined },
        { why: 'only the mode for ALWAYS', draft: { ...clockedDraft, mode: 'ALWAYS' }, saved: { mode: 'ALWAYS' } },
        { why: 'only the mode for NEVER', draft: { ...conditionalDraft, mode: 'NEVER' }, saved: { mode: 'NEVER' } },
        { why: 'a stored CLOCKED rule as it is', draft: clockedDraft, saved: clocked },
        { why: 'a CLOCKED window of one tick, leaving out one that ends before it starts',
            draft: { ...clockedDraft, ranges: [{ start: '0', end: '10' }, { start: '5', end: '5' }, { start: '9', end: '3' }] },
            saved: { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }, { start: 5, end: 5 }], period_duration_ticks: 60 } },
        { why: 'no CLOCKED window with an empty or unwhole field, never making a value up',
            draft: { ...clockedDraft, ranges: [{ start: '', end: '10' }, { start: '1.5', end: '3' }, { start: ' 4 ', end: '6' }] },
            saved: { mode: 'CLOCKED', ranges: [{ start: 4, end: 6 }], period_duration_ticks: 60 } },
        ...['', '0', '-5', 'abc', '1.5'].map((periodDuration): Saving => ({ why: `no CLOCKED period of ${JSON.stringify(periodDuration)}`,
            draft: { ...clockedDraft, periodDuration }, saved: { mode: 'CLOCKED', ranges: clocked.ranges } })),
        { why: 'a CONDITIONAL rule with its latch', draft: conditionalDraft, saved: conditional },
        { why: 'no latch for a CONDITIONAL rule whose latch is off', draft: { ...conditionalDraft, latchEnabled: false }, saved: { mode: 'CONDITIONAL', rule_set: ruleSet } },
        { why: 'no latch for a CONDITIONAL rule without a release condition', draft: { ...conditionalDraft, releaseCondition: undefined },
            saved: { mode: 'CONDITIONAL', rule_set: ruleSet } },
    ])('saves $why', ({ draft, saved }) => {
        // strict: a field left out is not there at all, not even as undefined
        expect(buildEnableControlOverride(draft)).toStrictEqual(saved);
    });
});

describe('enableControlDraftChanged', () => {
    /** Clocked picked on a new rule, with nothing typed yet */
    const newClocked: EnableControlDraft = { ...enableControlDraftOf(), mode: 'CLOCKED' };
    const inverted: EnableControlOverride = { mode: 'CLOCKED', ranges: [{ start: 10, end: 0 }, { start: 20, end: 30 }] };

    it.each<{ why: string; draft: EnableControlDraft; initial: EnableControlDraft; changed: boolean }>([
        { why: 'an untouched draft of no rule', draft: enableControlDraftOf(), initial: enableControlDraftOf(), changed: false },
        { why: 'an untouched draft of ALWAYS', draft: enableControlDraftOf({ mode: 'ALWAYS' }), initial: alwaysDraft, changed: false },
        { why: 'an untouched draft of CLOCKED with an inverted range', draft: enableControlDraftOf(inverted), initial: enableControlDraftOf(inverted), changed: false },
        { why: 'an untouched draft of CONDITIONAL', draft: enableControlDraftOf(conditional), initial: conditionalDraft, changed: false },
        { why: 'another mode', draft: { ...clockedDraft, mode: 'ALWAYS' }, initial: clockedDraft, changed: true },
        { why: 'another range end', draft: { ...clockedDraft, ranges: [{ start: '0', end: '11' }, { start: '20', end: '30' }] }, initial: clockedDraft, changed: true },
        { why: 'another rule set', draft: { ...conditionalDraft, ruleSet: createDefaultRuleSet() }, initial: conditionalDraft, changed: true },
        { why: 'the latch turned off', draft: { ...conditionalDraft, latchEnabled: false }, initial: conditionalDraft, changed: true },
        { why: 'another range while ALWAYS is picked, as the save leaves ranges out', draft: { ...alwaysDraft, ranges: [{ start: '5', end: '50' }] }, initial: alwaysDraft,
            changed: false },
        { why: 'another "Repeat every"', draft: { ...clockedDraft, periodDuration: '61' }, initial: clockedDraft, changed: true },
        { why: 'a "Repeat every" changed back to what it was', draft: { ...clockedDraft, periodDuration: '60' }, initial: clockedDraft, changed: false },
        { why: 'a half-typed window while Clocked is picked, which the save would leave out', draft: { ...clockedDraft, ranges: [...clockedDraft.ranges, { start: '5', end: '' }] },
            initial: clockedDraft, changed: true },
        { why: 'an unwhole "Repeat every" while Clocked is picked, which the save would leave out', draft: { ...clockedDraft, periodDuration: 'x' }, initial: clockedDraft, changed: true },
        { why: 'a half-typed window in a new Clocked rule', draft: { ...newClocked, ranges: [{ start: '12', end: '' }] }, initial: newClocked, changed: true },
        { why: 'a new Clocked rule with nothing typed', draft: newClocked, initial: newClocked, changed: false },
    ])('is $changed for $why', ({ draft, initial, changed }) => {
        expect(enableControlDraftChanged(draft, initial)).toBe(changed);
    });
});

describe('enableControlOverrideChanged', () => {
    // false for a Save of the rule as it was opened, so that Save changes nothing
    it.each<{ why: string; saved: EnableControlOverride | undefined; stored: EnableControlOverride | undefined; changed: boolean }>([
        { why: 'a Save of ALWAYS as it was opened', saved: { mode: 'ALWAYS' }, stored: { mode: 'ALWAYS' }, changed: false },
        { why: 'a Save of no rule over none', saved: undefined, stored: undefined, changed: false },
        { why: 'a Save of no rule over a stored AUTO rule', saved: undefined, stored: { mode: 'AUTO' }, changed: false },
        { why: 'a Save of a CLOCKED rule as the form built it', saved: buildEnableControlOverride(clockedDraft), stored: clocked, changed: false },
        { why: 'another rule', saved: { mode: 'NEVER' }, stored: { mode: 'ALWAYS' }, changed: true },
        { why: 'Clear Override on a stored rule', saved: undefined, stored: { mode: 'ALWAYS' }, changed: true },
        { why: 'a rule where there was none', saved: { mode: 'ALWAYS' }, stored: undefined, changed: true },
    ])('is $changed for $why', ({ saved, stored, changed }) => {
        expect(enableControlOverrideChanged(saved, stored)).toBe(changed);
    });
});
