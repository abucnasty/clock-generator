import { EntityType } from "../entities/entity-type";

export const EnableControlMode = {
    AUTO: "AUTO",
    ALWAYS: "ALWAYS",
    NEVER: "NEVER",
    CLOCKED: "CLOCKED",
    CONDITIONAL: "CONDITIONAL",
} as const;

export type EnableControlMode = typeof EnableControlMode[keyof typeof EnableControlMode];

export const EntityReference = {
    SOURCE: "SOURCE",
    SINK: "SINK",
} as const;

export type EntityReference = typeof EntityReference[keyof typeof EntityReference];

export const ComparisonOperator = {
    GREATER_THAN: ">",
    LESS_THAN: "<",
    GREATER_THAN_OR_EQUAL: ">=",
    LESS_THAN_OR_EQUAL: "<=",
    EQUAL: "==",
    NOT_EQUAL: "!=",
} as const;

export type ComparisonOperator = typeof ComparisonOperator[keyof typeof ComparisonOperator];

export const ValueReferenceType = {
    CONSTANT: "CONSTANT",
    INVENTORY_ITEM: "INVENTORY_ITEM",
    AUTOMATED_INSERTION_LIMIT: "AUTOMATED_INSERTION_LIMIT",
    OUTPUT_BLOCK: "OUTPUT_BLOCK",
    CRAFTING_PROGRESS: "CRAFTING_PROGRESS",
    BONUS_PROGRESS: "BONUS_PROGRESS",
    HAND_QUANTITY: "HAND_QUANTITY",
    MACHINE_STATUS: "MACHINE_STATUS",
    INSERTER_STACK_SIZE: "INSERTER_STACK_SIZE",
} as const;

export type ValueReferenceType = typeof ValueReferenceType[keyof typeof ValueReferenceType];

export const RuleOperator = {
    AND: "AND",
    OR: "OR",
} as const;

export type RuleOperator = typeof RuleOperator[keyof typeof RuleOperator];

export const TargetType = {
    MACHINE: EntityType.MACHINE,
    BELT: EntityType.BELT,
    CHEST: EntityType.CHEST,
} as const;

export type TargetType = typeof TargetType[keyof typeof TargetType];