import {
    ValueReferenceType,
    EntityReference,
    ComparisonOperator,
    RuleOperator,
    MachineStatus,
} from 'clock-generator/light';
import type { Condition, RuleSet } from '../hooks/useConfigForm';

export function isCondition(rule: Condition | RuleSet): rule is Condition {
    return 'left' in rule && 'operator' in rule && 'right' in rule;
}

export function createDefaultCondition(): Condition {
    return {
        left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SOURCE, item_name: '' },
        operator: ComparisonOperator.GREATER_THAN_OR_EQUAL,
        right: { type: ValueReferenceType.CONSTANT, value: 0 },
    };
}

export function createDefaultStatusCondition(): Condition {
    return {
        left: { type: ValueReferenceType.MACHINE_STATUS, entity: EntityReference.SOURCE, status: MachineStatus.OUTPUT_FULL },
        operator: ComparisonOperator.EQUAL,
        right: { type: ValueReferenceType.CONSTANT, value: 1 },
    };
}

export function createDefaultRuleSet(): RuleSet {
    return {
        operator: RuleOperator.AND,
        rules: [createDefaultCondition()],
    };
}
