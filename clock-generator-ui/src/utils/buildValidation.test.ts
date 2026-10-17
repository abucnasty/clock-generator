import { expect, it } from 'vitest';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import { buildValidationIssues, validationCountLabel } from './buildValidation';
import { createDefaultConfig, type ChestFormData, type InserterFormData } from './configForm/formData';
import { outputChestIssues } from './outputChestIssues';
import { focusIdOf, problemsOf } from './firstProblem';

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
    const issues = buildValidationIssues({ fieldProblems: problemsOf({ targetOutput: config.target_output, machines: config.machines, coverageIssues: [] }),
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
