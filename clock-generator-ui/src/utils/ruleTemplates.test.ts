import { InserterConfigSchema } from 'clock-generator/browser';
import { describe, expect, it } from 'vitest';
import { createDefaultRuleSet, createDefaultStatusCondition } from '../components/ruleSetUtils';
import { effectiveInserterStackSize } from './inserterMetadata';
import type { RuleSet } from './configForm/formData';
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

    it('makes "Source output full"', () => {
        expect(templateRule('source-output-full', { item, amount: 32 })).toEqual({
            ruleSet: {
                operator: 'AND',
                rules: [{ left: { type: 'MACHINE_STATUS', entity: 'SOURCE', status: 'OUTPUT_FULL' }, operator: '==', right: { type: 'CONSTANT', value: 1 } }],
            },
        });
    });

    it('makes "Destination below its insertion limit" for the item', () => {
        expect(templateRule('destination-below-limit', { item, amount: 32 })).toEqual({
            ruleSet: {
                operator: 'AND',
                rules: [{
                    left: { type: 'INVENTORY_ITEM', entity: 'SINK', item_name: item },
                    operator: '<',
                    right: { type: 'AUTOMATED_INSERTION_LIMIT', entity: 'SINK', item_name: item },
                }],
            },
        });
    });

    it('makes "Latched output drain" with the amount, released on the source\'s output block', () => {
        expect(templateRule('latched-output-drain', { item, amount: 24 })).toEqual({
            ruleSet: {
                operator: 'AND',
                rules: [{ left: { type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: item }, operator: '>=', right: { type: 'CONSTANT', value: 24 } }],
            },
            release: {
                operator: 'AND',
                rules: [{ left: { type: 'INVENTORY_ITEM', entity: 'SOURCE', item_name: item }, operator: '<', right: { type: 'OUTPUT_BLOCK', entity: 'SOURCE' } }],
            },
        });
    });

    it.each<RuleTemplateId>(['source-output-full', 'destination-below-limit', 'latched-output-drain'])('makes a %s rule the engine reads', (id) => {
        const { ruleSet, release } = templateRule(id, { item, amount: 32 });
        const enable_control = { mode: 'CONDITIONAL' as const, rule_set: ruleSet, ...(release && { latch: { release } }) };
        const inserter = { source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 }, stack_size: 16, overrides: { enable_control } };
        expect(InserterConfigSchema.safeParse(inserter).success).toBe(true);
    });
});

describe('defaultAmount', () => {
    it.each([
        [{ prototype: 'bulk-inserter', quality: 'normal' }, 24],
        [{ prototype: 'fast-inserter', quality: 'normal' }, 8],
        [{ prototype: 'bulk-inserter', quality: 'legendary' }, 24],
        [{}, 32],
        [{ prototype: 'bulk-inserter', stack_size: 8 }, 16],
        [{ prototype: 'fast-inserter', stack_size: 16 }, 32],
        [{ stack_size: 16 }, 32],
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
