// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import { expect, it, vi } from 'vitest';
import { infinityChest, inserter, show } from '../test/fixtures';
import { buildValidationIssues, navigateToOutputRouteRepair, outputRouteRepairTarget } from '../utils/buildValidation';
import type { ChestFormData, InserterFormData } from '../utils/configForm/formData';
import { focusIdOf, focusProblemTarget } from '../utils/firstProblem';
import { outputChestIssues } from '../utils/outputChestIssues';
import { BuildValidationPanel } from './BuildValidationPanel';

// an infinity chest at the end of the line that removes nothing
const chest = infinityChest(7, { remove_unfiltered_items: false });
const missingOutput: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 7, recipe: 'processing-unit-recycling',
    item_name: 'advanced-circuit', fix_options: [] };
// what the machine's output facts ask for before coverage has settled
const requested = { kind: 'missing_output_inserter' as const, machine_id: 7, item_name: 'advanced-circuit' };
const filtered = [inserter(3, { filters: ['advanced-circuit'], source: { type: 'machine', id: 7 }, sink: { type: 'chest', id: 7 } })];

function issuesOf(chests: ChestFormData[], inserters: InserterFormData[], coverage: InserterCoverageIssue[] = []) {
    const chestIssues = outputChestIssues(chests, inserters);
    return { chestIssues, issues: buildValidationIssues({ fieldProblems: [], coverage, chests, inserters, machines: [{ id: 7 }], chestIssues,
        coverageText: () => 'Missing output route' }) };
}

function panel(chests: ChestFormData[], inserters: InserterFormData[], coverage: InserterCoverageIssue[] = []) {
    const { chestIssues, issues } = issuesOf(chests, inserters, coverage);
    const onEnableRemoval = vi.fn();
    const view = show(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={chests} inserters={inserters}
        onApplyFix={vi.fn()} onSwitchType={vi.fn()} onEnableRemoval={onEnableRemoval} onReview={vi.fn()} />);
    return { ...view, chestIssues, issues, onEnableRemoval };
}

it('renders one named validation panel with one chest error, preserving the repair without nested alerts', async () => {
    // a chest whose removal was never set removes nothing either
    const { user, onEnableRemoval } = panel([infinityChest(7, { remove_unfiltered_items: undefined })],
        [inserter(2, { sink: { type: 'chest', id: 7 } })]);
    const row = screen.getByRole('group', { name: 'Chest 7 needs output removal enabled' });
    expect(screen.getByRole('region', { name: 'Build validation' }).contains(row)).toBe(true);
    expect(screen.getByText('1 error')).toBeDefined();
    expect(screen.getAllByText('Chest 7 needs output removal enabled')).toHaveLength(1);
    expect(document.getElementById('validation-issue-chest:7:removal-disabled')).toBe(row);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Advisory/)).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Enable Remove unfiltered items for Chest 7' }));
    expect(onEnableRemoval).toHaveBeenCalledExactlyOnceWith(0);
});

it.each([
    { to: 'the empty-infinity-chest repair that subsumes a rejected recycler output', chests: [chest],
        inserters: [inserter(3, { source: { type: 'machine', id: 7 }, sink: { type: 'chest', id: 7 } })],
        id: 'chest:7:removal-disabled', row: 'Chest 7 needs output removal enabled',
        repair: 'Enable Remove unfiltered items for Chest 7' },
    { to: 'its own rendered row for an ordinary missing output', chests: [], inserters: [],
        id: 'coverage-issue-missing_output_inserter-7-advanced-circuit', row: 'Missing output route' },
])('routes to $to, leaving fullscreen first', ({ chests, inserters, id, row, repair }) => {
    const { chestIssues, issues } = panel(chests, inserters, [missingOutput]);
    expect(issues.map(issue => issue.id)).toEqual([id]);
    const exitFullscreen = vi.fn();
    const navigate = vi.fn(focusProblemTarget);
    expect(navigateToOutputRouteRepair(missingOutput, issues, chestIssues, inserters, exitFullscreen, navigate)).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledExactlyOnceWith(false);
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'validation-issue', id });
    expect(exitFullscreen.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: row }));
    // the row routed to holds the repair
    if (repair) expect(within(screen.getByRole('group', { name: row })).getByRole('button', { name: repair })).toBeDefined();
});

it('uses rendered chest diagnostics to route an identity-only output request while coverage is pending', () => {
    const { chestIssues, issues } = issuesOf([chest], filtered);
    const exitFullscreen = vi.fn();
    const navigate = vi.fn();
    expect(issues.map(issue => issue.id)).toEqual(['chest:7:removal-disabled']);
    const target = outputRouteRepairTarget(requested, issues, chestIssues, filtered);
    expect(target).toEqual({ kind: 'validation-issue', id: 'chest:7:removal-disabled' });
    expect(focusIdOf(target!)).toBe('validation-issue-chest:7:removal-disabled');
    expect(navigateToOutputRouteRepair(requested, issues, chestIssues, filtered, exitFullscreen, navigate)).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledExactlyOnceWith(false);
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'validation-issue', id: 'chest:7:removal-disabled' });
});

it('does not navigate to a chest cause that has no visible validation row', () => {
    const { chestIssues } = issuesOf([chest], filtered);
    const exitFullscreen = vi.fn();
    const navigate = vi.fn();
    expect(chestIssues).toHaveLength(1);
    expect(outputRouteRepairTarget(requested, [], chestIssues, filtered)).toBeNull();
    expect(navigateToOutputRouteRepair(requested, [], chestIssues, filtered, exitFullscreen, navigate)).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
});

const opening = "No clock can hold this build's target:";
const machineLimit = 'Machine 1 (iron ore recycling) can make at most 720 crafts a second. Lower the target, or add machines or make them faster.';
const inserterLimit = 'Inserters 3, 4, 5 and 6 can bring at most 480 a second of iron ore into the build. Lower the target, or give the machines more inserters.';

it('shows a refusal of two problems as two errors, opened once and with no config path', () => {
    const issues = buildValidationIssues({ fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 1 }], chestIssues: [],
        coverageText: () => '', failure: { message: `${opening} ${machineLimit} ${inserterLimit}`,
            diagnostics: [{ kind: 'refusal', opening, problems: [machineLimit, inserterLimit] }] } });
    show(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={[]} inserters={[]}
        onApplyFix={vi.fn()} onSwitchType={vi.fn()} onEnableRemoval={vi.fn()} onReview={vi.fn()} />);
    const panel = screen.getByRole('region', { name: 'Build validation' });
    expect(within(panel).getByText('2 errors')).toBeDefined();
    expect(within(panel).getAllByText(opening)).toHaveLength(1);
    const items = within(panel).getAllByRole('group');
    expect(items.map(item => item.textContent)).toEqual([machineLimit, inserterLimit]);
    expect(panel.textContent).not.toMatch(/target output|items per second:/i);
    expect(within(panel).queryByRole('button')).toBeNull();
});

it('names a schema error by the field the player sees and keeps its button to the field', async () => {
    const onReview = vi.fn();
    const issues = buildValidationIssues({ fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 1 }], chestIssues: [],
        coverageText: () => '', failure: { message: 'x', diagnostics: [{ kind: 'field', path: ['target_output', 'items_per_second'], message: 'Too small' }] } });
    const { user } = show(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={[]} inserters={[]}
        onApplyFix={vi.fn()} onSwitchType={vi.fn()} onEnableRemoval={vi.fn()} onReview={onReview} />);
    expect(screen.getByText('Items per Second: Too small')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Review setting' }));
    expect(onReview).toHaveBeenCalledExactlyOnceWith({ kind: 'target-rate' });
});
