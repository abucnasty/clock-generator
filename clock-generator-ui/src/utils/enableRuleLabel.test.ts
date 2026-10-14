import { describe, expect, it } from 'vitest';
import {
    ComparisonOperator,
    EnableControlMode,
    EntityReference,
    RuleOperator,
    ValueReferenceType,
} from 'clock-generator/light';
import type { Condition, EnableControlOverride, RuleSet } from '../hooks/useConfigForm';
import { ENABLE_CHIP_MAX_CHARS, describeEnableRule, enableChipAriaLabel, enableChipTooltip } from './enableRuleLabel';

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

/** Every rule the cases below build */
const ALL_CASES: (EnableControlOverride | undefined)[] = [
    undefined,
    { mode: EnableControlMode.AUTO },
    { mode: EnableControlMode.ALWAYS },
    { mode: EnableControlMode.NEVER },
    clocked([[0, 7]]),
    clocked([[1, 2]], 168),
    clocked([[20, 45], [74, 89]], 112),
    clocked([[20, 45], [74, 89]]),
    clocked([[0, 100], [150, 250], [300, 400], [450, 550]]),
    clocked([[1000, 1450], [1740, 1890]], 2240),
    clocked([[1234567890, 12345678901234]]),
    clocked([[1000, 1450], [1740, 1890], [2000, 2100]]),
    clocked([[1234567890, 12345678901234], [1, 2]]),
    clocked([[7, 0]]),
    clocked([]),
    clocked([[0, 7]], 0),
    conditional(ruleSet(condition())),
    conditional(ruleSet(condition(), condition(), ruleSet(condition(), condition()))),
    conditional(ruleSet(condition(), condition(), ruleSet(condition(), condition())), true),
    conditional(ruleSet(ruleSet())),
];

describe('describeEnableRule', () => {
    it('reads Auto, quietly, for no override and for AUTO; every other mode is not quiet', () => {
        for (const override of [undefined, { mode: EnableControlMode.AUTO } as const]) {
            const description = describeEnableRule(override);
            expect(description).toEqual({ mode: EnableControlMode.AUTO, chip: 'Enable: Auto', summary: 'Auto', quiet: true });
        }
        for (const override of ALL_CASES.filter((o) => o && o.mode !== EnableControlMode.AUTO)) {
            expect(describeEnableRule(override).quiet).toBe(false);
        }
    });

    it('names ALWAYS and NEVER', () => {
        expect(describeEnableRule({ mode: EnableControlMode.ALWAYS })).toMatchObject({
            mode: EnableControlMode.ALWAYS, chip: 'Enable: Always', summary: 'Always',
        });
        expect(describeEnableRule({ mode: EnableControlMode.NEVER })).toMatchObject({
            mode: EnableControlMode.NEVER, chip: 'Enable: Never', summary: 'Never',
        });
    });

    it('says an ALWAYS was set by Exclude from LCM in the summary only, and only for ALWAYS', () => {
        expect(describeEnableRule({ mode: EnableControlMode.ALWAYS }, { forcedAlways: true })).toMatchObject({
            chip: 'Enable: Always', summary: 'Always (set by Exclude from LCM)',
        });
        const clockedRule = clocked([[0, 7]]);
        expect(describeEnableRule(clockedRule, { forcedAlways: true })).toEqual(describeEnableRule(clockedRule));
        expect(describeEnableRule({ mode: EnableControlMode.AUTO }, { forcedAlways: true })).toEqual(describeEnableRule({ mode: EnableControlMode.AUTO }));
        expect(describeEnableRule(undefined, { forcedAlways: true })).toEqual(describeEnableRule(undefined));
    });

    it('prints one CLOCKED range without a period', () => {
        expect(describeEnableRule(clocked([[0, 7]]))).toMatchObject({ chip: 'Clocked 0–7', summary: 'Clocked 0–7 ticks' });
    });

    it('prints one CLOCKED range with its period', () => {
        expect(describeEnableRule(clocked([[1, 2]], 168))).toMatchObject({ chip: 'Clocked 1–2 of 168', summary: 'Clocked 1–2 of 168 ticks' });
    });

    it('prints two ranges with the period, as the production science sample has them', () => {
        expect(describeEnableRule(clocked([[20, 45], [74, 89]], 112))).toMatchObject({
            mode: EnableControlMode.CLOCKED,
            chip: 'Clocked 20–45, 74–89 of 112',
            summary: 'Clocked 20–45, 74–89 of 112 ticks',
        });
    });

    it('prints two ranges without a period', () => {
        expect(describeEnableRule(clocked([[20, 45], [74, 89]]))).toMatchObject({ chip: 'Clocked 20–45, 74–89', summary: 'Clocked 20–45, 74–89 ticks' });
    });

    it('shortens four ranges to the first two and a count, and keeps all four in the summary', () => {
        const description = describeEnableRule(clocked([[0, 100], [150, 250], [300, 400], [450, 550]]));
        expect(description.chip).toBe('Clocked 0–100, 150–250 +2 more');
        expect(description.summary).toBe('Clocked 0–100, 150–250, 300–400, 450–550 ticks');
        expect(description.summary.endsWith(' ticks')).toBe(true);
    });

    it('drops the period from the chip before it drops a range', () => {
        expect(describeEnableRule(clocked([[1000, 1450], [1740, 1890]], 2240))).toMatchObject({
            chip: 'Clocked 1000–1450, 1740–1890',
            summary: 'Clocked 1000–1450, 1740–1890 of 2240 ticks',
        });
    });

    it('keeps one range and a count when two do not fit', () => {
        const description = describeEnableRule(clocked([[1000, 1450], [1740, 1890], [2000, 2100]]));
        expect(description.chip).toBe('Clocked 1000–1450 +2 more');
        expect(description.summary).toBe('Clocked 1000–1450, 1740–1890, 2000–2100 ticks');
    });

    it('cuts a rule of several ranges as a last resort when even one range and its count do not fit', () => {
        const description = describeEnableRule(clocked([[1234567890, 12345678901234], [1, 2]]));
        expect(description.chip).toHaveLength(ENABLE_CHIP_MAX_CHARS);
        expect(description.chip.startsWith('Clocked 1234567890–')).toBe(true);
        expect(description.chip.endsWith('…')).toBe(true);
        expect(description.summary).toBe('Clocked 1234567890–12345678901234, 1–2 ticks');
    });

    it('prints a range that ends before it starts as stored', () => {
        expect(describeEnableRule(clocked([[7, 0]]))).toMatchObject({ chip: 'Clocked 7–0', summary: 'Clocked 7–0 ticks' });
    });

    it('cuts the text with an ellipsis as a last resort, and keeps the summary whole', () => {
        const description = describeEnableRule(clocked([[1234567890, 12345678901234]]));
        expect(description.chip).toHaveLength(ENABLE_CHIP_MAX_CHARS);
        expect(description.chip.endsWith('…')).toBe(true);
        expect(description.summary).toBe('Clocked 1234567890–12345678901234 ticks');
    });

    it('reads an empty range list as no ranges, and prints no period of 0', () => {
        expect(describeEnableRule(clocked([]))).toMatchObject({ chip: 'Clocked, no ranges', summary: 'Clocked, no ranges' });
        expect(describeEnableRule(clocked([[0, 7]], 0))).toMatchObject({ chip: 'Clocked 0–7', summary: 'Clocked 0–7 ticks' });
    });

    it('never makes a chip longer than the limit', () => {
        for (const override of ALL_CASES) {
            expect(describeEnableRule(override).chip.length).toBeLessThanOrEqual(ENABLE_CHIP_MAX_CHARS);
        }
    });

    it('counts the conditions of a CONDITIONAL rule, nested ones included', () => {
        expect(describeEnableRule(conditional(ruleSet(condition())))).toMatchObject({ chip: 'Conditional: 1 rule', summary: 'Conditional: 1 rule' });
        const nested = ruleSet(condition(), condition(), ruleSet(condition(), condition()));
        expect(describeEnableRule(conditional(nested))).toMatchObject({ chip: 'Conditional: 4 rules', summary: 'Conditional: 4 rules' });
    });

    it('adds latched to a CONDITIONAL rule with a latch, without counting its release condition', () => {
        const nested = ruleSet(condition(), condition(), ruleSet(condition(), condition()));
        expect(describeEnableRule(conditional(nested, true))).toMatchObject({
            chip: 'Conditional: 4 rules, latched', summary: 'Conditional: 4 rules, latched',
        });
    });

    it('reads a rule set with no conditions as no rules', () => {
        expect(describeEnableRule(conditional(ruleSet(ruleSet())))).toMatchObject({ chip: 'Conditional: no rules' });
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
        expect(enableChipTooltip('Inserter 3', description)).toBe('Clocked 0–7 ticks');
        expect(enableChipTooltip('Inserter 3', describeEnableRule({ mode: EnableControlMode.ALWAYS }, { forcedAlways: true }))).toBe('Always (set by Exclude from LCM)');
    });

    it('explains Auto, for an inserter and for a drill', () => {
        expect(enableChipTooltip('Inserter 3', describeEnableRule(undefined))).toBe(
            "Auto: the generator decides when this inserter runs. You don't need to change it. Click to set your own rule.",
        );
        expect(enableChipTooltip('Drill 2', describeEnableRule(undefined))).toBe(
            "Auto: the generator decides when this drill runs. You don't need to change it. Click to set your own rule.",
        );
    });
});
