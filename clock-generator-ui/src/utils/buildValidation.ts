import type { InserterCoverageIssue } from 'clock-generator/browser';
import type { ChestFormData, InserterFormData } from './configForm/formData';
import { coverageIssueElementId, focusIdOf, type FocusTarget, type Problem } from './firstProblem';
import { coverageHandledByChestIssue, outputChestIssueTitle, type OutputChestIssue } from './outputChestIssues';

/** Structured check failures retain their identity when they cross the worker boundary. */
export type ValidationDiagnostic =
    | { kind: 'coverage'; issue: InserterCoverageIssue }
    | { kind: 'field'; path: (string | number)[]; message: string };

export interface BuildValidationIssue extends Problem {
    id: string;
    severity: 'error' | 'warning';
    blocksGeneration: boolean;
    /** 'calibration': the engine's warning that a belt pickup's timing is not tested, shown as plain text */
    source: 'field' | 'coverage' | 'chest' | 'engine' | 'calibration';
    fieldTarget?: FocusTarget;
    coverage?: InserterCoverageIssue;
    chest?: OutputChestIssue;
}

export const validationIssueElementId = (id: string) => `validation-issue-${id}`;
export const validationCountLabel = (count: number) => `${count} validation ${count === 1 ? 'error' : 'errors'}`;

export function chestValidationIssue(chest: OutputChestIssue): BuildValidationIssue {
    const id = `chest:${chest.chest.id}:${chest.kind}`;
    const blocking = chest.kind === 'removal-disabled';
    return { id, source: 'chest', text: outputChestIssueTitle(chest), severity: blocking ? 'error' : 'warning',
        blocksGeneration: blocking, target: { kind: 'validation-issue', id }, chest };
}

interface Input {
    fieldProblems: Problem[];
    coverage: InserterCoverageIssue[];
    chests: ChestFormData[];
    inserters: InserterFormData[];
    machines: { id: number }[];
    chestIssues: OutputChestIssue[];
    coverageText: (issue: InserterCoverageIssue) => string;
    /** The live refusal of an inserter that is out of scope, shown in place of its coverage */
    scopeRefusal?: string | null;
    /** The live warning for belt pickups outside 16-item hands on 4-item belt stacks: advice, never blocking */
    pickupNotTested?: string | null;
    failure?: { message: string; diagnostics?: ValidationDiagnostic[] };
}

/** One issue per cause, shared by the panel, navigation and blocking error count. */
export function buildValidationIssues(input: Input): BuildValidationIssue[] {
    const found = new Map<string, BuildValidationIssue>();
    const add = (issue: BuildValidationIssue) => { if (!found.has(issue.id)) found.set(issue.id, issue); };
    const field = (id: string, text: string, fieldTarget?: FocusTarget): BuildValidationIssue => ({
        id, text, severity: 'error', blocksGeneration: true, source: 'field', fieldTarget,
        target: { kind: 'validation-issue', id },
    });
    for (const problem of input.fieldProblems) {
        if (problem.target) add(field(focusIdOf(problem.target), problem.text, problem.target));
    }
    input.chestIssues.forEach(issue => add(chestValidationIssue(issue)));
    const addCoverage = (issue: InserterCoverageIssue) => {
        if (coverageHandledByChestIssue(issue, input.chestIssues, input.inserters)) return;
        const id = coverageIssueElementId(issue);
        add({ id, text: input.coverageText(issue), source: 'coverage', coverage: issue, severity: 'error', blocksGeneration: true,
            target: { kind: 'validation-issue', id } });
    };
    if (input.scopeRefusal) {
        add({ id: 'inserter-scope', text: input.scopeRefusal, severity: 'error', blocksGeneration: true, source: 'engine',
            target: { kind: 'validation-issue', id: 'inserter-scope' } });
    }
    input.coverage.forEach(addCoverage);
    for (const diagnostic of input.failure?.diagnostics ?? []) {
        if (diagnostic.kind === 'coverage') { addCoverage(diagnostic.issue); continue; }
        const [group, index, key] = diagnostic.path;
        let fieldTarget: FocusTarget | undefined;
        if (group === 'target_output') {
            if (index === 'recipe') fieldTarget = { kind: 'target-recipe' };
            if (index === 'items_per_second') fieldTarget = { kind: 'target-rate' };
            if (index === 'copies') fieldTarget = { kind: 'target-copies' };
        }
        if (group === 'machines' && typeof index === 'number' && key === 'recipe' && input.machines[index])
            fieldTarget = { kind: 'machine-recipe', machineId: input.machines[index].id };
        if (group === 'machines' && diagnostic.path.length === 1 && !input.machines.length) fieldTarget = { kind: 'add-machine' };
        const chest = group === 'chests' && typeof index === 'number' ? input.chests[index] : undefined;
        if (chest && key === 'item_filter' && input.chestIssues.some(issue => issue.chest.id === chest.id && issue.kind === 'removal-disabled')) continue;
        const stablePath = diagnostic.path.map((part, position) => position === 1 && typeof part === 'number'
            ? group === 'chests' ? input.chests[part]?.id ?? part : group === 'machines' ? input.machines[part]?.id ?? part : part : part);
        const location = stablePath.length ? stablePath.join('.').replaceAll('_', ' ') : 'Build';
        add(field(fieldTarget ? focusIdOf(fieldTarget) : `field:${stablePath.join('.')}`, `${location}: ${diagnostic.message}`, fieldTarget));
    }
    // a Check that stopped at the refusal shown live says the same: one issue per cause
    if (input.failure && !input.failure.diagnostics?.length && input.failure.message !== input.scopeRefusal) {
        const id = 'engine-check';
        add({ id, text: input.failure.message, severity: 'error', blocksGeneration: true, source: 'engine',
            target: { kind: 'validation-issue', id } });
    }
    if (input.pickupNotTested) {
        const id = 'belt-pickup-not-tested';
        add({ id, text: input.pickupNotTested, severity: 'warning', blocksGeneration: false, source: 'calibration',
            target: { kind: 'validation-issue', id } });
    }
    return [...found.values()];
}
