import type { InserterCoverageIssue } from 'clock-generator/browser';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { updateTargetOutput } from './configForm/edits';
import {
    ELEMENT_IDS,
    PROBLEM_TEXT,
    barNoteOf,
    coverageIssueElementId,
    focusIdOf,
    machineRecipeElementId,
    needsListView,
    problemCountLabel,
    problemsOf,
    type FocusTarget,
    type Problem,
} from './firstProblem';

type Input = Parameters<typeof problemsOf>[0];
type Overrides = Omit<Partial<Input>, 'targetOutput'> & { targetOutput?: Partial<Input['targetOutput']> };

/** A build with no field problem; `targetOutput` changes only the fields it gives */
const filledIn = ({ targetOutput, ...overrides }: Overrides = {}): Input => ({
    targetOutput: { recipe: 'logistic-science-pack', items_per_second: 240, copies: 1, ...targetOutput },
    machines: [{ id: 1, recipe: 'logistic-science-pack' }],
    ...overrides,
});

const problemsIn = (config: ConfigFormData) => problemsOf({ targetOutput: config.target_output, machines: config.machines });

const recipeProblem: Problem = { text: PROBLEM_TEXT.noRecipe, target: { kind: 'target-recipe' } };
const rateProblem: Problem = { text: PROBLEM_TEXT.noRate, target: { kind: 'target-rate' } };
const machineProblem = (machineId: number): Problem => ({ text: PROBLEM_TEXT.machineWithoutRecipe(machineId), target: { kind: 'machine-recipe', machineId } });

describe('problemsOf', () => {
    it('finds no field problems in a filled-in build', () => {
        expect(problemsOf(filledIn())).toEqual([]);
    });

    it.each([[1, 1e-23], [1e308, 1]])('defers unsupported target/capacity arithmetic to worker validation without formatting an unknown limit (%d copies, %d/s)', (copies, items_per_second) => {
        const machinesMax = { machineIds: [1], perCopy: 2, perCopyRatio: { numerator: 2, denominator: 1 } };
        expect(problemsOf(filledIn({ machinesMax, targetOutput: { copies, items_per_second } }))).toEqual([]);
    });

    it('finds two problems in the default build: the target recipe, then the machine recipe', () => {
        expect(problemsIn(createDefaultConfig())).toEqual([recipeProblem, machineProblem(1)]);
    });

    it('fixing the target recipe of the default build leaves the machine recipe first', () => {
        const [first] = problemsIn(updateTargetOutput(createDefaultConfig(), 'recipe', 'logistic-science-pack'));
        expect(first).toEqual(machineProblem(1));
    });

    it.each<[string, Overrides, Problem]>([
        ['a target without a recipe', { targetOutput: { recipe: '' } }, recipeProblem],
        ['a rate of 0', { targetOutput: { items_per_second: 0 } }, rateProblem],
        ['a rate below 0', { targetOutput: { items_per_second: -3 } }, rateProblem],
        ['0 copies', { targetOutput: { copies: 0 } }, { text: PROBLEM_TEXT.noCopies, target: { kind: 'target-copies' } }],
        ['no machine', { machines: [] }, { text: PROBLEM_TEXT.noMachines, target: { kind: 'add-machine' } }],
    ])('says what is wrong with %s, alone, and where it is fixed', (_, overrides, problem) => {
        expect(problemsOf(filledIn(overrides))).toEqual([problem]);
    });

    it('puts the target first, then each machine without a recipe, in machine order', () => {
        const machines = [{ id: 1, recipe: 'a' }, { id: 2, recipe: '' }, { id: 3, recipe: '' }];
        expect(problemsOf(filledIn({ targetOutput: { recipe: '', items_per_second: 0 }, machines })))
            .toEqual([recipeProblem, rateProblem, machineProblem(2), machineProblem(3)]);
    });
});

describe('a target more than the machines can make', () => {
    // Machine 1 of the logistic science sample: 11 copies make 252.656…/s, printed rounded down as 252.65
    const machinesMax = { machineIds: [1], perCopy: 22.96874920527133 };
    const at = (items_per_second: number) => filledIn({ targetOutput: { items_per_second, copies: 11 }, machinesMax });
    const tooHigh = at(240200);
    const aboveMax: Problem = { text: 'Items per Second is more than the machines can make (at most 252.65/s)', target: { kind: 'target-rate' } };

    it('comes after missing machine recipes', () => {
        const machines = [{ id: 1, recipe: 'logistic-science-pack' }, { id: 2, recipe: '' }];
        expect(problemsOf({ ...tooHigh, machines })).toEqual([machineProblem(2), aboveMax]);
    });

    it('is a problem that goes to Items per Second, not there for a target the copies make (252.65 is, 252.66 is not), or while the most is not known', () => {
        expect(problemsOf(tooHigh)).toEqual([aboveMax]);
        expect(problemsOf(at(240))).toEqual([]);
        expect(problemsOf(at(252.65))).toEqual([]);
        expect(problemsOf(at(252.66))).toEqual([aboveMax]);
        expect(problemsOf({ ...tooHigh, machinesMax: null })).toEqual([]);
        expect(problemsOf({ ...tooHigh, machinesMax: undefined })).toEqual([]);
    });
});

describe('a target that counts the item destroyed, more than the machines can destroy', () => {
    // Machine 1 of the exact-speed ore voider: 540 crafts a second, a quarter of an ore given back by each
    const machinesMax = { machineIds: [1], perCopy: 405, perCopyRatio: { numerator: 405, denominator: 1 } };
    const at = (items_per_second: number) => filledIn({ targetOutput: { recipe: 'iron-ore', items_per_second, copies: 1, counts: 'destroyed' }, machinesMax });

    it('says destroy, goes to Items per Second, and is not there for the 400 the sample asks', () => {
        expect(problemsOf(at(406))).toEqual([{ text: PROBLEM_TEXT.rateAboveMax(405, 'destroyed'), target: { kind: 'target-rate' } }]);
        expect(problemsOf(at(400))).toEqual([]);
        expect(problemsOf(at(405))).toEqual([]);
    });

    it('says make for a target that counts the item made, as before', () => {
        expect(PROBLEM_TEXT.rateAboveMax(405)).toBe('Items per Second is more than the machines can make (at most 405/s)');
        expect(PROBLEM_TEXT.rateAboveMax(405, 'made')).toBe('Items per Second is more than the machines can make (at most 405/s)');
        expect(PROBLEM_TEXT.rateAboveMax(480, 'destroyed', false)).toBe('Items per Second is more than the build can carry (at most 480/s)');
        expect(PROBLEM_TEXT.rateAboveMax(405, 'destroyed')).toBe('Items per Second is more than the machines can destroy (at most 405/s)');
    });
});

describe('barNoteOf', () => {
    type Bar = Parameters<typeof barNoteOf>[0];
    const bar = (fields: Partial<Bar>): Bar => ({ problems: [], busy: false, checkStatus: 'none', ...fields });
    const routes: Problem = { text: PROBLEM_TEXT.routes, target: null };
    const start: Problem = { text: PROBLEM_TEXT.start, target: { kind: 'target-recipe' } };
    const failed: Problem = { text: PROBLEM_TEXT.validationFailed, target: { kind: 'validation-error' } };

    it.each<[string, Bar, Problem | null]>([
        ['nothing while something runs, whatever else is wrong', bar({ problems: [recipeProblem], busy: true, checkStatus: 'invalid' }), null],
        ['nothing while something runs, after a failed check', bar({ busy: true, checkStatus: 'invalid' }), null],
        ['the first problem with its target', bar({ problems: [recipeProblem, rateProblem] }), recipeProblem],
        ['the first problem ahead of a failed check', bar({ problems: [rateProblem], checkStatus: 'invalid' }), rateProblem],
        // a blank build describes the entry routes until building by hand is chosen, then points to the recipe
        ['the entry routes on a blank build', bar({ problems: [rateProblem, recipeProblem], blank: true }), routes],
        ['the start once building by hand is chosen', bar({ problems: [rateProblem, recipeProblem], blank: true, entryRoute: 'manual' }), start],
        ['nothing on a blank build while something runs', bar({ problems: [recipeProblem], busy: true, blank: true }), null],
        ['nothing on a blank build without a problem', bar({ blank: true }), null],
        ['the reason for a failed check when the build has no problem', bar({ checkStatus: 'invalid' }), failed],
        ['nothing for a check that is none', bar({ checkStatus: 'none' }), null],
        ['nothing for a check that is valid', bar({ checkStatus: 'valid' }), null],
        ['nothing for a check that is out-of-date', bar({ checkStatus: 'out-of-date' }), null],
        ['nothing for a check that is running', bar({ checkStatus: 'running' }), null],
    ])('gives %s', (_, input, note) => {
        expect(barNoteOf(input)).toEqual(note);
    });
});

describe('PROBLEM_TEXT', () => {
    it('words each problem and note as the tooltips and the bar say them', () => {
        expect(PROBLEM_TEXT).toMatchObject({
            noRecipe: 'Set the recipe in Target Output',
            noRate: 'Set Items per Second in Target Output to more than 0',
            noCopies: 'Set Copies to more than 0.',
            noMachines: 'Add a machine',
            validationFailed: 'The last check failed. Show why',
            routes: 'Start with Paste from Factorio, try an example, or build by hand.',
            start: 'Start: pick the recipe you want to make',
        });
        expect(PROBLEM_TEXT.machineWithoutRecipe(2)).toBe('Set the recipe of Machine 2');
    });
});

describe('focus targets', () => {
    const coverageKey = { kind: 'missing_output_inserter', machine_id: 4, item_name: 'logistic-science-pack' } as const;
    const wholeIssue: InserterCoverageIssue = { ...coverageKey, recipe: 'some-recipe', fix_options: [] };
    const elements: [FocusTarget, string][] = [
        [{ kind: 'target-recipe' }, ELEMENT_IDS.targetRecipe],
        [{ kind: 'target-rate' }, ELEMENT_IDS.targetRate],
        [{ kind: 'target-copies' }, ELEMENT_IDS.targetCopies],
        [{ kind: 'add-machine' }, ELEMENT_IDS.addMachine],
        [{ kind: 'add-inserter' }, 'add-inserter'],
        [{ kind: 'machine-recipe', machineId: 3 }, machineRecipeElementId(3)],
        [{ kind: 'machine-result-target', machineId: 3 }, 'machine-result-target-3'],
        // the contract with MissingInserterAlert, which sets the row's id from the whole issue
        [{ kind: 'coverage-issue', issue: coverageKey }, coverageIssueElementId(wholeIssue)],
        [{ kind: 'validation-error' }, ELEMENT_IDS.validationError],
    ];
    const targets = elements.map(([target]) => target);

    it('gives every target its own element', () => {
        expect(new Set(targets.map(focusIdOf)).size).toBe(targets.length);
    });

    it.each(elements)('uses the id the forms and the alert set for %j', (target, id) => {
        expect(focusIdOf(target)).toBe(id);
    });

    it('names a machine\'s recipe and a coverage issue by what tells them apart', () => {
        expect(machineRecipeElementId(3)).toBe('machine-recipe-3');
        expect(coverageIssueElementId(coverageKey)).toBe('coverage-issue-missing_output_inserter-4-logistic-science-pack');
    });

    it('needs the List for machine fields and the Add Inserter action', () => {
        expect(targets.filter(needsListView).map((t) => t.kind)).toEqual(['add-machine', 'add-inserter', 'machine-recipe', 'machine-result-target']);
    });
});

describe('problemCountLabel', () => {
    it.each([[1, '1 problem'], [2, '2 problems'], [10, '10 problems']])('counts %i in words', (count, words) => {
        expect(problemCountLabel(count)).toBe(words);
    });
});
