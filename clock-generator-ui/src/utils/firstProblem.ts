import { COPIES_POSITIVE_PROBLEM, copiesProblem } from './copiesProblem';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import type { CheckStatus } from './checkThenGenerate';
import { entityLabel } from './entityLabel';
import { outputChestIssueElementId } from './outputChestIssues';
import { isTargetAboveMax, maxRateText, totalMachineCapacity, type MachinesMax } from './targetRateLimit';
import { countsOf, type TargetCounts } from './targetCounts';

/** The game name of an item id */
type LabelOf = (id: string) => string;
const identity: LabelOf = (id) => id;

/**
 * Every sentence that says what stops the build being clocked, and so where Generate goes. The tooltips, the note in the
 * workflow bar and the problem chip all read from here, so the words are changed in one place.
 */
export const PROBLEM_TEXT = {
    noRecipe: 'Set the recipe in Target Output',
    noRate: 'Set Items per Second in Target Output to more than 0',
    noCopies: COPIES_POSITIVE_PROBLEM,
    noMachines: 'Add a machine',
    rateAboveMax: (total: number, counts: TargetCounts = 'made') =>
        `Items per Second is more than the machines can ${counts === 'destroyed' ? 'destroy' : 'make'} (at most ${maxRateText(total)})`,
    machineWithoutRecipe: (machineId: number) => `Set the recipe of ${entityLabel('machine', machineId)}`,
    missingInput: (machineId: number, item: string, itemLabel: LabelOf = identity) =>
        `${entityLabel('machine', machineId)} has no source of ${itemLabel(item)}`,
    missingOutput: (machineId: number, item: string, itemLabel: LabelOf = identity) =>
        `${entityLabel('machine', machineId)} has no inserter taking ${itemLabel(item)} out`,
    validationFailed: 'The last check failed. Show why',
    /** On a build with nothing entered yet, before a manual route has been chosen */
    routes: 'Start with Paste from Factorio, try an example, or build by hand.',
    /** After choosing to build by hand: its next step, said neutrally rather than as problems */
    start: 'Start: pick the recipe you want to make',
} as const;

/** The ids of the elements a problem moves the keyboard focus to; the forms set them from here */
export const ELEMENT_IDS = {
    targetRecipe: 'target-recipe',
    targetRate: 'target-items-per-second',
    targetCopies: 'target-copies',
    targetCopyOffset: 'target-copy-offset',
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
    | { kind: 'add-inserter' }
    | { kind: 'machine-recipe'; machineId: number }
    | { kind: 'machine-result-target'; machineId: number }
    | { kind: 'coverage-issue'; issue: CoverageIssueKey }
    | { kind: 'output-chest'; chestId: number }
    | { kind: 'validation-panel' }
    | { kind: 'validation-issue'; id: string }
    | { kind: 'validation-error' };

/** Something that keeps the build from being clocked, or the reason the last check failed; and where to go for it */
export interface Problem {
    text: string;
    /** Null for a next step that has nowhere to go */
    target: FocusTarget | null;
}

interface ProblemsInput {
    targetOutput: { recipe: string; items_per_second: number; copies: number; counts?: TargetCounts };
    machines: { id: number; recipe: string }[];
    /** The most the machines making (or, for a target that counts the item destroyed, destroying) the target item can make; null or left out while it is not known */
    machinesMax?: MachinesMax | null;
}

/**
 * Field problems in the order they are best fixed: the target, the machines, a target more than the machines can
 * make (which their recipes change). Coverage is collected separately by buildValidationIssues.
 * Empty when these field checks pass.
 */
export function problemsOf({ targetOutput, machines, machinesMax = null }: ProblemsInput): Problem[] {
    const problems: Problem[] = [];
    if (!targetOutput.recipe) {
        problems.push({ text: PROBLEM_TEXT.noRecipe, target: { kind: 'target-recipe' } });
    }
    if (!(targetOutput.items_per_second > 0)) {
        problems.push({ text: PROBLEM_TEXT.noRate, target: { kind: 'target-rate' } });
    }
    const copiesIssue = copiesProblem(targetOutput.copies);
    if (copiesIssue) {
        problems.push({ text: copiesIssue, target: { kind: 'target-copies' } });
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
    const capacity = machinesMax ? totalMachineCapacity(machinesMax, targetOutput.copies) : null;
    if (capacity !== null && targetOutput.recipe && isTargetAboveMax(targetOutput.items_per_second, targetOutput.copies, machinesMax)) {
        problems.push({
            text: PROBLEM_TEXT.rateAboveMax(capacity, countsOf(targetOutput)),
            target: { kind: 'target-rate' },
        });
    }
    return problems;
}

/**
 * The one note in the workflow bar, which says where Generate and Check only go: the first problem, else the reason the
 * last check failed. Null while something runs (the buttons then say what it is) or when there is nothing to say. On a
 * `blank` build (nothing entered yet) the note describes the routes, or where to start after choosing to build by hand.
 */
export function barNoteOf({ problems, busy, checkStatus, blank = false, entryRoute = 'routes' }: {
    problems: Problem[];
    busy: boolean;
    checkStatus: CheckStatus;
    blank?: boolean;
    entryRoute?: 'routes' | 'manual';
}): Problem | null {
    if (busy) {
        return null;
    }
    if (blank && problems.length > 0) {
        return entryRoute === 'manual'
            ? { text: PROBLEM_TEXT.start, target: { kind: 'target-recipe' } }
            : { text: PROBLEM_TEXT.routes, target: null };
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
        case 'add-inserter':
            return 'add-inserter';
        case 'machine-recipe':
            return machineRecipeElementId(target.machineId);
        case 'machine-result-target':
            return `machine-result-target-${target.machineId}`;
        case 'coverage-issue':
            return coverageIssueElementId(target.issue);
        case 'output-chest':
            return outputChestIssueElementId(target.chestId);
        case 'validation-panel':
            return 'build-validation';
        case 'validation-issue':
            return `validation-issue-${target.id}`;
        case 'validation-error':
            return ELEMENT_IDS.validationError;
    }
}

/** The machines' fields are edited in the List only; the diagram edits them in a dialog */
export function needsListView(target: FocusTarget): boolean {
    return target.kind === 'add-machine' || target.kind === 'add-inserter' || target.kind === 'machine-recipe' || target.kind === 'machine-result-target';
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
