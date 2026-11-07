/**
 * What stops an enable rule from being saved, field by field, and the one thing worth a warning. Pure: the rule form
 * shows each problem under its field and refuses Save while there is one, so the saved rule never has a value the
 * player did not type.
 */
import { EnableControlMode, ValueReferenceType } from 'clock-generator/light';
import { isCondition } from '../components/ruleSetUtils';
import { windowFieldName } from './a11yLabels';
import type { RuleSet, ValueReference } from './configForm/formData';
import { repeatTicksOf, wholeTicksOf, type EnableControlDraft } from './enableControlDraft';
import type { RuleTiming } from './ruleTiming';

export interface RuleProblem {
    /** The DOM id of the field it belongs to, which Save moves the focus to */
    fieldId: string;
    /** The field's visible label and its place: "End tick, wake window 1" */
    field: string;
    text: string;
}

export const PROBLEM_TEXT = {
    enterTick: 'Enter a tick.',
    wholeTick: 'Enter a whole number, 0 or more.',
    endBeforeStart: (start: number) => `The end must not be before the start (${start}).`,
    // the config file holds a window's end as a number above 0, so a window can't end at tick 0
    endAtZero: "The end must be tick 1 or later: an enable window can't end at tick 0.",
    pastWindowCycle: (window_cycle_ticks: number) => `Past the end of the ${window_cycle_ticks}-tick window cycle: the last tick is ${window_cycle_ticks - 1}.`,
    repeat: 'Enter a whole number of ticks, 1 or more, or leave it empty.',
    pickItem: 'Pick an item.',
    drillConditional: "Mining drills can't use a Conditional rule. Pick another mode.",
    drillNeverIntoContainer: "A drill into a container can't be Never on: it would fill nothing. Pick another mode.",
} as const;

/** The non-blocking warning of a "Repeat every" that the clock period is not a whole number of */
const repeatWarning = (repeat: number, window_cycle_ticks: number) =>
    `${repeat} ticks doesn't fit a whole number of times into the ${window_cycle_ticks}-tick window cycle, so the clock can't follow this rule exactly.`;

/** The DOM id of one of the rule form's fields: the form's prefix, then its place ("start", 0) */
export function ruleFieldId(idPrefix: string, ...place: (string | number)[]): string {
    return [idPrefix, ...place].join('-');
}

/** The id of a condition's item picker: the condition's path ("rule.0.1") and its side */
export function itemFieldId(idPrefix: string, conditionPath: string, side: 'left' | 'right'): string {
    return ruleFieldId(idPrefix, conditionPath, side, 'item');
}

/** The id of a mode's radio button */
export function modeFieldId(idPrefix: string, mode: EnableControlMode): string {
    return ruleFieldId(idPrefix, 'mode', mode);
}

export const REPEAT_LABEL = 'Repeat every (ticks)';

/** "Can't save yet: 1 problem. End tick, wake window 1: The end must not be before the start (10)." */
export function blockedSummaryOf(problems: readonly RuleProblem[]): string {
    const count = `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`;
    return `Can't save yet: ${count}. ${problems[0].field}: ${problems[0].text}`;
}

interface ProblemContext {
    entityType: 'inserter' | 'drill';
    timing: RuleTiming;
    /** The prefix of the form's field ids */
    idPrefix: string;
    /** A drill that drops into a container (the config schema refuses Never on for it) */
    intoContainer?: boolean;
}

/**
 * The period the wake windows must fit in: "Repeat every" when it is valid, else the crafting cycle. None when neither
 * is known, or the cycle is not a whole number of ticks: the engine places a fractional period's ticks itself
 * (`clockPosition` in `enable-control.ts`), so no window can be said to be past its end
 */
export function ruleWindowCycleOf(draft: Pick<EnableControlDraft, 'windowCycleDuration'>, timing: RuleTiming): number | null {
    const repeat = repeatTicksOf(draft.windowCycleDuration);
    if (repeat !== null) return repeat;
    const cycle = timing.cycleTicks;
    return cycle !== null && Number.isInteger(cycle) ? cycle : null;
}

function tickProblem(text: string): string | null {
    if (text.trim() === '') return PROBLEM_TEXT.enterTick;
    return wholeTicksOf(text) === null ? PROBLEM_TEXT.wholeTick : null;
}

function needsItem(value: ValueReference): boolean {
    return (
        (value.type === ValueReferenceType.INVENTORY_ITEM || value.type === ValueReferenceType.AUTOMATED_INSERTION_LIMIT) &&
        !value.item_name
    );
}

/**
 * The name of a condition's item picker, from the condition's path: "Item, condition 2" for "rule.1", "Second item,
 * condition 2.1" for the right side of "rule.1.0", "Item, release condition 1" for "release.0"
 */
export function itemFieldName(conditionPath: string, side: 'left' | 'right'): string {
    const [root, ...indexes] = conditionPath.split('.');
    const number = indexes.map((index) => Number(index) + 1).join('.');
    const where = root === 'release' ? `release condition ${number}` : `condition ${number}`;
    return `${side === 'left' ? 'Item' : 'Second item'}, ${where}`;
}

/** Conditions depth first, left before right: an item picker left empty in each */
function itemProblems(ruleSet: RuleSet, path: string, idPrefix: string): RuleProblem[] {
    return ruleSet.rules.flatMap((rule, index) => {
        const childPath = `${path}.${index}`;
        if (!isCondition(rule)) return itemProblems(rule, childPath, idPrefix);
        return (['left', 'right'] as const)
            .filter((side) => needsItem(rule[side]))
            .map((side) => ({ fieldId: itemFieldId(idPrefix, childPath, side), field: itemFieldName(childPath, side), text: PROBLEM_TEXT.pickItem }));
    });
}

/** Every problem of the picked mode's fields, in reading order */
export function ruleProblemsOf(draft: EnableControlDraft, { entityType, timing, idPrefix, intoContainer = false }: ProblemContext): RuleProblem[] {
    const problems: RuleProblem[] = [];
    if (draft.mode === EnableControlMode.NEVER && entityType === 'drill' && intoContainer) {
        problems.push({ fieldId: modeFieldId(idPrefix, EnableControlMode.NEVER), field: 'Mode', text: PROBLEM_TEXT.drillNeverIntoContainer });
    }
    if (draft.mode === EnableControlMode.CLOCKED) {
        const window_cycle_ticks = ruleWindowCycleOf(draft, timing);
        draft.ranges.forEach((window, index) => {
            const n = index + 1;
            const add = (side: 'start' | 'end', text: string) =>
                problems.push({ fieldId: ruleFieldId(idPrefix, side, index), field: windowFieldName(side, n), text });
            const startProblem = tickProblem(window.start);
            const start = wholeTicksOf(window.start);
            if (startProblem) add('start', startProblem);
            else if (window_cycle_ticks !== null && start !== null && start > window_cycle_ticks - 1) add('start', PROBLEM_TEXT.pastWindowCycle(window_cycle_ticks));

            const endProblem = tickProblem(window.end);
            const end = wholeTicksOf(window.end);
            if (endProblem) add('end', endProblem);
            else if (end !== null && start !== null && end < start) add('end', PROBLEM_TEXT.endBeforeStart(start));
            else if (end === 0) add('end', PROBLEM_TEXT.endAtZero);
            else if (window_cycle_ticks !== null && end !== null && end > window_cycle_ticks - 1) add('end', PROBLEM_TEXT.pastWindowCycle(window_cycle_ticks));
        });
        if (draft.windowCycleDuration.trim() !== '' && repeatTicksOf(draft.windowCycleDuration) === null) {
            problems.push({ fieldId: ruleFieldId(idPrefix, 'repeat'), field: REPEAT_LABEL, text: PROBLEM_TEXT.repeat });
        }
    } else if (draft.mode === EnableControlMode.CONDITIONAL) {
        if (entityType === 'drill') {
            problems.push({ fieldId: modeFieldId(idPrefix, EnableControlMode.CONDITIONAL), field: 'Mode', text: PROBLEM_TEXT.drillConditional });
        }
        problems.push(...itemProblems(draft.ruleSet, 'rule', idPrefix));
        if (draft.latchEnabled && draft.releaseCondition) {
            problems.push(...itemProblems(draft.releaseCondition, 'release', idPrefix));
        }
    }
    return problems;
}

/** The warnings that do not stop Save: a "Repeat every" the clock period is not a whole number of */
export function ruleWarningsOf(draft: EnableControlDraft, timing: RuleTiming): string[] {
    if (draft.mode !== EnableControlMode.CLOCKED) return [];
    const repeat = repeatTicksOf(draft.windowCycleDuration);
    const window_cycle_ticks = timing.windowCycleTicks;
    if (repeat === null || window_cycle_ticks === null || !Number.isInteger(window_cycle_ticks) || window_cycle_ticks % repeat === 0) return [];
    return [repeatWarning(repeat, window_cycle_ticks)];
}
