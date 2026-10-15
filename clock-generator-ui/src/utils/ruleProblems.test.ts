import { describe, expect, it } from 'vitest';
import { createDefaultRuleSet } from '../components/ruleSetUtils';
import type { Condition, RuleSet } from './configForm/formData';
import { enableControlDraftOf, type EnableControlDraft } from './enableControlDraft';
import { blockedSummaryOf, PROBLEM_TEXT, ruleProblemsOf, ruleWarningsOf } from './ruleProblems';
import { NO_TIMING, type RuleTiming } from './ruleTiming';

const known: RuleTiming = { cycleTicks: 132, periodTicks: 264, from: 'check', windows: null };
const ctx = { entityType: 'inserter' as const, timing: known, idPrefix: 'p' };

const clockedDraft = (ranges: [string, string][], periodDuration = ''): EnableControlDraft => ({
    ...enableControlDraftOf(),
    mode: 'CLOCKED',
    ranges: ranges.map(([start, end]) => ({ start, end })),
    periodDuration,
});

const texts = (draft: EnableControlDraft, context = ctx) => ruleProblemsOf(draft, context).map((p) => `${p.field}: ${p.text}`);

describe('ruleProblemsOf, Clocked', () => {
    it('asks for a tick in an empty field', () => {
        expect(texts(clockedDraft([['', '20']]))).toEqual(['Start tick, wake window 1: Enter a tick.']);
    });

    it.each(['abc', '-1', '1.5'])('asks for a whole number instead of %j', (typed) => {
        expect(texts(clockedDraft([['0', typed]]))).toEqual([`End tick, wake window 1: ${PROBLEM_TEXT.wholeTick}`]);
    });

    it('refuses an end before the start, and names the start', () => {
        expect(texts(clockedDraft([['10', '5']]))).toEqual(['End tick, wake window 1: The end must not be before the start (10).']);
    });

    it('takes an end equal to the start (one tick)', () => {
        expect(texts(clockedDraft([['12', '12']]))).toEqual([]);
    });

    it('refuses a window that ends at tick 0, which the config file can\'t hold', () => {
        expect(texts(clockedDraft([['0', '0']]))).toEqual(['End tick, wake window 1: The end must be tick 1 or later.']);
    });

    it('checks the ticks against the crafting cycle when there is no "Repeat every"', () => {
        expect(texts(clockedDraft([['0', '131']]))).toEqual([]);
        expect(texts(clockedDraft([['0', '132']]))).toEqual(['End tick, wake window 1: Past the end of the 132-tick period: the last tick is 131.']);
        expect(texts(clockedDraft([['140', '150']]))).toEqual([
            'Start tick, wake window 1: Past the end of the 132-tick period: the last tick is 131.',
            'End tick, wake window 1: Past the end of the 132-tick period: the last tick is 131.',
        ]);
    });

    it('checks them against a valid "Repeat every" instead of the cycle', () => {
        expect(texts(clockedDraft([['0', '263']], '264'))).toEqual([]);
        expect(texts(clockedDraft([['0', '264']], '264'))).toEqual(['End tick, wake window 1: Past the end of the 264-tick period: the last tick is 263.']);
    });

    it('does not check past the period when it is unknown or fractional', () => {
        expect(texts(clockedDraft([['0', '5000']]), { ...ctx, timing: NO_TIMING })).toEqual([]);
        expect(texts(clockedDraft([['0', '5000']]), { ...ctx, timing: { ...known, cycleTicks: 137.739 } })).toEqual([]);
    });

    it('takes an empty "Repeat every" and refuses 0, a negative number and text', () => {
        expect(texts(clockedDraft([['0', '5']], ''))).toEqual([]);
        for (const repeat of ['0', '-3', 'x']) {
            expect(texts(clockedDraft([['0', '5']], repeat))).toEqual([`Repeat every (ticks): ${PROBLEM_TEXT.repeat}`]);
        }
    });

    it('gives no problem to the fields of a mode that is not picked', () => {
        expect(texts({ ...clockedDraft([['', '']]), mode: 'ALWAYS' })).toEqual([]);
    });
});

describe('ruleProblemsOf, Conditional', () => {
    const empty = (type: 'INVENTORY_ITEM' | 'AUTOMATED_INSERTION_LIMIT'): Condition => ({
        left: { type, entity: 'SINK', item_name: '' },
        operator: '<',
        right: { type, entity: 'SINK', item_name: '' },
    });
    const conditionalDraft = (ruleSet: RuleSet, release?: RuleSet): EnableControlDraft => ({
        ...enableControlDraftOf(),
        mode: 'CONDITIONAL',
        ruleSet,
        latchEnabled: release !== undefined,
        releaseCondition: release,
    });

    it('asks for an item on each side of a condition, in a group and in the release', () => {
        const ruleSet: RuleSet = { operator: 'AND', rules: [empty('INVENTORY_ITEM'), { operator: 'OR', rules: [empty('AUTOMATED_INSERTION_LIMIT')] }] };
        expect(texts(conditionalDraft(ruleSet, createDefaultRuleSet()))).toEqual([
            'Item, condition 1: Pick an item.',
            'Second item, condition 1: Pick an item.',
            'Item, condition 2.1: Pick an item.',
            'Second item, condition 2.1: Pick an item.',
            'Item, release condition 1: Pick an item.',
        ]);
    });

    it('lets an item in the hand be left empty', () => {
        const ruleSet: RuleSet = { operator: 'AND', rules: [{ left: { type: 'HAND_QUANTITY' }, operator: '>', right: { type: 'CONSTANT', value: 0 } }] };
        expect(texts(conditionalDraft(ruleSet))).toEqual([]);
    });

    it('leaves the release alone while the latch is off', () => {
        expect(texts({ ...conditionalDraft(createDefaultRuleSet(), createDefaultRuleSet()), latchEnabled: false })).toEqual(['Item, condition 1: Pick an item.']);
    });

    it('refuses a Conditional rule on a drill, first', () => {
        const problems = ruleProblemsOf(conditionalDraft(createDefaultRuleSet()), { ...ctx, entityType: 'drill' });
        expect(problems[0]).toEqual({ fieldId: 'p-mode-CONDITIONAL', field: 'Mode', text: PROBLEM_TEXT.drillConditional });
    });

    it('gives every problem its own field id', () => {
        const ruleSet: RuleSet = { operator: 'AND', rules: [empty('INVENTORY_ITEM'), { operator: 'OR', rules: [empty('INVENTORY_ITEM')] }] };
        const ids = ruleProblemsOf(conditionalDraft(ruleSet, ruleSet), { ...ctx, entityType: 'drill' }).map((p) => p.fieldId);
        expect(new Set(ids).size).toBe(ids.length);
        const windowIds = ruleProblemsOf(clockedDraft([['', ''], ['', '']], 'x'), ctx).map((p) => p.fieldId);
        expect(new Set(windowIds).size).toBe(windowIds.length);
    });
});

describe('ruleProblemsOf, order', () => {
    it('is reading order: start then end, window by window, then "Repeat every"', () => {
        expect(ruleProblemsOf(clockedDraft([['', ''], ['9', '3']], '0'), ctx).map((p) => p.fieldId)).toEqual([
            'p-start-0', 'p-end-0', 'p-end-1', 'p-repeat',
        ]);
    });
});

describe('ruleWarningsOf', () => {
    it('warns of a "Repeat every" the clock period is not a whole number of', () => {
        expect(ruleWarningsOf(clockedDraft([['0', '5']], '100'), known)).toEqual([
            '100 ticks doesn\'t fit a whole number of times into the 264-tick clock period, so the blueprint can\'t repeat this rule exactly.',
        ]);
        expect(ruleWarningsOf(clockedDraft([['0', '5']], '132'), known)).toEqual([]);
        expect(ruleWarningsOf(clockedDraft([['0', '5']], ''), known)).toEqual([]);
        expect(ruleWarningsOf(clockedDraft([['0', '5']], '100'), NO_TIMING)).toEqual([]);
    });
});

describe('blockedSummaryOf', () => {
    it('counts the problems and names the first', () => {
        const problems = ruleProblemsOf(clockedDraft([['10', '5']]), ctx);
        expect(blockedSummaryOf(problems)).toBe("Can't save yet: 1 problem. End tick, wake window 1: The end must not be before the start (10).");
        expect(blockedSummaryOf([...problems, ...problems])).toMatch(/^Can't save yet: 2 problems\. /);
    });
});
