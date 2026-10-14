import { EnableControlMode } from 'clock-generator/light';
import { isCondition } from '../components/ruleSetUtils';
import type { EnableControlOverride, RuleSet } from '../hooks/useConfigForm';

/** The longest text the chip shows; the tooltip and the accessible name always have the whole rule */
export const ENABLE_CHIP_MAX_CHARS = 32;

// Every word the chip, its tooltip and its accessible name use is here, so a glossary pass changes them in one place.
const ENABLE_CHIP_PREFIX = 'Enable: ';
const MODE_AUTO = 'Auto';
const MODE_ALWAYS = 'Always';
const MODE_NEVER = 'Never';
const MODE_CLOCKED = 'Clocked';
const MODE_CONDITIONAL = 'Conditional';
const RANGE_DASH = '–';
const RANGE_SEPARATOR = ', ';
const PERIOD_JOINER = ' of ';
const TICKS_SUFFIX = ' ticks';
const NO_RANGES = ', no ranges';
const MORE_RANGES = (count: number) => ` +${count} more`;
const RULE_COUNT_JOINER = ': ';
const RULE_COUNT = (count: number) => (count === 0 ? 'no rules' : `${count} ${count === 1 ? 'rule' : 'rules'}`);
const LATCHED = ', latched';
const FORCED_ALWAYS_NOTE = ' (set by Exclude from LCM)';
const ELLIPSIS = '…';
// The accessible name starts with the visible text (WCAG 2.5.3), then says which entity and what the click does
const ARIA_LABEL = (chip: string, entityLabel: string) => `${chip}, ${entityLabel}. Edit rule`;
const AUTO_TOOLTIP = (entityNoun: string) =>
    `Auto: the generator decides when this ${entityNoun} runs. You don't need to change it. Click to set your own rule.`;

interface EnableRuleDescription {
    /** AUTO when there is no override */
    mode: EnableControlMode;
    /** The text on the chip; never longer than ENABLE_CHIP_MAX_CHARS */
    chip: string;
    /** The whole rule, never cut; used by the tooltip and the accessible name */
    summary: string;
    /** True for AUTO, which the chip shows without the accent colour */
    quiet: boolean;
}

interface Range {
    start: number;
    end: number;
}

function cut(text: string): string {
    return text.length <= ENABLE_CHIP_MAX_CHARS ? text : `${text.slice(0, ENABLE_CHIP_MAX_CHARS - 1)}${ELLIPSIS}`;
}

function countConditions(ruleSet: RuleSet): number {
    return ruleSet.rules.reduce((total, rule) => total + (isCondition(rule) ? 1 : countConditions(rule)), 0);
}

function rangesText(ranges: Range[]): string {
    return ranges.map((range) => `${range.start}${RANGE_DASH}${range.end}`).join(RANGE_SEPARATOR);
}

/** The CLOCKED chip: every range and the period if they fit, else the ranges, else the first ranges and a count of the rest */
function clockedChip(ranges: Range[], period: string): string {
    const head = `${MODE_CLOCKED} `;
    const candidates = [`${head}${rangesText(ranges)}${period}`, `${head}${rangesText(ranges)}`];
    for (let kept = ranges.length - 1; kept >= 1; kept--) {
        candidates.push(`${head}${rangesText(ranges.slice(0, kept))}${MORE_RANGES(ranges.length - kept)}`);
    }
    return candidates.find((text) => text.length <= ENABLE_CHIP_MAX_CHARS) ?? cut(`${head}${rangesText(ranges.slice(0, 1))}`);
}

/** What the enable rule of an inserter or a drill is, as the short text for its chip and the whole text for its tooltip */
export function describeEnableRule(
    override: EnableControlOverride | undefined,
    options?: { forcedAlways?: boolean },
): EnableRuleDescription {
    const mode = override?.mode ?? EnableControlMode.AUTO;
    const quiet = mode === EnableControlMode.AUTO;
    const named = (name: string, summary = name): EnableRuleDescription => ({
        mode, quiet, chip: cut(`${ENABLE_CHIP_PREFIX}${name}`), summary,
    });
    switch (override?.mode) {
        case EnableControlMode.ALWAYS:
            return named(MODE_ALWAYS, options?.forcedAlways ? `${MODE_ALWAYS}${FORCED_ALWAYS_NOTE}` : MODE_ALWAYS);
        case EnableControlMode.NEVER:
            return named(MODE_NEVER);
        case EnableControlMode.CLOCKED: {
            if (override.ranges.length === 0) {
                const text = `${MODE_CLOCKED}${NO_RANGES}`;
                return { mode, quiet, chip: cut(text), summary: text };
            }
            const period = override.period_duration_ticks && override.period_duration_ticks > 0
                ? `${PERIOD_JOINER}${override.period_duration_ticks}`
                : '';
            return {
                mode,
                quiet,
                chip: clockedChip(override.ranges, period),
                summary: `${MODE_CLOCKED} ${rangesText(override.ranges)}${period}${TICKS_SUFFIX}`,
            };
        }
        case EnableControlMode.CONDITIONAL: {
            const text = `${MODE_CONDITIONAL}${RULE_COUNT_JOINER}${RULE_COUNT(countConditions(override.rule_set))}${override.latch ? LATCHED : ''}`;
            return { mode, quiet, chip: cut(text), summary: text };
        }
        default:
            return named(MODE_AUTO);
    }
}

/** "Clocked 0–7, Inserter 3. Edit rule": starts with the chip's text so the visible label is part of the name */
export function enableChipAriaLabel(entityLabel: string, description: EnableRuleDescription): string {
    return ARIA_LABEL(description.chip, entityLabel);
}

/** The whole rule in ticks ("Clocked 0–7 ticks"), or what Auto means for AUTO; the chip's accessible description */
export function enableChipTooltip(entityLabel: string, description: EnableRuleDescription): string {
    return description.quiet ? AUTO_TOOLTIP(entityLabel.replace(/ \d+$/, '').toLowerCase()) : description.summary;
}
