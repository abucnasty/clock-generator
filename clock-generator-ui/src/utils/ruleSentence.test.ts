import { describe, expect, it } from 'vitest';
import type { Condition, EnableControlOverride, RuleSet, ValueReference } from './configForm/formData';
import { RULE_COPY, blueprintNoteOf, periodLineOf, ruleSentenceOf } from './ruleSentence';
import { NO_TIMING, type RuleTiming } from './ruleTiming';

const identity = (id: string) => id;
const names: Record<string, string> = { 'electromagnetic-science-pack': 'Electromagnetic science pack', 'iron-plate': 'Iron plate' };
const named = (id: string) => names[id] ?? id;
const ctx = { itemLabel: named, cycleTicks: 132 };

const clocked = (ranges: { start: number; end: number }[], period?: number): EnableControlOverride => ({
    mode: 'CLOCKED',
    ranges,
    ...(period !== undefined && { period_duration_ticks: period }),
});

/** The electromagnetic-science sample's Inserter 2 */
const ELECTROMAGNETIC: EnableControlOverride = {
    mode: 'CONDITIONAL',
    rule_set: {
        operator: 'OR',
        rules: [
            { left: { type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: 'electromagnetic-science-pack' }, operator: '>=', right: { type: 'CONSTANT', value: 32 } },
            { left: { type: 'MACHINE_STATUS', entity: 'SOURCE', status: 'OUTPUT_FULL' }, operator: '==', right: { type: 'CONSTANT', value: 1 } },
        ],
    },
    latch: {
        release: {
            operator: 'AND',
            rules: [{ left: { type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: 'electromagnetic-science-pack' }, operator: '<', right: { type: 'OUTPUT_BLOCK', entity: 'SOURCE' } }],
        },
    },
};

const conditional = (ruleSet: RuleSet): EnableControlOverride => ({ mode: 'CONDITIONAL', rule_set: ruleSet });
const one = (condition: Condition): RuleSet => ({ operator: 'AND', rules: [condition] });
const compare = (left: ValueReference, right: ValueReference = { type: 'CONSTANT', value: 5 }, operator: Condition['operator'] = '>'): Condition =>
    ({ left, operator, right });
/** The sentence of a rule of this one condition */
const said = (condition: Condition) => ruleSentenceOf(conditional(one(condition)), ctx);

const range = { start: 12, end: 20 };

describe('ruleSentenceOf', () => {
    it('says Auto, Always on and Never on in their own words', () => {
        expect(ruleSentenceOf(undefined, ctx)).toBe(RULE_COPY.auto);
        expect(ruleSentenceOf({ mode: 'AUTO' }, ctx)).toBe(RULE_COPY.auto);
        expect(ruleSentenceOf({ mode: 'ALWAYS' }, ctx)).toBe(RULE_COPY.always);
        expect(ruleSentenceOf({ mode: 'NEVER' }, ctx)).toBe(RULE_COPY.never);
    });

    it.each<[string, EnableControlOverride, Partial<Parameters<typeof ruleSentenceOf>[1]>, string]>([
        ['lists a Clocked window with the period', clocked([range], 264), {}, 'On at ticks 12–20 of every 264 ticks.'],
        ['lists several Clocked windows with the period', clocked([range, { start: 80, end: 95 }, { start: 120, end: 130 }], 264), {},
            'On at ticks 12–20, 80–95 and 120–130 of every 264 ticks.'],
        ['lists a one-tick window as its tick', clocked([{ start: 12, end: 12 }], 264), {}, 'On at tick 12 of every 264 ticks.'],
        ['repeats every crafting cycle without a period, with its length when known', clocked([range]), {}, 'On at ticks 12–20 of every crafting cycle (132 ticks).'],
        ['repeats every crafting cycle without a period, without its length when unknown', clocked([range]), { cycleTicks: null },
            'On at ticks 12–20 of every crafting cycle.'],
        ['says which window is left out for a problem', clocked([range], 264), { invalidWindows: [2] },
            'On at ticks 12–20 of every 264 ticks. Wake window 2 is left out until its problem is fixed.'],
        ['says which windows are left out when every one has a problem', clocked([], 264), { invalidWindows: [1, 2] },
            'No wake windows yet. Wake windows 1 and 2 are left out until their problems are fixed.'],
        ['asks for ticks when no window has anything typed in it', clocked([]), {}, RULE_COPY.noWindowsTyped],
    ])('%s', (_, rule, change, sentence) => {
        expect(ruleSentenceOf(rule, { ...ctx, ...change })).toBe(sentence);
    });

    it('reads the electromagnetic-science sample as the acceptance sentence', () => {
        expect(ruleSentenceOf(ELECTROMAGNETIC, { ...ctx, itemLabel: identity })).toBe(
            'On while electromagnetic-science-pack in the source ≥ 32 or the source is Output full. Once on, it stays on until electromagnetic-science-pack in the source < the source\'s output block.',
        );
        expect(ruleSentenceOf(ELECTROMAGNETIC, ctx)).toBe(
            'On while Electromagnetic science pack in the source ≥ 32 or the source is Output full. Once on, it stays on until Electromagnetic science pack in the source < the source\'s output block.',
        );
    });

    it('joins with and or or, and puts a group in parentheses', () => {
        const status: Condition = { left: { type: 'MACHINE_STATUS', entity: 'SINK', status: 'WORKING' }, operator: '!=', right: { type: 'CONSTANT', value: 1 } };
        const rule: RuleSet = {
            operator: 'AND',
            rules: [
                compare({ type: 'HAND_QUANTITY' }),
                { operator: 'OR', rules: [status, compare({ type: 'INSERTER_STACK_SIZE' })] },
            ],
        };
        expect(ruleSentenceOf(conditional(rule), ctx))
            .toBe('On while items in its hand > 5 and (the destination is not Working or its stack size > 5).');
    });

    it.each<[ValueReference, string]>([
        [{ type: 'CONSTANT', value: 7 }, '7'],
        [{ type: 'INVENTORY_ITEM', entity: 'SINK', item_name: 'iron-plate' }, 'Iron plate in the destination'],
        [{ type: 'AUTOMATED_INSERTION_LIMIT', entity: 'SINK', item_name: 'iron-plate' }, 'the destination\'s insertion limit for Iron plate'],
        [{ type: 'OUTPUT_BLOCK', entity: 'SOURCE' }, 'the source\'s output block'],
        [{ type: 'CRAFTING_PROGRESS', entity: 'SINK' }, 'the destination\'s crafting progress (%)'],
        [{ type: 'BONUS_PROGRESS', entity: 'SINK' }, 'the destination\'s bonus progress (%)'],
        [{ type: 'HAND_QUANTITY' }, 'items in its hand'],
        [{ type: 'HAND_QUANTITY', item_name: 'iron-plate' }, 'Iron plate in its hand'],
        [{ type: 'INSERTER_STACK_SIZE' }, 'its stack size'],
        [{ type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: '' }, `${RULE_COPY.noItem} in the source`],
    ])('names %j', (value, text) => {
        expect(said(compare(value))).toBe(`On while ${text} > 5.`);
    });

    it.each([['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤'], ['==', '='], ['!=', '≠']] as const)('prints the operator %s as the sign %s', (operator, sign) => {
        expect(said(compare({ type: 'CONSTANT', value: 1 }, { type: 'CONSTANT', value: 2 }, operator))).toBe(`On while 1 ${sign} 2.`);
    });

    it.each([['==', 'is'], ['!=', 'is not']] as const)('says %s of a status as "%s"', (operator, verb) => {
        const status = compare({ type: 'MACHINE_STATUS', entity: 'SOURCE', status: 'OUTPUT_FULL' }, { type: 'CONSTANT', value: 1 }, operator);
        expect(said(status)).toBe(`On while the source ${verb} Output full.`);
    });
});

describe('blueprintNoteOf', () => {
    it.each([
        ['AUTO', 'The generator finds this inserter\'s wake windows, and the blueprint switches it on in them.', 'The generator finds this mining drill\'s wake windows, and the blueprint switches it on in them.'],
        ['ALWAYS', 'Not wired to the clock: no combinator.', 'Not wired to the clock: no combinator.'],
        ['NEVER', 'The simulator keeps it off. The blueprint has no combinator for it, so keep it off in the game yourself.', 'The simulator keeps it off. The blueprint has no combinator for it, so keep it off in the game yourself.'],
        ['CLOCKED', 'These ticks are not copied into the blueprint. The simulator switches the inserter on in them while it plans the clock; the blueprint then switches it on in the ticks it moved items, which can be fewer.', 'These ticks are not copied into the blueprint. The simulator switches the mining drill on in them while it plans the clock; the blueprint then switches it on in the ticks it moved items, which can be fewer.'],
        ['CONDITIONAL', 'The blueprint holds no circuit condition from this rule. The simulator follows the rule while it plans the clock; the blueprint then switches the inserter on in the ticks it moved items.', 'The blueprint holds no circuit condition from this rule. The simulator follows the rule while it plans the clock; the blueprint then switches the mining drill on in the ticks it moved items.'],
    ] as const)('says what of a %s rule reaches the blueprint', (mode, inserter, drill) => {
        expect(blueprintNoteOf(mode, 'inserter')).toBe(inserter);
        expect(blueprintNoteOf(mode, 'drill')).toBe(drill);
    });
});

describe('periodLineOf', () => {
    it.each<[string, RuleTiming, string]>([
        ['names the cycle, the period and the clock on Results', { cycleTicks: 132, periodTicks: 264, from: 'results', windows: {} },
            `Crafting cycle: 132 ticks. Clock period: 264 ticks (2 crafting cycles).${RULE_COPY.fromResults}`],
        ['names one crafting cycle and the last check', { cycleTicks: 132, periodTicks: 132, from: 'check', windows: null },
            `Crafting cycle: 132 ticks. Clock period: 132 ticks (1 crafting cycle).${RULE_COPY.fromCheck}`],
        ['asks for a check when nothing is known', NO_TIMING, RULE_COPY.periodUnknown],
        ['says a fractional period can\'t be repeated by a rule', { cycleTicks: 137.739, periodTicks: 550.957, from: 'results', windows: {} },
            `Crafting cycle: 137.739 ticks. The clock period is 550.957 ticks, not a whole number, so a Clocked rule can't repeat with it.${RULE_COPY.fromResults}`],
    ])('%s', (_, timing, line) => {
        expect(periodLineOf(timing)).toBe(line);
    });
});
