import { EnableControlMode } from 'clock-generator/light';
import { createDefaultRuleSet } from '../components/ruleSetUtils';
import type { EnableControlOverride, EnableControlRange, RuleSet } from './configForm/formData';

/** A wake window's two fields, as typed */
export interface DraftWindow {
    start: string;
    end: string;
}

/**
 * The rule form's state: every mode's fields, kept while another mode is picked so that switching back loses nothing.
 * Only the picked mode's fields reach the rule it saves.
 */
export interface EnableControlDraft {
    mode: EnableControlMode;
    /** As typed; only a window whose two fields are whole ticks, ending at or after its start, is saved */
    ranges: DraftWindow[];
    /** As typed; only a whole number above 0 is saved */
    periodDuration: string;
    ruleSet: RuleSet;
    latchEnabled: boolean;
    releaseCondition: RuleSet | undefined;
}

/** The clock's wake windows for the entity and its period, which a Clocked rule starts from when it has none */
interface PlannedWindows {
    ranges: EnableControlRange[];
    periodTicks: number;
}

export const draftWindowsOf = (ranges: readonly EnableControlRange[]): DraftWindow[] =>
    ranges.map((range) => ({ start: `${range.start}`, end: `${range.end}` }));

/** One wake window with nothing typed in it */
export const EMPTY_WINDOW: DraftWindow = { start: '', end: '' };

/**
 * The rule form's state for a stored rule, or for none (AUTO). A stored Clocked rule keeps its windows; any other starts
 * its Clocked fields from the clock's windows when there are some, else from one empty window.
 */
export function enableControlDraftOf(current?: EnableControlOverride, planned?: PlannedWindows | null): EnableControlDraft {
    const clocked = current?.mode === EnableControlMode.CLOCKED ? current : undefined;
    const conditional = current?.mode === EnableControlMode.CONDITIONAL ? current : undefined;
    const fromPlan = !clocked && planned ? planned : undefined;
    return {
        mode: current?.mode ?? EnableControlMode.AUTO,
        ranges: clocked ? draftWindowsOf(clocked.ranges) : fromPlan ? draftWindowsOf(fromPlan.ranges) : [{ ...EMPTY_WINDOW }],
        periodDuration: clocked?.period_duration_ticks?.toString() ?? (fromPlan ? `${fromPlan.periodTicks}` : ''),
        ruleSet: conditional?.rule_set ?? createDefaultRuleSet(),
        latchEnabled: !!conditional?.latch,
        releaseCondition: conditional?.latch?.release,
    };
}

/** A whole number of 0 or more, as typed (spaces around it allowed); null for anything else */
export function wholeTicksOf(text: string): number | null {
    const trimmed = text.trim();
    return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** "Repeat every" as a number of ticks: a whole number of 1 or more, else null */
export function repeatTicksOf(text: string): number | null {
    const ticks = wholeTicksOf(text);
    return ticks !== null && ticks >= 1 ? ticks : null;
}

/**
 * The rule the form saves: none for AUTO; for CLOCKED the windows whose ticks are whole numbers that end at or after
 * they start (a window of one tick is kept), and the period only when it is a whole number above 0; for CONDITIONAL the
 * rule set, with a latch only when it is on and has a release condition. It never makes a value up: what it leaves out
 * is a problem the form shows (`ruleProblems.ts`), and the form does not save while there is one.
 */
export function buildEnableControlOverride(draft: EnableControlDraft): EnableControlOverride | undefined {
    switch (draft.mode) {
        case EnableControlMode.AUTO:
            return undefined;
        case EnableControlMode.CLOCKED: {
            const ranges: EnableControlRange[] = [];
            for (const window of draft.ranges) {
                const start = wholeTicksOf(window.start);
                const end = wholeTicksOf(window.end);
                if (start !== null && end !== null && end >= start) ranges.push({ start, end });
            }
            const override: EnableControlOverride = { mode: EnableControlMode.CLOCKED, ranges };
            const period = repeatTicksOf(draft.periodDuration);
            if (period !== null) {
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
 * Whether the form holds something other than what it was opened with. Both are built into the rule they save, so a
 * field the save leaves out while another mode is picked (a range while ALWAYS is) does not count. While Clocked is
 * picked the windows and "Repeat every" count as typed, so a half-typed window, which the save would leave out, is
 * still a change that Esc asks about.
 */
export function enableControlDraftChanged(draft: EnableControlDraft, initial: EnableControlDraft): boolean {
    if (JSON.stringify(buildEnableControlOverride(draft)) !== JSON.stringify(buildEnableControlOverride(initial))) return true;
    return (
        draft.mode === EnableControlMode.CLOCKED &&
        (JSON.stringify(draft.ranges) !== JSON.stringify(initial.ranges) || draft.periodDuration !== initial.periodDuration)
    );
}

/**
 * Whether saving `override` (from Save, or none from Clear Override) would change the stored rule `current`, as the
 * form built it when it opened. A Save that changes nothing is a Cancel, so it does not make a forced ALWAYS the
 * player's own.
 */
export function enableControlOverrideChanged(
    override: EnableControlOverride | undefined,
    current: EnableControlOverride | undefined,
): boolean {
    return JSON.stringify(override) !== JSON.stringify(buildEnableControlOverride(enableControlDraftOf(current)));
}
