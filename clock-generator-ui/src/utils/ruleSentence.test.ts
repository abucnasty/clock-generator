import { describe, expect, it } from 'vitest';
import type { Condition, EnableControlOverride, RuleSet, ValueReference } from './configForm/formData';
import { blueprintNoteOf, periodLineOf, ruleSentenceOf } from './ruleSentence';
import { NO_TIMING } from './ruleTiming';

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
const compare = (left: ValueReference, right: ValueReference = { type: 'CONSTANT', value: 5 }): Condition => ({ left, operator: '>', right });

describe('ruleSentenceOf', () => {
    it('says Auto, Always on and Never on in their own words', () => {
        expect(ruleSentenceOf(undefined, ctx)).toBe('Auto: the generator decides when it is on.');
        expect(ruleSentenceOf({ mode: 'AUTO' }, ctx)).toBe('Auto: the generator decides when it is on.');
        expect(ruleSentenceOf({ mode: 'ALWAYS' }, ctx)).toBe('On all the time.');
        expect(ruleSentenceOf({ mode: 'NEVER' }, ctx)).toBe('Never on.');
    });

    it('lists Clocked windows with the period', () => {
        expect(ruleSentenceOf(clocked([{ start: 12, end: 20 }], 264), ctx)).toBe('On at ticks 12–20 of every 264 ticks.');
        expect(ruleSentenceOf(clocked([{ start: 12, end: 20 }, { start: 80, end: 95 }, { start: 120, end: 130 }], 264), ctx))
            .toBe('On at ticks 12–20, 80–95 and 120–130 of every 264 ticks.');
        expect(ruleSentenceOf(clocked([{ start: 12, end: 12 }], 264), ctx)).toBe('On at tick 12 of every 264 ticks.');
    });

    it('repeats every crafting cycle without a period, with its length when known', () => {
        expect(ruleSentenceOf(clocked([{ start: 12, end: 20 }]), ctx)).toBe('On at ticks 12–20 of every crafting cycle (132 ticks).');
        expect(ruleSentenceOf(clocked([{ start: 12, end: 20 }]), { ...ctx, cycleTicks: null })).toBe('On at ticks 12–20 of every crafting cycle.');
    });

    it('says which windows are left out for a problem', () => {
        expect(ruleSentenceOf(clocked([{ start: 12, end: 20 }], 264), { ...ctx, invalidWindows: [2] }))
            .toBe('On at ticks 12–20 of every 264 ticks. Wake window 2 is left out until its problem is fixed.');
        expect(ruleSentenceOf(clocked([], 264), { ...ctx, invalidWindows: [1, 2] }))
            .toBe('No wake windows yet. Wake windows 1 and 2 are left out until their problems are fixed.');
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
        [{ type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: '' }, '(no item) in the source'],
    ])('names %j', (value, text) => {
        expect(ruleSentenceOf(conditional(one(compare(value))), ctx)).toBe(`On while ${text} > 5.`);
    });

    it('prints every operator as a sign', () => {
        const operators = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠' } as const;
        for (const [operator, sign] of Object.entries(operators)) {
            const condition: Condition = { left: { type: 'CONSTANT', value: 1 }, operator: operator as Condition['operator'], right: { type: 'CONSTANT', value: 2 } };
            expect(ruleSentenceOf(conditional(one(condition)), ctx)).toBe(`On while 1 ${sign} 2.`);
        }
    });

    it('says is and is not for a status', () => {
        const status = (operator: '==' | '!='): Condition => ({ left: { type: 'MACHINE_STATUS', entity: 'SOURCE', status: 'OUTPUT_FULL' }, operator, right: { type: 'CONSTANT', value: 1 } });
        expect(ruleSentenceOf(conditional(one(status('=='))), ctx)).toBe('On while the source is Output full.');
        expect(ruleSentenceOf(conditional(one(status('!='))), ctx)).toBe('On while the source is not Output full.');
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
    it('names the cycle, the period and where they come from', () => {
        expect(periodLineOf({ cycleTicks: 132, periodTicks: 264, from: 'results', windows: {} }))
            .toBe('Crafting cycle: 132 ticks. Clock period: 264 ticks (2 crafting cycles). From the clock on Results.');
        expect(periodLineOf({ cycleTicks: 132, periodTicks: 132, from: 'check', windows: null }))
            .toBe('Crafting cycle: 132 ticks. Clock period: 132 ticks (1 crafting cycle). From your last check.');
    });

    it('asks for a check when nothing is known', () => {
        expect(periodLineOf(NO_TIMING))
            .toBe('Run Check only or Generate to see the crafting cycle and the clock period. Until then the ticks can\'t be checked against them.');
    });

    it('says a fractional period can\'t be repeated by a rule', () => {
        expect(periodLineOf({ cycleTicks: 137.739, periodTicks: 550.957, from: 'results', windows: {} }))
            .toBe('Crafting cycle: 137.739 ticks. The clock period is 550.957 ticks, not a whole number, so a Clocked rule can\'t repeat with it. From the clock on Results.');
    });
});
