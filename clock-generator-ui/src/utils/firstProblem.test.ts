import type { InserterCoverageIssue } from 'clock-generator/browser';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './configForm/formData';
import { updateTargetOutput } from './configForm/edits';
import {
    ELEMENT_IDS,
    PROBLEM_TEXT,
    barNoteOf,
    coverageIssueElementId,
    firstProblemOf,
    focusIdOf,
    machineRecipeElementId,
    needsListView,
    problemCountLabel,
    problemsOf,
    type FocusTarget,
    type Problem,
} from './firstProblem';

type Machine = { id: number; recipe: string };
type Input = Parameters<typeof problemsOf>[0];

const filledIn = (overrides: Partial<Input> = {}): Input => ({
    targetOutput: { recipe: 'logistic-science-pack', items_per_second: 240, copies: 1 },
    machines: [{ id: 1, recipe: 'logistic-science-pack' }],
    coverageIssues: [],
    ...overrides,
});

const issue = (kind: InserterCoverageIssue['kind'], machine_id: number, item_name: string): InserterCoverageIssue => ({
    kind,
    machine_id,
    recipe: 'some-recipe',
    item_name,
    fix_options: [],
});

describe('problemsOf', () => {
    it('finds nothing in a filled-in build with every inserter in place', () => {
        expect(problemsOf(filledIn())).toEqual([]);
        expect(firstProblemOf(filledIn())).toBeNull();
    });

    it('finds two problems in the default build: the target recipe, then the machine recipe', () => {
        const config = createDefaultConfig();
        const problems = problemsOf({ targetOutput: config.target_output, machines: config.machines, coverageIssues: [] });
        expect(problems.map((p) => p.text)).toEqual(['Set the recipe in Target Output', 'Set the recipe of Machine 1']);
        expect(problems.map((p) => p.target)).toEqual([{ kind: 'target-recipe' }, { kind: 'machine-recipe', machineId: 1 }]);
    });

    it('fixing the target recipe of the default build leaves the machine recipe first', () => {
        const config = updateTargetOutput(createDefaultConfig(), 'recipe', 'logistic-science-pack');
        const first = firstProblemOf({ targetOutput: config.target_output, machines: config.machines, coverageIssues: [] });
        expect(first).toEqual({ text: 'Set the recipe of Machine 1', target: { kind: 'machine-recipe', machineId: 1 } });
    });

    it('says what each failing condition is, alone, and where it is fixed', () => {
        const cases: [Input, Problem][] = [
            [filledIn({ targetOutput: { recipe: '', items_per_second: 240, copies: 1 } }), { text: PROBLEM_TEXT.noRecipe, target: { kind: 'target-recipe' } }],
            [filledIn({ targetOutput: { recipe: 'x', items_per_second: 0, copies: 1 } }), { text: PROBLEM_TEXT.noRate, target: { kind: 'target-rate' } }],
            [filledIn({ targetOutput: { recipe: 'x', items_per_second: -3, copies: 1 } }), { text: PROBLEM_TEXT.noRate, target: { kind: 'target-rate' } }],
            [filledIn({ targetOutput: { recipe: 'x', items_per_second: 240, copies: 0 } }), { text: PROBLEM_TEXT.noCopies, target: { kind: 'target-copies' } }],
            [filledIn({ machines: [] }), { text: 'Add a machine', target: { kind: 'add-machine' } }],
        ];
        for (const [input, expected] of cases) {
            expect(problemsOf(input)).toEqual([expected]);
        }
        expect(PROBLEM_TEXT.noRate).toBe('Set Items per Second in Target Output to more than 0');
        expect(PROBLEM_TEXT.noCopies).toBe('Set Copies in Target Output to 1 or more');
    });

    it('names each machine without a recipe, in machine order', () => {
        const second = problemsOf(filledIn({ machines: [{ id: 1, recipe: 'a' }, { id: 2, recipe: '' }] }));
        expect(second).toEqual([{ text: 'Set the recipe of Machine 2', target: { kind: 'machine-recipe', machineId: 2 } }]);
        const both = problemsOf(filledIn({ machines: [{ id: 1, recipe: '' }, { id: 2, recipe: '' }] }));
        expect(both.map((p) => p.text)).toEqual(['Set the recipe of Machine 1', 'Set the recipe of Machine 2']);
    });

    it('says which inserter is missing, in the words of the plan', () => {
        const [output] = problemsOf(filledIn({ coverageIssues: [issue('missing_output_inserter', 1, 'logistic-science-pack')] }));
        expect(output.text).toBe('Machine 1 has no inserter taking logistic-science-pack out');
        const [input] = problemsOf(filledIn({ coverageIssues: [issue('missing_input_inserter', 2, 'iron-plate')] }));
        expect(input.text).toBe('Machine 2 has no inserter bringing in iron-plate');
        expect(input.target).toEqual({ kind: 'coverage-issue', issue: { kind: 'missing_input_inserter', machine_id: 2, item_name: 'iron-plate' } });
        const three = problemsOf(filledIn({
            coverageIssues: [issue('missing_input_inserter', 1, 'a'), issue('missing_input_inserter', 1, 'b'), issue('missing_output_inserter', 1, 'c')],
        }));
        expect(three).toHaveLength(3);
    });

    it('puts the target first, then the machines, then the coverage issues in the engine\'s order', () => {
        const problems = problemsOf({
            targetOutput: { recipe: '', items_per_second: 0, copies: 1 },
            machines: [{ id: 1, recipe: 'a' }, { id: 2, recipe: '' }],
            coverageIssues: [issue('missing_output_inserter', 1, 'z'), issue('missing_input_inserter', 1, 'a')],
        });
        expect(problems.map((p) => p.target?.kind)).toEqual(['target-recipe', 'target-rate', 'machine-recipe', 'coverage-issue', 'coverage-issue']);
        expect(problems.slice(3).map((p) => p.text)).toEqual([
            'Machine 1 has no inserter taking z out',
            'Machine 1 has no inserter bringing in a',
        ]);
    });

    it('agrees with the conditions Generate used to check, one by one', () => {
        // the chain canGenerate was before it read problemsOf, for an initialized page with no generation running
        const oldCanGenerate = (input: Input, checked: InserterCoverageIssue[] | null) => Boolean(
            input.targetOutput.recipe &&
            input.targetOutput.items_per_second > 0 &&
            input.targetOutput.copies > 0 &&
            input.machines.length > 0 &&
            input.machines.every((m: Machine) => m.recipe) &&
            checked?.length === 0
        );
        const oneIssue = [issue('missing_input_inserter', 1, 'iron-plate')];
        const builds: [Input, InserterCoverageIssue[]][] = [
            [filledIn({ targetOutput: { recipe: '', items_per_second: 240, copies: 1 } }), []],
            [filledIn({ targetOutput: { recipe: 'x', items_per_second: 0, copies: 1 } }), []],
            [filledIn({ targetOutput: { recipe: 'x', items_per_second: 240, copies: 0 } }), []],
            [filledIn({ machines: [] }), []],
            [filledIn({ machines: [{ id: 1, recipe: 'x' }, { id: 2, recipe: '' }] }), []],
            [filledIn(), oneIssue],
            [filledIn(), []],
        ];
        for (const [input, checked] of builds) {
            const hasNoProblems = problemsOf({ ...input, coverageIssues: checked }).length === 0;
            expect(hasNoProblems).toBe(oldCanGenerate(input, checked));
        }
    });
});

describe('barNoteOf', () => {
    const recipeProblem: Problem = { text: PROBLEM_TEXT.noRecipe, target: { kind: 'target-recipe' } };
    const rateProblem: Problem = { text: PROBLEM_TEXT.noRate, target: { kind: 'target-rate' } };
    const failed: Problem = { text: PROBLEM_TEXT.validationFailed, target: { kind: 'validation-error' } };

    it('says nothing while something runs, whatever else is wrong', () => {
        expect(barNoteOf({ problems: [recipeProblem], busy: true, checkStatus: 'invalid' })).toBeNull();
        expect(barNoteOf({ problems: [], busy: true, checkStatus: 'invalid' })).toBeNull();
    });

    it('gives the first problem with its target, ahead of a failed check', () => {
        expect(barNoteOf({ problems: [recipeProblem, rateProblem], busy: false, checkStatus: 'none' })).toEqual(recipeProblem);
        expect(barNoteOf({ problems: [rateProblem], busy: false, checkStatus: 'invalid' })).toEqual(rateProblem);
    });

    it('points at the reason for a failed check when the build has no problem', () => {
        expect(barNoteOf({ problems: [], busy: false, checkStatus: 'invalid' })).toEqual(failed);
        expect(PROBLEM_TEXT.validationFailed).toBe('The last check failed. Show why');
    });

    it('says nothing for any other check status', () => {
        for (const checkStatus of ['none', 'valid', 'out-of-date', 'running'] as const) {
            expect(barNoteOf({ problems: [], busy: false, checkStatus })).toBeNull();
        }
    });
});

describe('focus targets', () => {
    const coverageKey = { kind: 'missing_output_inserter', machine_id: 4, item_name: 'logistic-science-pack' } as const;
    const targets: FocusTarget[] = [
        { kind: 'target-recipe' },
        { kind: 'target-rate' },
        { kind: 'target-copies' },
        { kind: 'add-machine' },
        { kind: 'machine-recipe', machineId: 3 },
        { kind: 'coverage-issue', issue: coverageKey },
        { kind: 'validation-error' },
    ];

    it('gives every target its own element', () => {
        const ids = targets.map(focusIdOf);
        expect(new Set(ids).size).toBe(targets.length);
    });

    it('uses the ids the forms and the alert set', () => {
        expect(focusIdOf({ kind: 'target-recipe' })).toBe(ELEMENT_IDS.targetRecipe);
        expect(focusIdOf({ kind: 'target-rate' })).toBe(ELEMENT_IDS.targetRate);
        expect(focusIdOf({ kind: 'target-copies' })).toBe(ELEMENT_IDS.targetCopies);
        expect(focusIdOf({ kind: 'add-machine' })).toBe(ELEMENT_IDS.addMachine);
        expect(focusIdOf({ kind: 'validation-error' })).toBe(ELEMENT_IDS.validationError);
        expect(focusIdOf({ kind: 'machine-recipe', machineId: 3 })).toBe(machineRecipeElementId(3));
        expect(machineRecipeElementId(3)).toBe('machine-recipe-3');
        // the contract with MissingInserterAlert, which sets the row's id from the whole issue
        expect(focusIdOf({ kind: 'coverage-issue', issue: coverageKey }))
            .toBe(coverageIssueElementId(issue('missing_output_inserter', 4, 'logistic-science-pack')));
        expect(coverageIssueElementId(coverageKey)).toBe('coverage-issue-missing_output_inserter-4-logistic-science-pack');
    });

    it('needs the List for the machine fields only', () => {
        expect(targets.filter(needsListView).map((t) => t.kind)).toEqual(['add-machine', 'machine-recipe']);
    });
});

describe('problemCountLabel', () => {
    it('counts in words', () => {
        expect(problemCountLabel(1)).toBe('1 problem');
        expect(problemCountLabel(2)).toBe('2 problems');
        expect(problemCountLabel(10)).toBe('10 problems');
    });
});
