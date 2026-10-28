import { describe, expect, it } from 'vitest';
import {
    ComparisonOperator,
    EnableControlMode,
    EntityReference,
    RuleOperator,
    ValueReferenceType,
} from 'clock-generator/light';
import type { Condition, EnableControlOverride, RuleSet } from '../hooks/useConfigForm';
import { CONDITIONAL_CHIP_MAX_CHARS, ENABLE_CHIP_MAX_CHARS, describeEnableRule, enableChipAriaLabel, enableChipTooltip } from './enableRuleLabel';

const clocked = (ranges: [number, number][], period?: number): EnableControlOverride => ({
    mode: EnableControlMode.CLOCKED,
    ranges: ranges.map(([start, end]) => ({ start, end })),
    ...(period === undefined ? {} : { period_duration_ticks: period }),
});

const condition = (): Condition => ({
    left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SOURCE, item_name: 'iron-plate' },
    operator: ComparisonOperator.GREATER_THAN_OR_EQUAL,
    right: { type: ValueReferenceType.CONSTANT, value: 10 },
});

const ruleSet = (...rules: (Condition | RuleSet)[]): RuleSet => ({ operator: RuleOperator.AND, rules });

const conditional = (rule_set: RuleSet, latched = false): EnableControlOverride => ({
    mode: EnableControlMode.CONDITIONAL,
    rule_set,
    ...(latched ? { latch: { release: ruleSet(condition()) } } : {}),
});

/** Four conditions, two of them in a nested set */
const nested = ruleSet(condition(), condition(), ruleSet(condition(), condition()));

/** Each rule with the chip and the summary it reads as */
const DESCRIBED: [string, EnableControlOverride, string, string][] = [
    ['names ALWAYS as Always on', { mode: EnableControlMode.ALWAYS }, 'Enable: Always on', 'Always on'],
    ['names NEVER as Never on', { mode: EnableControlMode.NEVER }, 'Enable: Never on', 'Never on'],
    ['prints one CLOCKED range without a period', clocked([[0, 7]]), 'Clocked 0–7', 'Clocked 0–7 ticks'],
    ['prints one CLOCKED range with its period', clocked([[1, 2]], 168), 'Clocked 1–2 of 168', 'Clocked 1–2 of 168 ticks'],
    ['prints two ranges with the period, as the production science sample has them', clocked([[20, 45], [74, 89]], 112),
        'Clocked 20–45, 74–89 of 112', 'Clocked 20–45, 74–89 of 112 ticks'],
    ['prints two ranges without a period', clocked([[20, 45], [74, 89]]), 'Clocked 20–45, 74–89', 'Clocked 20–45, 74–89 ticks'],
    ['shortens four ranges to the first two and a count, and keeps all four in the summary', clocked([[0, 100], [150, 250], [300, 400], [450, 550]]),
        'Clocked 0–100, 150–250 +2 more', 'Clocked 0–100, 150–250, 300–400, 450–550 ticks'],
    ['drops the period from the chip before it drops a range', clocked([[1000, 1450], [1740, 1890]], 2240),
        'Clocked 1000–1450, 1740–1890', 'Clocked 1000–1450, 1740–1890 of 2240 ticks'],
    ['keeps one range and a count when two do not fit', clocked([[1000, 1450], [1740, 1890], [2000, 2100]]),
        'Clocked 1000–1450 +2 more', 'Clocked 1000–1450, 1740–1890, 2000–2100 ticks'],
    ['prints a range that ends before it starts as stored', clocked([[7, 0]]), 'Clocked 7–0', 'Clocked 7–0 ticks'],
    ['reads an empty range list as no wake windows', clocked([]), 'Clocked, no wake windows', 'Clocked, no wake windows'],
    ['prints no period of 0', clocked([[0, 7]], 0), 'Clocked 0–7', 'Clocked 0–7 ticks'],
    ['counts the condition of a CONDITIONAL rule', conditional(ruleSet(condition())), 'Conditional: 1 condition', 'Conditional: 1 condition'],
    ['counts the conditions of a CONDITIONAL rule, nested ones included', conditional(nested), 'Conditional: 4 conditions', 'Conditional: 4 conditions'],
    ['adds latched to a CONDITIONAL rule with a latch, without counting its release condition', conditional(nested, true),
        'Conditional: 4 conditions, latched', 'Conditional: 4 conditions, latched'],
    ['leaves latched off the chip, and keeps it in the summary, when the count is too long for both',
        conditional(ruleSet(...Array.from({ length: 1000 }, condition)), true), 'Conditional: 1000 conditions', 'Conditional: 1000 conditions, latched'],
    ['reads a rule set with no conditions as no conditions', conditional(ruleSet(ruleSet())), 'Conditional: no conditions', 'Conditional: no conditions'],
];

/** Rules too long for the chip in any shorter form, with their whole summary */
const CUT: [string, EnableControlOverride, string][] = [
    ['cuts the text with an ellipsis as a last resort, and keeps the summary whole', clocked([[1234567890, 12345678901234]]),
        'Clocked 1234567890–12345678901234 ticks'],
    ['cuts a rule of several ranges as a last resort when even one range and its count do not fit', clocked([[1234567890, 12345678901234], [1, 2]]),
        'Clocked 1234567890–12345678901234, 1–2 ticks'],
];

/** Every rule the cases build */
const ALL_CASES: (EnableControlOverride | undefined)[] = [
    undefined, { mode: EnableControlMode.AUTO }, ...DESCRIBED.map(([, override]) => override), ...CUT.map(([, override]) => override),
];

describe('describeEnableRule', () => {
    it('reads Auto, quietly, for no override and for AUTO; every other mode is not quiet', () => {
        for (const override of [undefined, { mode: EnableControlMode.AUTO } as const]) {
            expect(describeEnableRule(override)).toEqual({ mode: EnableControlMode.AUTO, chip: 'Enable: Auto', summary: 'Auto', quiet: true });
        }
        for (const override of ALL_CASES.filter((o) => o && o.mode !== EnableControlMode.AUTO)) {
            expect(describeEnableRule(override).quiet).toBe(false);
        }
    });

    it.each(DESCRIBED)('%s', (_, override, chip, summary) => {
        expect(describeEnableRule(override)).toMatchObject({ mode: override.mode, chip, summary });
    });

    it('says an ALWAYS was set by Exclude from LCM in the summary only, and only for ALWAYS', () => {
        expect(describeEnableRule({ mode: EnableControlMode.ALWAYS }, { forcedAlways: true })).toMatchObject({
            chip: 'Enable: Always on', summary: 'Always on (set by Exclude from LCM)',
        });
        for (const override of ALL_CASES.filter((o) => o?.mode !== EnableControlMode.ALWAYS)) {
            expect(describeEnableRule(override, { forcedAlways: true })).toEqual(describeEnableRule(override));
        }
    });

    it.each(CUT)('%s', (_, override, summary) => {
        const description = describeEnableRule(override);
        expect(description.chip).toHaveLength(ENABLE_CHIP_MAX_CHARS);
        expect(description.chip.startsWith('Clocked 1234567890–')).toBe(true);
        expect(description.chip.endsWith('…')).toBe(true);
        expect(description.summary).toBe(summary);
    });

    it('never makes a chip longer than the limit', () => {
        for (const override of ALL_CASES) {
            const limit = override?.mode === EnableControlMode.CONDITIONAL ? CONDITIONAL_CHIP_MAX_CHARS : ENABLE_CHIP_MAX_CHARS;
            expect(describeEnableRule(override).chip.length).toBeLessThanOrEqual(limit);
        }
    });
});

describe('enableChipAriaLabel and enableChipTooltip', () => {
    const description = describeEnableRule(clocked([[0, 7]]));

    it('starts the accessible name with the chip text, then names the entity', () => {
        expect(enableChipAriaLabel('Inserter 3', description)).toBe('Clocked 0–7, Inserter 3. Edit rule');
        expect(enableChipAriaLabel('Drill 2', describeEnableRule(undefined))).toBe('Enable: Auto, Drill 2. Edit rule');
        for (const override of ALL_CASES) {
            const described = describeEnableRule(override);
            expect(enableChipAriaLabel('Inserter 1', described).startsWith(described.chip)).toBe(true);
        }
    });

    it('describes a rule by the whole rule in ticks, without repeating the action', () => {
        expect(enableChipTooltip('inserter', description)).toBe('Clocked 0–7 ticks');
        expect(enableChipTooltip('inserter', describeEnableRule({ mode: EnableControlMode.ALWAYS }, { forcedAlways: true }))).toBe('Always on (set by Exclude from LCM)');
    });

    it.each(['inserter', 'drill'] as const)('explains Auto for the %s', (type) => {
        expect(enableChipTooltip(type, describeEnableRule(undefined)))
            .toBe(`Auto: the generator decides when this ${type} runs. You don't need to change it. Click to set your own rule.`);
    });
});
