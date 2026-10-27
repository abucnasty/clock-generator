import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildValidationPanel } from './BuildValidationPanel';
import { buildValidationIssues, navigateToOutputRouteRepair, outputRouteRepairTarget, validationIssueElementId } from '../utils/buildValidation';
import { outputChestIssues } from '../utils/outputChestIssues';
import type { ChestFormData, InserterFormData } from '../hooks/useConfigForm';
import { focusIdOf } from '../utils/firstProblem';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import type { FocusTarget } from '../utils/firstProblem';

it('renders one named validation panel with one chest error, preserving the repair without nested alerts', () => {
    const chests: ChestFormData[] = [{ id: 7, _uuid: 'chest-7', type: 'infinity-chest', item_filter: [] }];
    const inserters: InserterFormData[] = [{ id: 2, _uuid: 'ins-2', stack_size: 1, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 7 } }];
    const issues = buildValidationIssues({ fieldProblems: [], coverage: [], chests, inserters, machines: [], chestIssues: outputChestIssues(chests, inserters), coverageText: () => '' });
    const html = renderToStaticMarkup(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={chests} inserters={inserters}
        onApplyFix={() => {}} onSwitchType={() => {}} onEnableRemoval={() => {}} onReview={() => {}} />);
    expect(html).toContain('aria-label="Build validation"');
    expect(html.match(/>Chest 7 needs output removal enabled</g)).toHaveLength(1);
    expect(html).toContain('Enable Remove unfiltered items for Chest 7');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('Advisory');
    expect(html).toContain('id="validation-issue-chest:7:removal-disabled"');
});

it('routes a rejected recycler output to the rendered empty-infinity-chest repair that subsumes it', () => {
    const chests: ChestFormData[] = [{ id: 7, _uuid: 'chest-7', type: 'infinity-chest', item_filter: [], remove_unfiltered_items: false }];
    const inserters: InserterFormData[] = [{ id: 3, _uuid: 'inserter-3', stack_size: 1, source: { type: 'machine', id: 7 }, sink: { type: 'chest', id: 7 } }];
    const coverage: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 7, recipe: 'processing-unit-recycling',
        item_name: 'advanced-circuit', fix_options: [] };
    const chestsIssues = outputChestIssues(chests, inserters);
    const issues = buildValidationIssues({ fieldProblems: [], coverage: [coverage], chests, inserters, machines: [{ id: 7 }], chestIssues: chestsIssues,
        coverageText: () => 'Missing output route' });
    const html = renderToStaticMarkup(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={chests} inserters={inserters}
        onApplyFix={() => {}} onSwitchType={() => {}} onEnableRemoval={() => {}} onReview={() => {}} />);
    expect(issues.map(issue => issue.id)).toEqual(['chest:7:removal-disabled']);
    const calls: string[] = [];
    const exitFullscreen = vi.fn((fullscreen: boolean) => { calls.push(`fullscreen:${fullscreen}`); });
    const navigate = vi.fn((target: FocusTarget) => { calls.push(`navigate:${JSON.stringify(target)}`); });
    expect(navigateToOutputRouteRepair(coverage, issues, chestsIssues, inserters, exitFullscreen, navigate)).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledExactlyOnceWith(false);
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'validation-issue', id: 'chest:7:removal-disabled' });
    expect(calls).toEqual(['fullscreen:false', 'navigate:{"kind":"validation-issue","id":"chest:7:removal-disabled"}']);
    const target = navigate.mock.calls[0][0];
    if (target.kind !== 'validation-issue') throw new Error('Expected a visible validation issue target');
    expect(target.id).toBe('chest:7:removal-disabled');
    expect(focusIdOf(target)).toBe('validation-issue-chest:7:removal-disabled');
    expect(html).toContain('Enable Remove unfiltered items for Chest 7');
    expect(html).toContain('id="validation-issue-chest:7:removal-disabled"');
});

it('uses rendered chest diagnostics to route an identity-only output request while coverage is pending', () => {
    const chests: ChestFormData[] = [{ id: 7, _uuid: 'chest-7', type: 'infinity-chest', item_filter: [], remove_unfiltered_items: false }];
    const inserters: InserterFormData[] = [{ id: 3, _uuid: 'inserter-3', stack_size: 1, filters: ['advanced-circuit'],
        source: { type: 'machine', id: 7 }, sink: { type: 'chest', id: 7 } }];
    const requested = { kind: 'missing_output_inserter' as const, machine_id: 7, item_name: 'advanced-circuit' };
    const chestIssues = outputChestIssues(chests, inserters);
    const visibleIssues = buildValidationIssues({ fieldProblems: [], coverage: [], chests, inserters, machines: [{ id: 7 }],
        chestIssues, coverageText: () => '' });
    const exitFullscreen = vi.fn();
    const navigate = vi.fn();

    expect(visibleIssues.map(issue => issue.id)).toEqual(['chest:7:removal-disabled']);
    const target = outputRouteRepairTarget(requested, visibleIssues, chestIssues, inserters);
    expect(target).toEqual({ kind: 'validation-issue', id: 'chest:7:removal-disabled' });
    expect(focusIdOf(target!)).toBe('validation-issue-chest:7:removal-disabled');
    expect(navigateToOutputRouteRepair(requested, visibleIssues, chestIssues, inserters, exitFullscreen, navigate)).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledExactlyOnceWith(false);
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'validation-issue', id: 'chest:7:removal-disabled' });
});

it('does not navigate to a chest cause that has no visible validation row', () => {
    const chests: ChestFormData[] = [{ id: 7, _uuid: 'chest-7', type: 'infinity-chest', item_filter: [], remove_unfiltered_items: false }];
    const inserters: InserterFormData[] = [{ id: 3, _uuid: 'inserter-3', stack_size: 1, filters: ['advanced-circuit'],
        source: { type: 'machine', id: 7 }, sink: { type: 'chest', id: 7 } }];
    const requested = { kind: 'missing_output_inserter' as const, machine_id: 7, item_name: 'advanced-circuit' };
    const chestIssues = outputChestIssues(chests, inserters);
    const exitFullscreen = vi.fn();
    const navigate = vi.fn();

    expect(chestIssues).toHaveLength(1);
    expect(outputRouteRepairTarget(requested, [], chestIssues, inserters)).toBeNull();
    expect(navigateToOutputRouteRepair(requested, [], chestIssues, inserters, exitFullscreen, navigate)).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
});

it('routes an ordinary missing output to its own rendered validation row', () => {
    const chests: ChestFormData[] = [];
    const inserters: InserterFormData[] = [];
    const coverage: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 7, recipe: 'processing-unit-recycling',
        item_name: 'advanced-circuit', fix_options: [] };
    const chestsIssues = outputChestIssues(chests, inserters);
    const issues = buildValidationIssues({ fieldProblems: [], coverage: [coverage], chests, inserters, machines: [{ id: 7 }], chestIssues: chestsIssues,
        coverageText: () => 'Missing output route' });
    const html = renderToStaticMarkup(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={chests} inserters={inserters}
        onApplyFix={() => {}} onSwitchType={() => {}} onEnableRemoval={() => {}} onReview={() => {}} />);
    const target = outputRouteRepairTarget(coverage, issues, chestsIssues, inserters);
    if (!target || target.kind !== 'validation-issue') throw new Error('Expected a validation issue target');
    const actualFocusId = validationIssueElementId(target.id);
    expect(focusIdOf(target)).toBe('validation-issue-coverage-issue-missing_output_inserter-7-advanced-circuit');
    expect(html).toContain(`id="${actualFocusId}"`);
});
