/**
 * An enable rule in plain words, as the rule editor shows it while it is edited, and what of it reaches the blueprint.
 * Pure: items are named by the `itemLabel` the caller passes (2.8 a's in-game names).
 */
import {
    ComparisonOperator,
    EnableControlMode,
    EntityReference,
    MachineStatus,
    RuleOperator,
    ValueReferenceType,
} from 'clock-generator/light';
import { isCondition } from '../components/ruleSetUtils';
import type { Condition, EnableControlOverride, RuleSet, ValueReference } from './configForm/formData';
import { ticksText, type RuleTiming } from './ruleTiming';

type EntityType = 'inserter' | 'drill';

/** "inserter" or "mining drill", as the rule editor's sentences name the entity */
export function entityNoun(entityType: EntityType): string {
    return entityType === 'drill' ? 'mining drill' : 'inserter';
}

/** The words the rule editor shows, besides the problems (`ruleProblems.ts`) */
export const RULE_COPY = {
    legend: (entityType: EntityType) => `Choose when this ${entityNoun(entityType)} is switched on.`,
    sentenceLabel: 'In words',
    blueprintLabel: 'In the blueprint',
    auto: 'Auto: the generator decides when it is on.',
    always: 'On all the time.',
    never: 'Never on.',
    noWindows: 'No wake windows yet.',
    leftOut: (numbers: number[]) =>
        numbers.length === 1
            ? ` Wake window ${numbers[0]} is left out until its problem is fixed.`
            : ` Wake windows ${joinList(numbers.map(String))} are left out until their problems are fixed.`,
    blueprint: {
        [EnableControlMode.AUTO]: (entity: string) =>
            `The generator finds this ${entity}'s wake windows, and the blueprint switches it on in them.`,
        [EnableControlMode.ALWAYS]: () => 'Not wired to the clock: no combinator.',
        [EnableControlMode.NEVER]: () =>
            'The simulator keeps it off. The blueprint has no combinator for it, so keep it off in the game yourself.',
        [EnableControlMode.CLOCKED]: (entity: string) =>
            `These ticks are not copied into the blueprint. The simulator switches the ${entity} on in them while it plans the clock; the blueprint then switches it on in the ticks it moved items, which can be fewer.`,
        [EnableControlMode.CONDITIONAL]: (entity: string) =>
            `The blueprint holds no circuit condition from this rule. The simulator follows the rule while it plans the clock; the blueprint then switches the ${entity} on in the ticks it moved items.`,
    },
    periodUnknown:
        'Run Check only or Generate to see the crafting cycle and the clock period. Until then the ticks can\'t be checked against them.',
    fromResults: ' From the clock on Results.',
    fromCheck: ' From your last check.',
    noItem: '(no item)',
} as const;

/** "a", "a and b", "a, b and c" */
function joinList(parts: string[]): string {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const OPERATOR_TEXT: Record<ComparisonOperator, string> = {
    [ComparisonOperator.GREATER_THAN]: '>',
    [ComparisonOperator.LESS_THAN]: '<',
    [ComparisonOperator.GREATER_THAN_OR_EQUAL]: '≥',
    [ComparisonOperator.LESS_THAN_OR_EQUAL]: '≤',
    [ComparisonOperator.EQUAL]: '=',
    [ComparisonOperator.NOT_EQUAL]: '≠',
};

/** The statuses as the editor lists them */
export const STATUS_LABELS: Record<MachineStatus, string> = {
    [MachineStatus.INGREDIENT_SHORTAGE]: 'Ingredient shortage',
    [MachineStatus.WORKING]: 'Working',
    [MachineStatus.OUTPUT_FULL]: 'Output full',
    [MachineStatus.NO_FUEL]: 'No fuel',
};

const END_NAMES: Record<EntityReference, { the: string; whose: string }> = {
    [EntityReference.SOURCE]: { the: 'the source', whose: "the source's" },
    [EntityReference.SINK]: { the: 'the destination', whose: "the destination's" },
};

type ItemLabel = (id: string) => string;

function valueText(value: ValueReference, itemLabel: ItemLabel): string {
    const item = (id: string | undefined) => (id ? itemLabel(id) : RULE_COPY.noItem);
    switch (value.type) {
        case ValueReferenceType.CONSTANT:
            return `${value.value}`;
        case ValueReferenceType.INVENTORY_ITEM:
            return `${item(value.item_name)} in ${END_NAMES[value.entity].the}`;
        case ValueReferenceType.AUTOMATED_INSERTION_LIMIT:
            return `${END_NAMES[value.entity].whose} insertion limit for ${item(value.item_name)}`;
        case ValueReferenceType.OUTPUT_BLOCK:
            return `${END_NAMES[value.entity].whose} output block`;
        case ValueReferenceType.CRAFTING_PROGRESS:
            return `${END_NAMES[value.entity].whose} crafting progress (%)`;
        case ValueReferenceType.BONUS_PROGRESS:
            return `${END_NAMES[value.entity].whose} bonus progress (%)`;
        case ValueReferenceType.HAND_QUANTITY:
            return value.item_name ? `${itemLabel(value.item_name)} in its hand` : 'items in its hand';
        case ValueReferenceType.INSERTER_STACK_SIZE:
            return 'its stack size';
        case ValueReferenceType.MACHINE_STATUS:
            return `${END_NAMES[value.entity].the} status`;
    }
}

function conditionText(condition: Condition, itemLabel: ItemLabel): string {
    const { left } = condition;
    if (left.type === ValueReferenceType.MACHINE_STATUS) {
        const verb = condition.operator === ComparisonOperator.NOT_EQUAL ? 'is not' : 'is';
        return `${END_NAMES[left.entity].the} ${verb} ${STATUS_LABELS[left.status]}`;
    }
    return `${valueText(left, itemLabel)} ${OPERATOR_TEXT[condition.operator]} ${valueText(condition.right, itemLabel)}`;
}

function ruleSetText(ruleSet: RuleSet, itemLabel: ItemLabel): string {
    const join = ruleSet.operator === RuleOperator.OR ? ' or ' : ' and ';
    return ruleSet.rules
        .map((rule) => (isCondition(rule) ? conditionText(rule, itemLabel) : `(${ruleSetText(rule, itemLabel)})`))
        .join(join);
}

function windowsText(ranges: readonly { start: number; end: number }[]): string {
    if (ranges.length === 1 && ranges[0].start === ranges[0].end) return `tick ${ranges[0].start}`;
    return `ticks ${joinList(ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`)))}`;
}

interface SentenceContext {
    itemLabel: ItemLabel;
    /** The crafting cycle, which a Clocked rule with no "Repeat every" repeats with */
    cycleTicks: number | null;
    /** Numbers (from 1) of the wake windows left out of the rule for a problem */
    invalidWindows?: number[];
}

/** The rule as the player would say it: "On at ticks 12–20 and 80–95 of every 264 ticks." */
export function ruleSentenceOf(override: EnableControlOverride | undefined, ctx: SentenceContext): string {
    switch (override?.mode ?? EnableControlMode.AUTO) {
        case EnableControlMode.ALWAYS:
            return RULE_COPY.always;
        case EnableControlMode.NEVER:
            return RULE_COPY.never;
        case EnableControlMode.CLOCKED: {
            const clocked = override as Extract<EnableControlOverride, { mode: 'CLOCKED' }>;
            const every = clocked.period_duration_ticks !== undefined
                ? `${clocked.period_duration_ticks} ticks`
                : ctx.cycleTicks !== null
                    ? `crafting cycle (${ticksText(ctx.cycleTicks)} ticks)`
                    : 'crafting cycle';
            const on = clocked.ranges.length > 0 ? `On at ${windowsText(clocked.ranges)} of every ${every}.` : RULE_COPY.noWindows;
            const invalid = ctx.invalidWindows ?? [];
            return invalid.length > 0 ? `${on}${RULE_COPY.leftOut(invalid)}` : on;
        }
        case EnableControlMode.CONDITIONAL: {
            const conditional = override as Extract<EnableControlOverride, { mode: 'CONDITIONAL' }>;
            const on = `On while ${ruleSetText(conditional.rule_set, ctx.itemLabel)}.`;
            return conditional.latch
                ? `${on} Once on, it stays on until ${ruleSetText(conditional.latch.release, ctx.itemLabel)}.`
                : on;
        }
        default:
            return RULE_COPY.auto;
    }
}

/** What of the rule reaches the blueprint, for a mode */
export function blueprintNoteOf(mode: EnableControlMode, entityType: EntityType): string {
    return RULE_COPY.blueprint[mode](entityNoun(entityType));
}

/** The crafting cycle and the clock period the editor checks the ticks against, and where they come from */
export function periodLineOf(timing: RuleTiming): string {
    const { cycleTicks, periodTicks, from } = timing;
    if (from === null || cycleTicks === null || periodTicks === null) return RULE_COPY.periodUnknown;
    const source = from === 'results' ? RULE_COPY.fromResults : RULE_COPY.fromCheck;
    const cycle = `Crafting cycle: ${ticksText(cycleTicks)} ticks.`;
    if (!Number.isInteger(periodTicks)) {
        return `${cycle} The clock period is ${ticksText(periodTicks)} ticks, not a whole number, so a Clocked rule can't repeat with it.${source}`;
    }
    const cycles = Math.round(periodTicks / cycleTicks);
    return `${cycle} Clock period: ${periodTicks} ticks (${cycles} crafting ${cycles === 1 ? 'cycle' : 'cycles'}).${source}`;
}
