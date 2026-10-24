/**
 * The Conditional rule's quick templates: which fit an inserter's two ends, and the rule each makes from the item and
 * amount the player picks. Pure; `QuickTemplateSelect` asks for those and confirms before it replaces anything.
 */
import {
    ComparisonOperator,
    EntityReference,
    MachineStatus,
    RuleOperator,
    TargetType,
    ValueReferenceType,
} from 'clock-generator/light';
import { createDefaultRuleSet, isCondition } from '../components/ruleSetUtils';
import type { RuleSet } from './configForm/formData';

export type RuleTemplateId = 'source-output-full' | 'destination-below-limit' | 'latched-output-drain';

export interface RuleTemplate {
    id: RuleTemplateId;
    name: string;
    description: string;
    needsItem: boolean;
    needsAmount: boolean;
}

type EndType = typeof TargetType[keyof typeof TargetType];

const TEMPLATES: Record<RuleTemplateId, RuleTemplate> = {
    'source-output-full': {
        id: 'source-output-full',
        name: 'Source output full',
        description: 'On while the source machine is Output full.',
        needsItem: false,
        needsAmount: false,
    },
    'destination-below-limit': {
        id: 'destination-below-limit',
        name: 'Destination below its insertion limit',
        description: 'On while the destination machine holds less of the item than its insertion limit.',
        needsItem: true,
        needsAmount: false,
    },
    'latched-output-drain': {
        id: 'latched-output-drain',
        name: 'Latched output drain',
        description:
            'Switches on when the source machine holds at least an amount of the item, and stays on until it holds less than its output block.',
        needsItem: true,
        needsAmount: true,
    },
};

/** The templates that can work for an inserter between these two ends: each reads a machine at the end it names */
export function templatesFor(sourceType: EndType, sinkType: EndType): RuleTemplate[] {
    const list: RuleTemplate[] = [];
    if (sourceType === TargetType.MACHINE) list.push(TEMPLATES['source-output-full']);
    if (sinkType === TargetType.MACHINE) list.push(TEMPLATES['destination-below-limit']);
    if (sourceType === TargetType.MACHINE) list.push(TEMPLATES['latched-output-drain']);
    return list;
}

/**
 * The rule a template makes. The latched drain is the repo's own electromagnetic-science sample: on at `amount` of the
 * item in the source, off again once the source holds less than its output block (decided 2026-10-14)
 */
export function templateRule(id: RuleTemplateId, { item, amount }: { item: string; amount: number }): { ruleSet: RuleSet; release?: RuleSet } {
    switch (id) {
        case 'source-output-full':
            return {
                ruleSet: {
                    operator: RuleOperator.AND,
                    rules: [{
                        left: { type: ValueReferenceType.MACHINE_STATUS, entity: EntityReference.SOURCE, status: MachineStatus.OUTPUT_FULL },
                        operator: ComparisonOperator.EQUAL,
                        right: { type: ValueReferenceType.CONSTANT, value: 1 },
                    }],
                },
            };
        case 'destination-below-limit':
            return {
                ruleSet: {
                    operator: RuleOperator.AND,
                    rules: [{
                        left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SINK, item_name: item },
                        operator: ComparisonOperator.LESS_THAN,
                        right: { type: ValueReferenceType.AUTOMATED_INSERTION_LIMIT, entity: EntityReference.SINK, item_name: item },
                    }],
                },
            };
        case 'latched-output-drain':
            return {
                ruleSet: {
                    operator: RuleOperator.AND,
                    rules: [{
                        left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SOURCE, item_name: item },
                        operator: ComparisonOperator.GREATER_THAN_OR_EQUAL,
                        right: { type: ValueReferenceType.CONSTANT, value: amount },
                    }],
                },
                release: {
                    operator: RuleOperator.AND,
                    rules: [{
                        left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SOURCE, item_name: item },
                        operator: ComparisonOperator.LESS_THAN,
                        right: { type: ValueReferenceType.OUTPUT_BLOCK, entity: EntityReference.SOURCE },
                    }],
                },
            };
    }
}

/** The latched drain's amount to start from: two hands of the inserter (32 at stack size 16, as the sample has) */
export function defaultAmount(stackSize: number | undefined): number {
    return 2 * (stackSize ?? 16);
}

/** How many conditions a rule set holds, in its groups too */
export function replacedCount(ruleSet: RuleSet): number {
    return ruleSet.rules.reduce((count, rule) => count + (isCondition(rule) ? 1 : replacedCount(rule)), 0);
}

/** Whether a rule set is the one a new Conditional rule starts with, untouched */
export function isDefaultRuleSet(ruleSet: RuleSet): boolean {
    return JSON.stringify(ruleSet) === JSON.stringify(createDefaultRuleSet());
}
