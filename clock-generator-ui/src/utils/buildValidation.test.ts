import { expect, it } from 'vitest';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import { buildValidationIssues, validationCountLabel } from './buildValidation';
import { createDefaultConfig, type ChestFormData, type InserterFormData } from './configForm/formData';
import { outputChestIssues } from './outputChestIssues';
import { focusIdOf, problemsOf, PROBLEM_TEXT } from './firstProblem';

const empty: ChestFormData = { id: 7, _uuid: 'chest-7', type: 'infinity-chest', item_filter: [] };
const route: InserterFormData = { id: 2, _uuid: 'inserter-2', stack_size: 1, source: { type: 'machine', id: 3 }, sink: { type: 'chest', id: 7 } };
const output: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 3, recipe: 'iron-gear-wheel', item_name: 'iron-gear-wheel', fix_options: [{ type: 'infinity_chest', item_name: 'iron-gear-wheel' }] };
const collect = (chests: ChestFormData[] = [empty], coverage: InserterCoverageIssue[] = [], failure?: Parameters<typeof buildValidationIssues>[0]['failure']) => buildValidationIssues({
    fieldProblems: [], coverage, chests, inserters: [route], machines: [{ id: 3 }], chestIssues: outputChestIssues(chests, [route]),
    coverageText: issue => `Machine ${issue.machine_id} missing ${issue.item_name}`, failure,
});

it('merges schema and coverage reports into one blocking chest error with one focus target', () => {
    for (const diagnostics of [
        [{ kind: 'coverage' as const, issue: output }],
        [{ kind: 'field' as const, path: ['chests', 0, 'item_filter'], message: 'Enable removal' }],
    ]) {
        const issues = collect([empty], [output], { message: 'Check failed', diagnostics });
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ source: 'chest', severity: 'error', blocksGeneration: true, text: 'Chest 7 needs output removal enabled' });
        expect(focusIdOf(issues[0].target!)).toBe(`validation-issue-${issues[0].id}`);
    }
});

it('keeps finite chest advice outside the error count and removes repaired chest errors', () => {
    const finite: ChestFormData = { ...empty, type: 'buffer-chest', storage_size: 48, item_filter: 'iron-gear-wheel' };
    expect(collect([finite])[0]).toMatchObject({ severity: 'warning', blocksGeneration: false });
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
    const config = createDefaultConfig();
    const issues = buildValidationIssues({ fieldProblems: problemsOf({ targetOutput: config.target_output, machines: config.machines }),
        coverage: [], chests: [], inserters: [], machines: config.machines, chestIssues: [], coverageText: () => '',
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
    const config = createDefaultConfig();
    const input: InserterCoverageIssue = { ...output, kind: 'missing_input_inserter', machine_id: 4, item_name: 'iron-plate' };
    const itemLabel = (id: string) => id === 'iron-gear-wheel' ? 'Iron gear wheel' : 'Iron plate';
    const issues = buildValidationIssues({
        fieldProblems: problemsOf({ targetOutput: config.target_output, machines: config.machines }),
        coverage: [output, input], chests: [], inserters: [], machines: config.machines, chestIssues: [],
        coverageText: issue => (issue.kind === 'missing_input_inserter' ? PROBLEM_TEXT.missingInput : PROBLEM_TEXT.missingOutput)(
            issue.machine_id, issue.item_name, itemLabel),
    });
    expect(issues.map(issue => issue.source)).toEqual(['field', 'field', 'coverage', 'coverage']);
    expect(issues.map(issue => issue.text)).toEqual([
        'Set the recipe in Target Output', 'Set the recipe of Machine 1',
        'Machine 3 has no inserter taking Iron gear wheel out',
        'Machine 4 has no source of Iron plate',
    ]);
    expect(issues.slice(2).map(issue => focusIdOf(issue.target!))).toEqual([
        'validation-issue-coverage-issue-missing_output_inserter-3-iron-gear-wheel',
        'validation-issue-coverage-issue-missing_input_inserter-4-iron-plate',
    ]);
    expect(issues.slice(2).map(issue => issue.coverage)).toEqual([output, input]);
});

it('lists the engine warning for a belt pickup whose timing is not tested as advice that never blocks generation', () => {
    const text = 'Not tested: Inserter 1 picks up iron-plate from belt 1 in 2-item belt stacks.';
    const input = { fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 3 }], chestIssues: [], coverageText: () => '' };
    expect(buildValidationIssues({ ...input, pickupNotTested: text })).toEqual([{ id: 'belt-pickup-not-tested', text, severity: 'warning',
        blocksGeneration: false, source: 'calibration', target: { kind: 'validation-issue', id: 'belt-pickup-not-tested' } }]);
    expect(buildValidationIssues({ ...input, pickupNotTested: null })).toEqual([]);
    // beside an error, the error still blocks and the warning still does not
    const both = buildValidationIssues({ ...input, pickupNotTested: text, failure: { message: 'Independent simulation refusal' } });
    expect(both.map(({ source, blocksGeneration }) => ({ source, blocksGeneration })))
        .toEqual([{ source: 'engine', blocksGeneration: true }, { source: 'calibration', blocksGeneration: false }]);
});

it('lists the engine warning for lanes the copies would share over capacity as advice that never blocks generation', () => {
    const text = 'If the 3 copies share lane 1 of belt 1, they take 2.40 times what it carries (3 × 96 = 288 a second, of 120).';
    const input = { fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 3 }], chestIssues: [], coverageText: () => '' };
    expect(buildValidationIssues({ ...input, laneSharedByCopies: text })).toEqual([{ id: 'lanes-shared-by-copies', text, severity: 'warning',
        blocksGeneration: false, source: 'lanes', target: { kind: 'validation-issue', id: 'lanes-shared-by-copies' } }]);
    expect(buildValidationIssues({ ...input, laneSharedByCopies: null })).toEqual([]);
});

it('lists the engine note for a drop that side-loads onto another belt as a known limit that never blocks generation', () => {
    const text = 'Inserter 15 drops onto a 3 tile belt buffer that side-loads onto another belt. The clock may make less in the game than shown here.';
    const input = { fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 3 }], chestIssues: [], coverageText: () => '' };
    expect(buildValidationIssues({ ...input, sideLoadedDrop: text })).toEqual([{ id: 'side-loaded-drop', text, severity: 'warning',
        blocksGeneration: false, source: 'drop', target: { kind: 'validation-issue', id: 'side-loaded-drop' } }]);
    expect(buildValidationIssues({ ...input, sideLoadedDrop: null })).toEqual([]);
});

it('lists the notes for lanes the drops fill exactly and for the missing gap between copies as notes that never block generation', () => {
    const full = 'Both lanes of belt 1 are exactly full at the target: the 7 copies drop 7 × 34.29 = 240 a second onto lanes that carry 240.';
    const gap = 'The 7 copies may drop onto the same belt 1. Say how far apart they stand to check whether their drops fit between each other.';
    const input = { fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 3 }], chestIssues: [], coverageText: () => '' };
    expect(buildValidationIssues({ ...input, lanesExactlyFull: full, copyGapNeeded: gap })).toEqual([
        { id: 'lanes-exactly-full', text: full, severity: 'info', blocksGeneration: false, source: 'lanes', target: { kind: 'validation-issue', id: 'lanes-exactly-full' } },
        { id: 'copy-gap-needed', text: gap, severity: 'info', blocksGeneration: false, source: 'drop', target: { kind: 'validation-issue', id: 'copy-gap-needed' } },
    ]);
    expect(buildValidationIssues({ ...input, lanesExactlyFull: null, copyGapNeeded: null })).toEqual([]);
});
