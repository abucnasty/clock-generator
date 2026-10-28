// @vitest-environment happy-dom
import { screen, waitFor, within, type BoundFunctions, type queries } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import type { SerializableEntityStateTransitions, SerializableStateTransitionHistory, SerializableTransferHistory } from 'clock-generator/browser';
import { portableFromSerializable } from 'clock-generator/light';
import { expect, it, vi } from 'vitest';
import { names, show } from '../test/fixtures';
import { CHART_NAMES } from '../utils/a11yLabels';
import { defaultBuildViewContext, type TimelineViewContext } from '../utils/buildViewContext';
import { StateTransitionTimeline } from './StateTransitionTimeline';
import { TransferHistoryVisualization } from './TransferHistoryVisualization';

// Canvas geometry has its own tests; these read the rows' names and tooltips, and drive the controls above them.
function entity(type: SerializableEntityStateTransitions['entity_type'], statuses: string[]): SerializableEntityStateTransitions {
    return { entity_id: `${type}:1`, entity_type: type, label: `${type} one`, items: ['iron-plate'], initial_status: statuses[0], initial_factorio_state: 'working', factorio_states: [],
        transitions: statuses.map((status, index) => ({ tick: index * 10, duration_ticks: 10, from_status: status, to_status: status, reason: 'test transition' })) };
}
const history: SerializableStateTransitionHistory = { total_duration_ticks: 40, entities: [
    entity('machine', ['WORKING', 'OUTPUT_FULL']), entity('inserter', ['PICKUP', 'TARGET_FULL']), entity('drill', ['WORKING', 'DISABLED']),
] };
const ROWS = ['machine one', 'inserter one', 'drill one'];
const GAME_NAMES = names({ 'iron-plate': 'Iron plate', 'copper-plate': 'Copper plate', 'stack-inserter': 'Stack inserter' });
const timeline = (): TimelineViewContext => defaultBuildViewContext().timeline;

/** The timeline as the page holds it: the options it changes come back to it */
function showStates(changes: Partial<TimelineViewContext> = {}, data = history) {
    const columns = portableFromSerializable(data);
    const onOptionsChange = vi.fn<(options: TimelineViewContext) => void>();
    function Page() {
        const [options, setOptions] = useState({ ...timeline(), ...changes });
        return <StateTransitionTimeline stateTransitionHistory={columns} options={options} onOptionsChange={next => { onOptionsChange(next); setOptions(next); }} />;
    }
    return { ...show(<Page />, { names: GAME_NAMES }), options: () => onOptionsChange.mock.lastCall![0] };
}

/** What a pointer resting on `element` is told: the open tooltip that names it, or the box it is in */
async function tooltipOf(user: UserEvent, element: Element) {
    const describes = (tooltip: Element) => screen.queryAllByLabelText(tooltip.textContent!).some(named => named.contains(element));
    await user.hover(element);
    const tooltip = await waitFor(() => {
        const open = screen.getAllByRole('tooltip').find(describes);
        expect(open).toBeDefined();
        return open!;
    });
    const text = tooltip.textContent;
    await user.unhover(element);
    await waitFor(() => expect(describes(tooltip)).toBe(false));
    return text;
}
/** Each row's "Transitions: shown/total", from the tooltip on its name */
async function transitions(user: UserEvent, rows = ROWS) {
    const counts = [];
    for (const row of rows) counts.push((await tooltipOf(user, screen.getByText(row))).match(/Transitions: (\d+\/\d+)/)?.[1]);
    return counts;
}
type Menu = BoundFunctions<typeof queries>;
/** Opens a toolbar menu, works in it and closes it again, as a pointer user does before reading the rows */
async function inMenu(user: UserEvent, name: 'Filter by status' | 'Filter entity types', work: (menu: Menu) => unknown) {
    await user.click(screen.getByRole('button', { name }));
    await work(within(screen.getByRole('menu')));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}
const ticked = (item: HTMLElement) => (within(item).getByRole('checkbox') as HTMLInputElement).checked;
const groupsIn = (menu: Menu) => menu.getAllByText(/ Statuses$/).map(heading => heading.textContent);
/** The detailed legend's chips for the statuses the tests hide */
const legend = () => screen.getAllByText(/^(Machine: Working|Inserter: Pickup|Drill: Working)/).map(chip => chip.textContent);
/** The rows that show, by their name or their timeline's */
const rowsShown = () => ROWS.filter(row => screen.queryByText(row) || screen.queryByRole('img', { name: CHART_NAMES.stateTimeline(row, 2) }));

it.each([
    { status: 'Working', nth: 0, kind: 'machine', ticks: [false, true], header: 'Machines (1) · 1/2 transitions', counts: ['1/2', '2/2', '2/2'],
        chips: ['Machine: Working (hidden)', 'Inserter: Pickup', 'Drill: Working'] },
    { status: 'Pickup', nth: 0, kind: 'inserter', ticks: [false], header: 'Inserters (1) · 1/2 transitions', counts: ['2/2', '1/2', '2/2'],
        chips: ['Machine: Working', 'Inserter: Pickup (hidden)', 'Drill: Working'] },
    { status: 'Working', nth: 1, kind: 'drill', ticks: [true, false], header: 'Mining Drills (1) · 1/2 transitions', counts: ['2/2', '2/2', '1/2'],
        chips: ['Machine: Working', 'Inserter: Pickup', 'Drill: Working (hidden)'] },
] as const)('applies the detailed $kind $status filter only to its own entity type', async ({ status, nth, kind, ticks, header, counts, chips }) => {
    const { user, options } = showStates({ viewMode: 'detailed' });
    await inMenu(user, 'Filter by status', async menu => {
        await user.click(menu.getAllByRole('menuitem', { name: status })[nth]);
        // a status of the same name on another type stays shown
        expect(menu.getAllByRole('menuitem', { name: status }).map(ticked)).toEqual(ticks);
    });
    expect(options().statuses).toEqual({ ...timeline().statuses, [kind]: timeline().statuses[kind].filter(shown => shown !== status.toUpperCase()) });
    expect(legend()).toEqual(chips);
    expect(screen.getByText(header)).toBeDefined();
    expect(await transitions(user)).toEqual(counts);
});

it('keeps the detailed statuses hidden on each type as the next type is filtered', async () => {
    const { user, options } = showStates({ viewMode: 'detailed' });
    await inMenu(user, 'Filter by status', async menu => {
        await user.click(menu.getAllByRole('menuitem', { name: 'Working' })[0]);
        await user.click(menu.getByRole('menuitem', { name: 'Pickup' }));
        await user.click(menu.getAllByRole('menuitem', { name: 'Working' })[1]);
        expect(menu.getAllByRole('menuitem', { name: /^(Working|Pickup)$/ }).map(ticked)).toEqual([false, false, false]);
    });
    const { statuses } = timeline();
    const without = (kind: 'machine' | 'inserter' | 'drill', status: string) => statuses[kind].filter(shown => shown !== status);
    expect(options().statuses).toEqual({ ...statuses, machine: without('machine', 'WORKING'), inserter: without('inserter', 'PICKUP'), drill: without('drill', 'WORKING') });
    expect(legend()).toEqual(['Machine: Working (hidden)', 'Inserter: Pickup (hidden)', 'Drill: Working (hidden)']);
    for (const header of ['Machines (1)', 'Inserters (1)', 'Mining Drills (1)']) expect(screen.getByText(`${header} · 1/2 transitions`)).toBeDefined();
    expect(await transitions(user)).toEqual(['1/2', '1/2', '1/2']);
});

it('shares simplified category visibility across types without changing detailed selections', async () => {
    const statuses = { ...timeline().statuses, machine: [] };
    const { user, options } = showStates({ statuses });
    await inMenu(user, 'Filter by status', menu => user.click(menu.getByRole('menuitem', { name: 'Active' })));
    expect(options().statuses).toEqual({ ...statuses, categories: statuses.categories.filter(category => category !== 'ACTIVE') });
    expect(screen.getByText('Active (hidden)')).toBeDefined();
    expect(await transitions(user)).toEqual(['1/2', '1/2', '1/2']);

    await user.click(screen.getByRole('button', { name: 'Detailed' }));
    expect(screen.getByText('Machine: Output Full (hidden)')).toBeDefined();
    expect(await transitions(user, ['machine one'])).toEqual(['0/2']);
});

it('All/None affect all statuses and categories, while entity filters hide matching rows and detailed groups', async () => {
    const { user, options } = showStates({ viewMode: 'detailed' });
    await inMenu(user, 'Filter by status', menu => user.click(menu.getByRole('button', { name: 'None' })));
    expect(Object.values(options().statuses)).toEqual([[], [], [], []]);
    expect(await transitions(user)).toEqual(['0/2', '0/2', '0/2']);
    await inMenu(user, 'Filter by status', async menu => {
        expect(groupsIn(menu)).toEqual(['Machine Statuses', 'Inserter Statuses', 'Drill Statuses']);
        await user.click(menu.getByRole('button', { name: 'All' }));
    });
    expect(options().statuses).toEqual(timeline().statuses);
    expect(await transitions(user)).toEqual(['2/2', '2/2', '2/2']);

    await inMenu(user, 'Filter entity types', menu => user.click(menu.getByRole('menuitem', { name: 'Inserters' })));
    await inMenu(user, 'Filter by status', menu => expect(groupsIn(menu)).toEqual(['Machine Statuses', 'Drill Statuses']));
    expect(screen.queryByText(/^Inserter: /)).toBeNull();
    expect(rowsShown()).toEqual(['machine one', 'drill one']);
});

it.each(['By Type', 'By Flow'])('uses the same filtered entities when sorted %s', async sort => {
    const { user } = showStates({ filters: { machine: true, inserter: true, drill: false } });
    await user.click(screen.getByRole('button', { name: sort }));
    expect(screen.getByRole('button', { name: sort }).getAttribute('aria-pressed')).toBe('true');
    expect(rowsShown()).toEqual(['machine one', 'inserter one']);
    expect(screen.getByText(/ · 2 entities$/)).toBeDefined();
});

it('retains state row routes, item icons, counts, initial status and accessible canvas names', async () => {
    const row = { ...history.entities[1], source: { entity_id: 'belt:2', entity_type: 'belt' as const, label: 'Input belt' },
        sink: { entity_id: 'machine:3', entity_type: 'machine' as const, label: 'Output machine' } };
    const { user } = showStates({}, { ...history, entities: [row] });
    expect(await tooltipOf(user, screen.getByText('inserter one'))).toBe('inserter oneFrom: Input beltTo: Output machineTransitions: 2/2Initial: Pickup');
    expect(screen.getByRole('img', { name: 'Iron plate' })).toBeDefined();
    // the type's picture is not read out: its row's name says it
    expect(screen.queryByRole('img', { name: 'Stack inserter' })).toBeNull();
    expect(screen.getByRole('presentation').getAttribute('src')).toBe('/icons/stack-inserter.png');
    expect(screen.getByRole('img', { name: CHART_NAMES.stateTimeline('inserter one', 2) })).toBeDefined();
});

it('retains transfer routes, item icons, totals, ticks and zero-duration transfers', async () => {
    const transfers: SerializableTransferHistory = { total_duration_ticks: 40, entities: [{ entity_id: 'inserter:1', entity_type: 'inserter', label: 'Transfer inserter',
        source: { entity_id: 'belt:2', label: 'Input belt' }, sink: { entity_id: 'machine:3', label: 'Output machine' }, transfers: [
            { item_name: 'iron-plate', start_tick: 0, end_tick: 10, amount: 3 }, { item_name: 'copper-plate', start_tick: 40, end_tick: 40, amount: 4 },
        ] }] };
    const { user } = show(<TransferHistoryVisualization transferHistory={transfers} />, { names: GAME_NAMES });
    const name = screen.getByText('Transfer inserter');
    expect(await tooltipOf(user, name)).toBe('Transfer inserterFrom: Input beltTo: Output machineTotal transferred: 7');
    for (const icon of ['Stack inserter', 'Copper plate', 'Iron plate']) expect(screen.getByRole('img', { name: icon })).toBeDefined();
    for (const item of ['Copper plate', 'Iron plate']) expect(screen.getByText(item)).toBeDefined();
    // a transfer's mark has no text or role of its own: it is drawn on the row's chart, beside the row's name
    const tips = [];
    for (const mark of name.parentElement!.parentElement!.nextElementSibling!.children) tips.push(await tooltipOf(user, mark));
    expect(tips).toEqual(['Iron plateAmount: 3Tick 0 → 10Duration: 10 ticks', 'Copper plateAmount: 4Tick 40 → 40Duration: 0 ticks']);
});
