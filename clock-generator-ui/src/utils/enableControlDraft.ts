import { EnableControlMode } from 'clock-generator/light';
import { createDefaultRuleSet } from '../components/ruleSetUtils';
import type { EnableControlOverride, EnableControlRange, RuleSet } from './configForm/formData';

/**
 * The rule form's state: every mode's fields, kept while another mode is picked so that switching back loses nothing.
 * Only the picked mode's fields reach the rule it saves.
 */
interface EnableControlDraft {
    mode: EnableControlMode;
    ranges: EnableControlRange[];
    /** As typed; only a whole number above 0 is saved */
    periodDuration: string;
    ruleSet: RuleSet;
    latchEnabled: boolean;
    releaseCondition: RuleSet | undefined;
}

/** The rule form's state for a stored rule, or for none (AUTO) */
export function enableControlDraftOf(current?: EnableControlOverride): EnableControlDraft {
    const clocked = current?.mode === EnableControlMode.CLOCKED ? current : undefined;
    const conditional = current?.mode === EnableControlMode.CONDITIONAL ? current : undefined;
    return {
        mode: current?.mode ?? EnableControlMode.AUTO,
        ranges: clocked?.ranges ?? [{ start: 0, end: 100 }],
        periodDuration: clocked?.period_duration_ticks?.toString() ?? '',
        ruleSet: conditional?.rule_set ?? createDefaultRuleSet(),
        latchEnabled: !!conditional?.latch,
        releaseCondition: conditional?.latch?.release,
    };
}

/**
 * The rule the form saves: none for AUTO; for CLOCKED the ranges that end after they start, and the period only when it
 * is above 0; for CONDITIONAL the rule set, with a latch only when it is on and has a release condition
 */
export function buildEnableControlOverride(draft: EnableControlDraft): EnableControlOverride | undefined {
    switch (draft.mode) {
        case EnableControlMode.AUTO:
            return undefined;
        case EnableControlMode.CLOCKED: {
            const override: EnableControlOverride = {
                mode: EnableControlMode.CLOCKED,
                ranges: draft.ranges.filter((r) => r.end > r.start),
            };
            const period = parseInt(draft.periodDuration);
            if (period > 0) {
                override.period_duration_ticks = period;
            }
            return override;
        }
        case EnableControlMode.CONDITIONAL:
            return {
                mode: EnableControlMode.CONDITIONAL,
                rule_set: draft.ruleSet,
                ...(draft.latchEnabled && draft.releaseCondition && { latch: { release: draft.releaseCondition } }),
            };
        default:
            return { mode: draft.mode };
    }
}

/**
 * Whether the form would save something other than what it was opened with. Both are built into the rule they save,
 * so a field the save leaves out (a range while ALWAYS is picked, an inverted range) does not count.
 */
export function enableControlDraftChanged(draft: EnableControlDraft, initial: EnableControlDraft): boolean {
    return JSON.stringify(buildEnableControlOverride(draft)) !== JSON.stringify(buildEnableControlOverride(initial));
}
