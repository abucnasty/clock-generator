import { describe, expect, it } from 'vitest';
import { createDefaultRuleSet } from '../components/ruleSetUtils';
import { windowFieldName } from './a11yLabels';
import type { Condition, RuleSet } from './configForm/formData';
import { enableControlDraftOf, type EnableControlDraft } from './enableControlDraft';
import { blockedSummaryOf, itemFieldName, PROBLEM_TEXT, REPEAT_LABEL, ruleProblemsOf, ruleWarningsOf } from './ruleProblems';
import { NO_TIMING, type RuleTiming } from './ruleTiming';

const known: RuleTiming = { cycleTicks: 132, periodTicks: 264, from: 'check', windows: null };
const ctx = { entityType: 'inserter' as const, timing: known, idPrefix: 'p' };
const { enterTick, wholeTick, endBeforeStart, endAtZero, pastPeriod } = PROBLEM_TEXT;

const clockedDraft = (ranges: [string, string][], periodDuration = ''): EnableControlDraft => ({
    ...enableControlDraftOf(),
    mode: 'CLOCKED',
    ranges: ranges.map(([start, end]) => ({ start, end })),
    periodDuration,
});

/** Each problem as its field and its text */
const texts = (draft: EnableControlDraft, context = ctx) => ruleProblemsOf(draft, context).map((p) => [p.field, p.text]);
/** The start or end field of wake window n */
const start = (n = 1) => windowFieldName('start', n);
const end = (n = 1) => windowFieldName('end', n);

describe('ruleProblemsOf, Clocked', () => {
    it.each<[string, [string, string][], string, string[][]]>([
        ['asks for a tick in an empty field', [['', '20']], '', [[start(), enterTick]]],
        ['asks for a whole number instead of "abc"', [['0', 'abc']], '', [[end(), wholeTick]]],
        ['asks for a whole number instead of "-1"', [['0', '-1']], '', [[end(), wholeTick]]],
        ['asks for a whole number instead of "1.5"', [['0', '1.5']], '', [[end(), wholeTick]]],
        ['refuses an end before the start, and names the start', [['10', '5']], '', [[end(), endBeforeStart(10)]]],
        ['takes an end equal to the start (one tick)', [['12', '12']], '', []],
        ["refuses a window that ends at tick 0, which the config file can't hold", [['0', '0']], '', [[end(), endAtZero]]],
        // window 1 ends on the period's last tick, window 2 one past it
        ['checks the ticks against the crafting cycle when there is no "Repeat every"', [['0', '131'], ['0', '132'], ['140', '150']], '',
            [[end(2), pastPeriod(132)], [start(3), pastPeriod(132)], [end(3), pastPeriod(132)]]],
        ['checks them against a valid "Repeat every" instead of the cycle', [['0', '263'], ['0', '264']], '264', [[end(2), pastPeriod(264)]]],
        ['refuses a "Repeat every" of 0', [['0', '5']], '0', [[REPEAT_LABEL, PROBLEM_TEXT.repeat]]],
        ['refuses a negative "Repeat every"', [['0', '5']], '-3', [[REPEAT_LABEL, PROBLEM_TEXT.repeat]]],
        ['refuses a "Repeat every" of text', [['0', '5']], 'x', [[REPEAT_LABEL, PROBLEM_TEXT.repeat]]],
    ])('%s', (_, ranges, repeat, problems) => {
        expect(texts(clockedDraft(ranges, repeat))).toEqual(problems);
    });

    it('names the start an end is before, and tells the last tick of the period, one before its length', () => {
        expect(endBeforeStart(10)).toMatch(/ the start \(10\)\.$/);
        expect(pastPeriod(132)).toMatch(/ 132-tick period: the last tick is 131\.$/);
    });

    it('does not check past the period when it is unknown or fractional', () => {
        expect(texts(clockedDraft([['0', '5000']]), { ...ctx, timing: NO_TIMING })).toEqual([]);
        expect(texts(clockedDraft([['0', '5000']]), { ...ctx, timing: { ...known, cycleTicks: 137.739 } })).toEqual([]);
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
    /** The problem of the item picker left empty on this side of the condition at this path */
    const pickItem = (path: string, side: 'left' | 'right' = 'left') => [itemFieldName(path, side), PROBLEM_TEXT.pickItem];

    it('asks for an item on each side of a condition, in a group and in the release', () => {
        const ruleSet: RuleSet = { operator: 'AND', rules: [empty('INVENTORY_ITEM'), { operator: 'OR', rules: [empty('AUTOMATED_INSERTION_LIMIT')] }] };
        expect(texts(conditionalDraft(ruleSet, createDefaultRuleSet()))).toEqual([
            pickItem('rule.0'), pickItem('rule.0', 'right'), pickItem('rule.1.0'), pickItem('rule.1.0', 'right'), pickItem('release.0'),
        ]);
    });

    it('lets an item in the hand be left empty', () => {
        const ruleSet: RuleSet = { operator: 'AND', rules: [{ left: { type: 'HAND_QUANTITY' }, operator: '>', right: { type: 'CONSTANT', value: 0 } }] };
        expect(texts(conditionalDraft(ruleSet))).toEqual([]);
    });

    it('leaves the release alone while the latch is off', () => {
        expect(texts({ ...conditionalDraft(createDefaultRuleSet(), createDefaultRuleSet()), latchEnabled: false })).toEqual([pickItem('rule.0')]);
    });

    it('refuses a Conditional rule on a drill, first', () => {
        const problems = ruleProblemsOf(conditionalDraft(createDefaultRuleSet()), { ...ctx, entityType: 'drill' });
        expect(problems[0]).toEqual({ fieldId: 'p-mode-CONDITIONAL', field: 'Mode', text: PROBLEM_TEXT.drillConditional });
    });

    it('refuses Never on for a drill into a container, and only there', () => {
        const never: EnableControlDraft = { ...enableControlDraftOf(), mode: 'NEVER' };
        expect(ruleProblemsOf(never, { ...ctx, entityType: 'drill', intoContainer: true }))
            .toEqual([{ fieldId: 'p-mode-NEVER', field: 'Mode', text: PROBLEM_TEXT.drillNeverIntoContainer }]);
        expect(ruleProblemsOf(never, { ...ctx, entityType: 'drill' })).toEqual([]);
        expect(ruleProblemsOf(never, { ...ctx, intoContainer: true })).toEqual([]);
        expect(ruleProblemsOf({ ...never, mode: 'ALWAYS' }, { ...ctx, entityType: 'drill', intoContainer: true })).toEqual([]);
    });

    it('gives every problem its own field id', () => {
        const ruleSet: RuleSet = { operator: 'AND', rules: [empty('INVENTORY_ITEM'), { operator: 'OR', rules: [empty('INVENTORY_ITEM')] }] };
        const ids = ruleProblemsOf(conditionalDraft(ruleSet, ruleSet), { ...ctx, entityType: 'drill' }).map((p) => p.fieldId);
        expect(new Set(ids).size).toBe(ids.length);
        const windowIds = ruleProblemsOf(clockedDraft([['', ''], ['', '']], 'x'), ctx).map((p) => p.fieldId);
        expect(new Set(windowIds).size).toBe(windowIds.length);
    });
});

describe('field names', () => {
    it('names an item picker by its side and the condition\'s place', () => {
        expect(itemFieldName('rule.1', 'left')).toBe('Item, condition 2');
        expect(itemFieldName('rule.1.0', 'right')).toBe('Second item, condition 2.1');
        expect(itemFieldName('release.0', 'left')).toBe('Item, release condition 1');
    });

    it('names a tick field by its side and its wake window', () => {
        expect([start(), end(2)]).toEqual(['Start tick, wake window 1', 'End tick, wake window 2']);
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
            '100 ticks doesn\'t fit a whole number of times into the 264-tick clock period, so the clock can\'t follow this rule exactly.',
        ]);
        expect(ruleWarningsOf(clockedDraft([['0', '5']], '132'), known)).toEqual([]);
        expect(ruleWarningsOf(clockedDraft([['0', '5']], ''), known)).toEqual([]);
        expect(ruleWarningsOf(clockedDraft([['0', '5']], '100'), NO_TIMING)).toEqual([]);
    });
});

describe('blockedSummaryOf', () => {
    it('counts the problems and names the first', () => {
        const problems = ruleProblemsOf(clockedDraft([['10', '5']]), ctx);
        expect(blockedSummaryOf(problems)).toBe(`Can't save yet: 1 problem. ${end()}: ${endBeforeStart(10)}`);
        expect(blockedSummaryOf([...problems, ...problems])).toMatch(/^Can't save yet: 2 problems\. /);
    });
});
