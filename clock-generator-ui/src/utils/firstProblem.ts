import type { InserterCoverageIssue } from 'clock-generator/browser';
import type { CheckStatus } from './checkThenGenerate';
import { entityLabel } from './entityLabel';
import { isTargetAboveMax, maxRateText, type MachinesMax } from './targetRateLimit';

/**
 * Every sentence that says what stops the build being clocked, and so where Generate goes. The tooltips, the note in the
 * workflow bar and the problem chip all read from here, so the words are changed in one place.
 */
export const PROBLEM_TEXT = {
    noRecipe: 'Set the recipe in Target Output',
    noRate: 'Set Items per Second in Target Output to more than 0',
    noCopies: 'Set Copies in Target Output to 1 or more',
    noMachines: 'Add a machine',
    rateAboveMax: (total: number) => `Items per Second is more than the machines can make (at most ${maxRateText(total)})`,
    machineWithoutRecipe: (machineId: number) => `Set the recipe of ${entityLabel('machine', machineId)}`,
    missingInput: (machineId: number, item: string) => `${entityLabel('machine', machineId)} has no inserter bringing in ${item}`,
    missingOutput: (machineId: number, item: string) => `${entityLabel('machine', machineId)} has no inserter taking ${item} out`,
    validationFailed: 'The last check failed. Show why',
    /** On a build with nothing entered yet: its next step, said neutrally rather than as problems */
    start: 'Start: pick the recipe you want to make',
} as const;

/** The ids of the elements a problem moves the keyboard focus to; the forms set them from here */
export const ELEMENT_IDS = {
    targetRecipe: 'target-recipe',
    targetRate: 'target-items-per-second',
    targetCopies: 'target-copies',
    addMachine: 'add-machine',
    /** The alert at the top of Configure with the reason the last check failed */
    validationError: 'validation-error',
    /** The note in the workflow bar, which describes Generate and Check only */
    blockReason: 'workflow-block-reason',
} as const;

export function machineRecipeElementId(machineId: number): string {
    return `machine-recipe-${machineId}`;
}

/** What tells one coverage issue from another */
type CoverageIssueKey = Pick<InserterCoverageIssue, 'kind' | 'machine_id' | 'item_name'>;

/** The row of a coverage issue in the missing-inserter alert */
export function coverageIssueElementId(issue: CoverageIssueKey): string {
    return `coverage-issue-${issue.kind}-${issue.machine_id}-${issue.item_name}`;
}

/** Where a problem is fixed, or where the reason for a failed check is */
export type FocusTarget =
    | { kind: 'target-recipe' }
    | { kind: 'target-rate' }
    | { kind: 'target-copies' }
    | { kind: 'add-machine' }
    | { kind: 'machine-recipe'; machineId: number }
    | { kind: 'coverage-issue'; issue: CoverageIssueKey }
    | { kind: 'validation-error' };

/** Something that keeps the build from being clocked, or the reason the last check failed; and where to go for it */
export interface Problem {
    text: string;
    /** Null for a next step that has nowhere to go */
    target: FocusTarget | null;
}

interface ProblemsInput {
    targetOutput: { recipe: string; items_per_second: number; copies: number };
    machines: { id: number; recipe: string }[];
    coverageIssues: CoverageIssueKey[];
    /** The most the machines making the target recipe can make; null or left out while it is not known */
    machinesMax?: MachinesMax | null;
}

/**
 * What keeps the build from being generated, in the order it is best fixed: the target, the machines, a target more
 * than the machines can make (which their recipes change), then the inserters the engine found missing, in its order.
 * Empty when the build can be generated.
 */
export function problemsOf({ targetOutput, machines, coverageIssues, machinesMax = null }: ProblemsInput): Problem[] {
    const problems: Problem[] = [];
    if (!targetOutput.recipe) {
        problems.push({ text: PROBLEM_TEXT.noRecipe, target: { kind: 'target-recipe' } });
    }
    if (!(targetOutput.items_per_second > 0)) {
        problems.push({ text: PROBLEM_TEXT.noRate, target: { kind: 'target-rate' } });
    }
    if (!(targetOutput.copies > 0)) {
        problems.push({ text: PROBLEM_TEXT.noCopies, target: { kind: 'target-copies' } });
    }
    if (machines.length === 0) {
        problems.push({ text: PROBLEM_TEXT.noMachines, target: { kind: 'add-machine' } });
    }
    for (const machine of machines) {
        if (!machine.recipe) {
            problems.push({
                text: PROBLEM_TEXT.machineWithoutRecipe(machine.id),
                target: { kind: 'machine-recipe', machineId: machine.id },
            });
        }
    }
    // the engine's check refuses such a target too; said here, the player is sent to the field instead of a failed check
    if (machinesMax && targetOutput.recipe && isTargetAboveMax(targetOutput.items_per_second, targetOutput.copies, machinesMax)) {
        problems.push({
            text: PROBLEM_TEXT.rateAboveMax(machinesMax.perCopy * targetOutput.copies),
            target: { kind: 'target-rate' },
        });
    }
    for (const { kind, machine_id, item_name } of coverageIssues) {
        problems.push({
            text: kind === 'missing_input_inserter'
                ? PROBLEM_TEXT.missingInput(machine_id, item_name)
                : PROBLEM_TEXT.missingOutput(machine_id, item_name),
            target: { kind: 'coverage-issue', issue: { kind, machine_id, item_name } },
        });
    }
    return problems;
}

/** The problem to fix first, or null when there is none */
export function firstProblemOf(input: ProblemsInput): Problem | null {
    return problemsOf(input)[0] ?? null;
}

/**
 * The one note in the workflow bar, which says where Generate and Check only go: the first problem, else the reason the
 * last check failed. Null while something runs (the buttons then say what it is) or when there is nothing to say. On a
 * `blank` build (nothing entered yet) the problems are only the next step: the note says where to start.
 */
export function barNoteOf({ problems, busy, checkStatus, blank = false }: {
    problems: Problem[];
    busy: boolean;
    checkStatus: CheckStatus;
    blank?: boolean;
}): Problem | null {
    if (busy) {
        return null;
    }
    if (blank && problems.length > 0) {
        return { text: PROBLEM_TEXT.start, target: { kind: 'target-recipe' } };
    }
    if (problems.length > 0) {
        return problems[0];
    }
    if (checkStatus === 'invalid') {
        return { text: PROBLEM_TEXT.validationFailed, target: { kind: 'validation-error' } };
    }
    return null;
}

/** "1 problem", "3 problems" */
export function problemCountLabel(count: number): string {
    return count === 1 ? '1 problem' : `${count} problems`;
}

/** The id of the element a target moves the keyboard focus to */
export function focusIdOf(target: FocusTarget): string {
    switch (target.kind) {
        case 'target-recipe':
            return ELEMENT_IDS.targetRecipe;
        case 'target-rate':
            return ELEMENT_IDS.targetRate;
        case 'target-copies':
            return ELEMENT_IDS.targetCopies;
        case 'add-machine':
            return ELEMENT_IDS.addMachine;
        case 'machine-recipe':
            return machineRecipeElementId(target.machineId);
        case 'coverage-issue':
            return coverageIssueElementId(target.issue);
        case 'validation-error':
            return ELEMENT_IDS.validationError;
    }
}

/** The machines' fields are edited in the List only; the diagram edits them in a dialog */
export function needsListView(target: FocusTarget): boolean {
    return target.kind === 'add-machine' || target.kind === 'machine-recipe';
}

/**
 * Moves the keyboard focus to where a problem is fixed and brings it into view, centred so the sticky header does not
 * cover it at any width. False when the element is not on the page (a machine deleted since, say).
 */
export function focusProblemTarget(target: FocusTarget): boolean {
    const element = document.getElementById(focusIdOf(target));
    if (!element) {
        return false;
    }
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' });
    return true;
}

/**
 * Moves the keyboard focus to the note in the workflow bar, without scrolling: the bar is sticky, so it is in view
 * already. False when there is no note.
 */
export function focusBarNote(): boolean {
    const element = document.getElementById(ELEMENT_IDS.blockReason);
    if (!element) {
        return false;
    }
    element.focus({ preventScroll: true });
    return true;
}
