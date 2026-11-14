// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import { describe, expect, it, vi } from 'vitest';
import { bufferChest, infinityChest, inserter, names, show } from '../test/fixtures';
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
    expect(screen.getByRole('region', { name: 'Build check' }).contains(row)).toBe(true);
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
    const panel = screen.getByRole('region', { name: 'Build check' });
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
        coverageText: () => '', failure: { message: 'x', diagnostics: [{ kind: 'field', path: ['setpoint', 'items_per_second'], message: 'Too small' }] } });
    const { user } = show(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={[]} inserters={[]}
        onApplyFix={vi.fn()} onSwitchType={vi.fn()} onEnableRemoval={vi.fn()} onReview={onReview} />);
    expect(screen.getByText('Items per Second: Too small')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Review setting' }));
    expect(onReview).toHaveBeenCalledExactlyOnceWith({ kind: 'target-rate' });
});

describe('an advisory as one line with a detail window', () => {
    /** Six inserters whose drops the Sidecar marked as side-loading, two tiles before the other belt */
    const sideLoaded = [11, 12, 13, 15, 16, 17].map(inserter_id => ({ inserter_id, tiles: 2 }));
    const untested = [{ inserter_id: 1, belt_id: 1, item: 'iron-plate', lane_stack_sizes: [], hand_size: 12, item_stack_size: null }];
    const engineSentence = 'The inserter (inserter 11) that drops automation science pack drops onto a 2 tile belt buffer that side-loads onto another belt.';
    const none = { fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 1 }], chestIssues: [], coverageText: () => '' };

    function advisories(input: Partial<Parameters<typeof buildValidationIssues>[0]>) {
        const onReviewInserter = vi.fn();
        const onReview = vi.fn();
        const view = show(<BuildValidationPanel issues={buildValidationIssues({ ...none, ...input })} machines={[]} belts={[]} chests={[]} inserters={[]}
            onApplyFix={vi.fn()} onSwitchType={vi.fn()} onEnableRemoval={vi.fn()} onReview={onReview} onReviewInserter={onReviewInserter} />,
            { names: names({ 'iron-plate': 'Iron plate' }) });
        return { ...view, onReview, onReviewInserter, panel: screen.getByRole('region', { name: 'Build check' }) };
    }

    it('shows a side-loaded drop as one line: the kind, a chip for each inserter, Details; the count counts the line', async () => {
        const { user, panel, onReviewInserter } = advisories({ sideLoadedDrops: sideLoaded });
        expect(within(panel).getByText('1 advisory')).toBeDefined();
        const line = within(panel).getByRole('group', { name: 'Drops onto a belt that side-loads' });
        const chips = within(within(line).getByRole('list', { name: 'Inserters' })).getAllByRole('listitem');
        expect(chips.map(chip => within(chip).getByRole('button').getAttribute('aria-label')))
            .toEqual(['Review inserter 11', 'Review inserter 12', 'Review inserter 13', 'Review inserter 15', 'Review inserter 16', 'Review inserter 17']);
        expect(chips.map(chip => chip.textContent)).toEqual(['11', '12', '13', '15', '16', '17']);
        expect(within(line).getByRole('button', { name: 'Details' })).toBeDefined();
        // the window holds the rest: the line says nothing more, and nothing of the engine's sentence
        expect(panel.textContent).not.toMatch(/belt buffer|Why|What to do|Advisory · does not block/);
        expect(panel.textContent).not.toContain(engineSentence);
        await user.click(within(line).getByRole('button', { name: 'Review inserter 15' }));
        expect(onReviewInserter).toHaveBeenCalledExactlyOnceWith(15);
    });

    it('opens the window from Details: the drawing from the data, then why, what it can cost and what to do', async () => {
        const { user } = advisories({ sideLoadedDrops: [...sideLoaded.slice(0, 2), { inserter_id: 4, tiles: 3 }] });
        await user.click(screen.getByRole('button', { name: 'Details' }));
        const window = screen.getByRole('dialog', { name: 'Drops onto a belt that side-loads' });
        // one drawing for each length of the belt to the side-load, with its inserters and its tiles
        expect(within(window).getAllByRole('img').map(drawing => drawing.getAttribute('aria-label'))).toEqual([
            'Inserters 11 and 12 drop onto a belt of 2 tiles that side-loads onto another belt. Other inserters drop onto the other belt further on.',
            'Inserter 4 drops onto a belt of 3 tiles that side-loads onto another belt. Other inserters drop onto the other belt further on.',
        ]);
        expect(within(window).getByText('11, 12')).toBeDefined();
        expect(within(window).getByText('2 tiles')).toBeDefined();
        expect(within(window).getByText('3 tiles')).toBeDefined();
        const terms = within(window).getAllByRole('term').map(term => term.textContent);
        expect(terms).toEqual(['Why', 'What it can cost', 'What to do']);
        expect(within(window).getByText(/^The simulator counts only the room on the short belt\./)).toBeDefined();
        expect(within(window).getByText(/^Give each drop a belt of its own/)).toBeDefined();
        // the line's words are the window's name, and not said again in it
        const body = window.querySelector('.MuiDialogContent-root')!.textContent!;
        expect(body).not.toContain('Drops onto a belt that side-loads');
        expect(body).not.toContain('belt buffer');
    });

    it('closes the window on Escape and gives the focus back to Details', async () => {
        const { user } = advisories({ sideLoadedDrops: sideLoaded });
        const details = screen.getByRole('button', { name: 'Details' });
        await user.click(details);
        expect(screen.getByRole('dialog')).toBeDefined();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(details));
    });

    it('stacks two kinds as two lines, in the order of the check, and counts two', async () => {
        const { user, panel } = advisories({ sideLoadedDrops: sideLoaded, pickupsNotTested: untested });
        expect(within(panel).getByText('2 advisories')).toBeDefined();
        expect(within(panel).getAllByRole('group').map(line => line.getAttribute('aria-label'))).toEqual(['Belt pickup not tested', 'Drops onto a belt that side-loads']);
        const pickup = within(panel).getByRole('group', { name: 'Belt pickup not tested' });
        expect(within(pickup).getAllByRole('listitem').map(chip => chip.textContent)).toEqual(['1']);
        await user.click(within(pickup).getByRole('button', { name: 'Details' }));
        const window = screen.getByRole('dialog', { name: 'Belt pickup not tested' });
        expect(within(window).getByText('Inserter 1 picks up iron plate from belt 1 with a 12-item hand.')).toBeDefined();
        // the engine's words say why and what it can cost, and nothing of what to do
        expect(within(window).getAllByRole('term').map(term => term.textContent)).toEqual(['Why', 'What it can cost']);
        expect(within(window).getByText('The clock may not match the game.')).toBeDefined();
    });

    it('shows the other kinds as lines too, with their inserters or machines as chips and their words in the window', async () => {
        const shared = 'If the 3 copies share the iron plate lane (lane 1 of belt 1), they drop 1.46 times what it carries (3 × 48 = 144 a second, of 99). '
            + 'This is only a warning. If each copy has a lane of its own, set the lane to per copy.';
        const gap = 'The 3 copies may drop onto the same iron plate belt (belt 1). Say how far apart they stand to check whether their drops fit between each other.';
        const cannot = (id: number) => `Machine ${id}: cryogenic plant can't craft iron plate. Machines that can: stone furnace. The clock is made as configured, but the game does not let this machine be set to the recipe.`;
        const { user, panel, onReview } = advisories({ laneSharedByCopies: shared, laneSharedByCopiesInserters: [2, 5], copyGapNeeded: gap,
            machinePrototypes: [1, 3].map(machine_id => ({ machine_id, kind: 'recipe-not-made' as const, message: cannot(machine_id) })) });
        expect(within(panel).getByText('3 advisories')).toBeDefined();
        const lines = within(panel).getAllByRole('group');
        expect(lines.map(line => line.getAttribute('aria-label'))).toEqual(['Copies drop more than a shared lane carries', 'Copies may drop onto the same belt', "Machine can't craft its recipe"]);
        expect(within(lines[0]).getAllByRole('listitem').map(chip => chip.textContent)).toEqual(['2', '5']);
        expect(within(lines[1]).queryByRole('list')).toBeNull();
        expect(within(within(lines[2]).getByRole('list', { name: 'Machines' })).getAllByRole('listitem').map(chip => chip.textContent)).toEqual(['1', '3']);
        await user.click(within(lines[2]).getByRole('button', { name: 'Review machine 3' }));
        expect(onReview).toHaveBeenCalledExactlyOnceWith({ kind: 'machine-recipe', machineId: 3 });
        // the engine's words, whole, in the window and not on the line
        expect(panel.textContent).not.toContain(shared);
        await user.click(within(lines[0]).getByRole('button', { name: 'Details' }));
        expect(within(screen.getByRole('dialog', { name: 'Copies drop more than a shared lane carries' })).getByText(shared)).toBeDefined();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await user.click(within(lines[2]).getByRole('button', { name: 'Details' }));
        const machines = screen.getByRole('dialog', { name: "Machine can't craft its recipe" });
        expect(within(machines).getByText(cannot(1))).toBeDefined();
        expect(within(machines).getByText(cannot(3))).toBeDefined();
    });

    it('marks an advisory as one with a caution mark and a note as one with an information mark', () => {
        const { panel } = advisories({ sideLoadedDrops: sideLoaded, lanesExactlyFull: 'Both lanes of the iron plate belt are exactly full at the target.', lanesExactlyFullInserters: [3] });
        const [warning, note] = within(panel).getAllByRole('group');
        expect(note.getAttribute('aria-label')).toBe('Lanes exactly full');
        expect(within(warning).getByTitle('Advisory, does not block generation')).toBeDefined();
        expect(within(note).getByTitle('Note, does not block generation')).toBeDefined();
    });

    it('leaves the errors and a chest advisory as they are', () => {
        const finite = [bufferChest(7, { item_filter: 'iron-gear-wheel' })];
        const route = [inserter(2, { stack_size: 1, source: { type: 'machine', id: 3 }, sink: { type: 'chest', id: 7 } })];
        const issues = buildValidationIssues({ ...none, chests: finite, inserters: route,
            chestIssues: outputChestIssues(finite, route), scopeRefusal: 'Refused', sideLoadedDrops: sideLoaded });
        show(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={finite} inserters={route}
            onApplyFix={vi.fn()} onSwitchType={vi.fn()} onEnableRemoval={vi.fn()} onReview={vi.fn()} />);
        const panel = screen.getByRole('region', { name: 'Build check' });
        expect(within(panel).getByText('1 error · 2 advisories')).toBeDefined();
        // the chest's advice keeps its caption; the line has none
        expect(within(panel).getAllByText('Advisory · does not block generation')).toHaveLength(1);
        expect(within(panel).getByText('Refused')).toBeDefined();
        // without a step to the rows, a chip is not a button
        const line = within(panel).getByRole('group', { name: 'Drops onto a belt that side-loads' });
        expect(within(line).getAllByRole('button').map(button => button.textContent)).toEqual(['Details']);
    });
});

it('points at each inserter the engine refuses (#650): one button per named inserter, to its row', async () => {
    const message = 'Inserters 3 and 5 take from a belt and drop into something other than a machine: inserter 3 takes from belt 4 and drops into chest 2; '
        + 'inserter 5 takes from belt 3 and drops into chest 1. Taking from a belt into anything but a machine is not supported, so this build cannot be clocked. '
        + 'Make each of them drop into a machine, so that the machine is fed straight from the belt.';
    const issues = buildValidationIssues({ fieldProblems: [], coverage: [], chests: [], inserters: [], machines: [{ id: 1 }], chestIssues: [],
        coverageText: () => '', scopeRefusal: message, scopeRefusalInserters: [3, 5] });
    const onReviewInserter = vi.fn();
    const { user } = show(<BuildValidationPanel issues={issues} machines={[]} belts={[]} chests={[]} inserters={[]}
        onApplyFix={vi.fn()} onSwitchType={vi.fn()} onEnableRemoval={vi.fn()} onReview={vi.fn()} onReviewInserter={onReviewInserter} />);
    expect(screen.getAllByText(message)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Review inserter 5' }));
    expect(onReviewInserter).toHaveBeenCalledExactlyOnceWith(5);
    expect(screen.getByRole('button', { name: 'Review inserter 3' })).toBeDefined();
});
