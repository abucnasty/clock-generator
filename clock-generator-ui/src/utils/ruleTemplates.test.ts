import { InserterConfigSchema } from 'clock-generator/browser';
import { describe, expect, it } from 'vitest';
import { createDefaultRuleSet, createDefaultStatusCondition } from '../components/ruleSetUtils';
import { effectiveInserterStackSize } from './inserterMetadata';
import type { Condition, RuleSet } from './configForm/formData';
import { defaultAmount, isDefaultRuleSet, replacedCount, templateRule, templatesFor, type RuleTemplateId } from './ruleTemplates';

const ids = (source: 'machine' | 'belt' | 'chest', sink: 'machine' | 'belt' | 'chest') => templatesFor(source, sink).map((t) => t.id);

describe('templatesFor', () => {
    it('offers each template only where the machine it reads is', () => {
        expect(ids('machine', 'machine')).toEqual(['source-output-full', 'destination-below-limit', 'latched-output-drain']);
        expect(ids('belt', 'machine')).toEqual(['destination-below-limit']);
        expect(ids('machine', 'chest')).toEqual(['source-output-full', 'latched-output-drain']);
        expect(ids('chest', 'belt')).toEqual([]);
    });
});

describe('templateRule', () => {
    const item = 'electromagnetic-science-pack';
    /** On while all of the conditions hold, as each template's rule sets are */
    const allOf = (...rules: Condition[]): RuleSet => ({ operator: 'AND', rules });

    it.each<{ id: RuleTemplateId; why: string; amount: number; made: ReturnType<typeof templateRule> }>([
        { id: 'source-output-full', why: 'when the source is Output full', amount: 32, made: {
            ruleSet: allOf({ left: { type: 'MACHINE_STATUS', entity: 'SOURCE', status: 'OUTPUT_FULL' }, operator: '==', right: { type: 'CONSTANT', value: 1 } }),
        } },
        { id: 'destination-below-limit', why: 'for the item', amount: 32, made: {
            ruleSet: allOf({
                left: { type: 'INVENTORY_ITEM', entity: 'SINK', item_name: item },
                operator: '<',
                right: { type: 'AUTOMATED_INSERTION_LIMIT', entity: 'SINK', item_name: item },
            }),
        } },
        { id: 'latched-output-drain', why: 'at the amount, until the output block', amount: 24, made: {
            ruleSet: allOf({ left: { type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: item }, operator: '>=', right: { type: 'CONSTANT', value: 24 } }),
            release: allOf({ left: { type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: item }, operator: '<', right: { type: 'OUTPUT_BLOCK', entity: 'SOURCE' } }),
        } },
    ])('makes $id $why, a rule the engine reads', ({ id, amount, made }) => {
        const rule = templateRule(id, { item, amount });
        expect(rule).toEqual(made);
        const enable_control = { mode: 'CONDITIONAL' as const, rule_set: rule.ruleSet, ...(rule.release && { latch: { release: rule.release } }) };
        const inserter = { source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 }, stack_size: 16, overrides: { enable_control } };
        expect(InserterConfigSchema.safeParse(inserter).success).toBe(true);
    });
});

describe('defaultAmount', () => {
    it.each([
        [{ prototype: 'bulk-inserter', quality: 'normal' }, 24],
        [{ prototype: 'fast-inserter', quality: 'normal' }, 8],
        [{ prototype: 'bulk-inserter', stack_size: 8 }, 16],
    ] as const)('uses two effective hands for %j', (inserter, expected) => {
        expect(defaultAmount(effectiveInserterStackSize(inserter))).toBe(expected);
    });

    it('is two hands of the inserter', () => {
        expect(defaultAmount(16)).toBe(32);
        expect(defaultAmount(12)).toBe(24);
        expect(defaultAmount(undefined)).toBe(32);
    });
});

describe('replacedCount and isDefaultRuleSet', () => {
    it('counts the conditions in groups too', () => {
        const ruleSet: RuleSet = { operator: 'OR', rules: [createDefaultStatusCondition(), { operator: 'AND', rules: [createDefaultStatusCondition(), createDefaultStatusCondition()] }] };
        expect(replacedCount(ruleSet)).toBe(3);
        expect(replacedCount(createDefaultRuleSet())).toBe(1);
    });

    it('knows the rule set a new Conditional rule starts with', () => {
        expect(isDefaultRuleSet(createDefaultRuleSet())).toBe(true);
        expect(isDefaultRuleSet({ operator: 'AND', rules: [createDefaultStatusCondition()] })).toBe(false);
        expect(isDefaultRuleSet({ ...createDefaultRuleSet(), operator: 'OR' })).toBe(false);
    });
});
