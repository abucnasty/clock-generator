import { expect, it } from 'vitest';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import { bufferChest, infinityChest, inserter } from '../test/fixtures';
import { buildValidationIssues, isRefused, validationCountLabel, type BuildValidationIssue } from './buildValidation';
import { createDefaultConfig, type ChestFormData } from './configForm/formData';
import { outputChestIssues, outputChestIssueTitle } from './outputChestIssues';
import { focusIdOf, problemsOf, PROBLEM_TEXT } from './firstProblem';

const empty = infinityChest(7, { remove_unfiltered_items: false });
const route = inserter(2, { stack_size: 1, source: { type: 'machine', id: 3 }, sink: { type: 'chest', id: 7 } });
const output: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 3, recipe: 'iron-gear-wheel', item_name: 'iron-gear-wheel', fix_options: [{ type: 'infinity_chest', item_name: 'iron-gear-wheel' }] };
/** Nothing to report on machine 3 */
const none = { fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 3 }], chestIssues: [], coverageText: () => '' };
const collect = (chests: ChestFormData[] = [empty], coverage: InserterCoverageIssue[] = [], failure?: Parameters<typeof buildValidationIssues>[0]['failure']) => buildValidationIssues({
    ...none, coverage, chests, inserters: [route], chestIssues: outputChestIssues(chests, [route]),
    coverageText: issue => `Machine ${issue.machine_id} missing ${issue.item_name}`, failure,
});
/** The default build's field problems: no target recipe, and machine 1 without one */
const config = createDefaultConfig();
const fieldProblems = problemsOf({ targetOutput: config.target_output, machines: config.machines });

it('merges schema and coverage reports into one blocking chest error with one focus target', () => {
    for (const diagnostics of [
        [{ kind: 'coverage' as const, issue: output }],
        [{ kind: 'field' as const, path: ['chests', 0, 'item_filter'], message: 'Enable removal' }],
    ]) {
        const issues = collect([empty], [output], { message: 'Check failed', diagnostics });
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ source: 'chest', severity: 'error', blocksGeneration: true,
            text: outputChestIssueTitle({ kind: 'removal-disabled', chest: empty, index: 0 }) });
        expect(focusIdOf(issues[0].target!)).toBe(`validation-issue-${issues[0].id}`);
    }
});

it('keeps finite chest advice outside the error count and removes repaired chest errors', () => {
    expect(collect([bufferChest(7, { item_filter: 'iron-gear-wheel' })])[0]).toMatchObject({ severity: 'warning', blocksGeneration: false });
    expect(collect([{ ...empty, remove_unfiltered_items: true }])).toEqual([]);
    expect(collect([{ ...empty, item_filter: [{ item_name: 'iron-gear-wheel', request_count: 100 }] }])).toEqual([]);
    expect(validationCountLabel(1)).toBe('1 validation error');
    expect(validationCountLabel(2)).toBe('2 validation errors');
});

it('retains real missing connections and their repair options while deduplicating check results', () => {
    const missing = { ...output, machine_id: 4 };
    const issues = collect([empty], [output, missing], { message: 'Missing coverage', diagnostics: [{ kind: 'coverage', issue: missing }] });
    expect(issues).toHaveLength(2);
    expect(issues[1].coverage).toEqual(missing);
    expect(issues[1].coverage?.fix_options).toHaveLength(1);
});

it('merges a field failure from Check with the live field issue and retains its edit action', () => {
    const issues = buildValidationIssues({ ...none, fieldProblems, machines: config.machines,
        failure: { message: 'Required recipe', diagnostics: [{ kind: 'field', path: ['target_output', 'recipe'], message: 'Required' }] } });
    expect(issues.filter(issue => issue.id === 'target-recipe')).toHaveLength(1);
    expect(issues.find(issue => issue.id === 'target-recipe')?.fieldTarget).toEqual({ kind: 'target-recipe' });
    expect(issues.some(issue => issue.source === 'engine')).toBe(false);
});

it('does not hide an unrelated engine refusal behind an existing live error', () => {
    const issues = collect([empty], [], { message: 'Independent simulation refusal' });
    expect(issues).toHaveLength(2);
    expect(issues[1]).toMatchObject({ source: 'engine', text: 'Independent simulation refusal', blocksGeneration: true });
});

it('collects field problems before coverage, retaining engine order, game names and stable issue targets', () => {
    const input: InserterCoverageIssue = { ...output, kind: 'missing_input_inserter', machine_id: 4, item_name: 'iron-plate' };
    const itemLabel = (id: string) => id === 'iron-gear-wheel' ? 'Iron gear wheel' : 'Iron plate';
    const issues = buildValidationIssues({ ...none, fieldProblems, coverage: [output, input], machines: config.machines,
        coverageText: issue => (issue.kind === 'missing_input_inserter' ? PROBLEM_TEXT.missingInput : PROBLEM_TEXT.missingOutput)(
            issue.machine_id, issue.item_name, itemLabel),
    });
    expect(issues.map(issue => issue.source)).toEqual(['field', 'field', 'coverage', 'coverage']);
    expect(issues.map(issue => issue.text)).toEqual([
        PROBLEM_TEXT.noRecipe, PROBLEM_TEXT.machineWithoutRecipe(1),
        PROBLEM_TEXT.missingOutput(3, 'Iron gear wheel'), PROBLEM_TEXT.missingInput(4, 'Iron plate'),
    ]);
    expect(issues.slice(2).map(issue => focusIdOf(issue.target!))).toEqual([
        'validation-issue-coverage-issue-missing_output_inserter-3-iron-gear-wheel',
        'validation-issue-coverage-issue-missing_input_inserter-4-iron-plate',
    ]);
    expect(issues.slice(2).map(issue => issue.coverage)).toEqual([output, input]);
});

// the engine's wording passes through as it is: each row's name stands in for it
it.each([
    ['warning for a belt pickup whose timing is not tested', 'pickupNotTested', 'belt-pickup-not-tested', 'warning', 'calibration'],
    ['warning for lanes the copies would share over capacity', 'laneSharedByCopies', 'lanes-shared-by-copies', 'warning', 'lanes'],
    ['note for a drop that side-loads onto another belt', 'sideLoadedDrop', 'side-loaded-drop', 'warning', 'drop'],
    ['note for lanes the drops fill exactly', 'lanesExactlyFull', 'lanes-exactly-full', 'info', 'lanes'],
    ['note for the missing gap between copies', 'copyGapNeeded', 'copy-gap-needed', 'info', 'drop'],
] as const)('lists the engine %s as advice that never blocks generation', (text, field, id, severity, source) => {
    const advice: BuildValidationIssue = { id, text, severity, blocksGeneration: false, source, target: { kind: 'validation-issue', id } };
    expect(buildValidationIssues({ ...none, [field]: text })).toEqual([advice]);
    expect(buildValidationIssues({ ...none, [field]: null })).toEqual([]);
});

it('keeps advice beside an error and other advice, the error still blocking and the advice still not', () => {
    const both = buildValidationIssues({ ...none, pickupNotTested: 'Not tested', failure: { message: 'Independent simulation refusal' } });
    expect(both.map(({ source, blocksGeneration }) => ({ source, blocksGeneration })))
        .toEqual([{ source: 'engine', blocksGeneration: true }, { source: 'calibration', blocksGeneration: false }]);
    expect(buildValidationIssues({ ...none, lanesExactlyFull: 'Full', copyGapNeeded: 'Gap' }).map(issue => [issue.id, issue.text]))
        .toEqual([['lanes-exactly-full', 'Full'], ['copy-gap-needed', 'Gap']]);
});

const opening = "No clock can hold this build's target:";
const machineLimit = 'Machine 1 (iron ore recycling) can make at most 720 crafts a second. Lower the target, or add machines or make them faster.';
const inserterLimit = 'Inserters 3, 4, 5 and 6 can bring at most 480 a second of iron ore into the build. Lower the target, or give the machines more inserters.';

it('lists each problem of a refusal as its own blocking error, with no config path, and opens them once', () => {
    const issues = buildValidationIssues({ ...none, failure: { message: `${opening} ${machineLimit} ${inserterLimit}`,
        diagnostics: [{ kind: 'refusal', opening, problems: [machineLimit, inserterLimit] }] } });
    expect(issues.map(issue => issue.text)).toEqual([machineLimit, inserterLimit]);
    expect(issues).toHaveLength(2);
    expect(issues.every(issue => issue.blocksGeneration && issue.severity === 'error' && issue.source === 'refusal')).toBe(true);
    expect(issues.map(issue => issue.lead)).toEqual([opening, opening]);
    expect(issues.some(issue => /target output|items per second/i.test(issue.text))).toBe(false);
    expect(new Set(issues.map(issue => issue.id)).size).toBe(2);
    expect(isRefused(issues)).toBe(true);
});

it('shows a refusal without an opening as the one problem it is', () => {
    const message = 'The current configuration cannot meet the target production rate. Total output capacity is 5 items/second, but target production rate is 6 items/second.';
    const issues = buildValidationIssues({ ...none, failure: { message, diagnostics: [{ kind: 'refusal', problems: [message] }] } });
    expect(issues).toMatchObject([{ text: message, source: 'refusal', lead: undefined }]);
});

it('has no refusal once the build has changed: the check then no longer counts as its failure', () => {
    // App hands over `failure` only while the last check is for the build as it is
    expect(isRefused(buildValidationIssues({ ...none }))).toBe(false);
    expect(isRefused(collect([empty]))).toBe(false);
});

// the schema's errors keep a place to find, in the names the page shows
it.each([
    [['target_output', 'items_per_second'], 'Items per Second: Required'],
    [['target_output', 'recipe'], 'Recipe: Required'],
    [['machines', 1, 'recipe'], 'Machine 8 recipe: Required'],
    [['inserters', 0, 'source', 'pickup_layout'], 'Inserter 4 source pickup layout: Required'],
    [['belts', 0, 'lanes', 1, 'stack_size'], 'Belt 9 lanes 2 stack size: Required'],
    [['chests', 0, 'item_filter'], 'Chest 7 item filter: Required'],
    [['overrides', 'terminal_swing_count'], 'Advanced settings terminal swing count: Required'],
    [[], 'Build: Required'],
])('names the place of a schema error at %j as "%s", not as a config path', (path, text) => {
    const issues = buildValidationIssues({ ...none, machines: [{ id: 5 }, { id: 8 }], inserters: [inserter(4)], belts: [{ id: 9 }],
        chests: [empty], failure: { message: 'x', diagnostics: [{ kind: 'field', path, message: 'Required' }] } });
    expect(issues.at(-1)?.text).toBe(text);
});
