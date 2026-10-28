// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import type { OutputTransferSummary } from 'clock-generator/browser';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { belt, drill, inserter, machine, names, show } from '../test/fixtures';
import type { InserterFormData } from '../utils/configForm/formData';
import type { ResultTargetBuild } from '../utils/resultTarget';
import { InputRoutesPanel } from './InputRoutesPanel';

type Endpoint = InserterFormData['source'];
const BELT_2 = { type: 'belt', id: 2 } as const, MACHINE_9 = { type: 'machine', id: 9 } as const;
const lane = (ingredient: string) => ({ ingredient, stack_size: 4 });
/** An inserter into machine 1 */
const into = (id: number, source: Endpoint, fields: Partial<InserterFormData> = {}) => inserter(id, { source, sink: { type: 'machine', id: 1 }, ...fields });
/** Machine 1 smelts with fuel, next to belt 2 of iron and copper */
const build = (fields: Partial<ResultTargetBuild> = {}): ResultTargetBuild => ({
    machines: [machine(1, { recipe: 'smelt', fuel: 'fuel' })], belts: [belt(2, { lanes: [lane('iron'), lane('copper')] })], chests: [], inserters: [], drills: [], ...fields,
});
/** What the engine says came of one item a source made: placed straight into machine 1, unless told otherwise */
const summary = (source: OutputTransferSummary['source'], item: string, direct: OutputTransferSummary['results'][number]['direct'], fields: Partial<OutputTransferSummary> = {}): OutputTransferSummary => ({
    source, physical_target: { type: 'machine', id: 1 }, mechanism: 'result-placement', status: 'known',
    results: [{ item_name: item, direct, inserters: [], coverage: direct === 'accepted' ? 'covered' : 'unknown' }], ...fields,
});

function showRoutes(props: Partial<ComponentProps<typeof InputRoutesPanel>> = {}) {
    const onEditInserter = vi.fn();
    const view = show(<InputRoutesPanel machineId={1} build={build()} inputs={['iron', 'fuel']} transfers={[]} onEditInserter={onEditInserter} {...props} />,
        { names: names({ iron: 'Iron', copper: 'Copper', fuel: 'Fuel' }) });
    return { ...view, onEditInserter };
}
const input = (name: string) => within(screen.getByRole('group', { name }));
const NONE = 'No known incoming route', UNAVAILABLE = 'Input routes unavailable';
/** What the Iron and Fuel rows say in place of a route, null where one reaches them */
const noRoutes = () => ['Iron', 'Fuel'].map(name => input(name).queryByText(new RegExp(`^(${NONE}|${UNAVAILABLE})$`))?.textContent ?? null);

it('shows configured belt routes only for recipe/fuel inputs and preserves source filtering', async () => {
    const { user, onEditInserter } = showRoutes({ build: build({ inserters: [into(4, BELT_2, { filters: ['iron'] })] }) });
    expect(screen.getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual(['Iron', 'Fuel']);
    expect(input('Iron').getByText('From Belt 2')).toBeDefined();
    expect(noRoutes()).toEqual([null, NONE]);
    expect(screen.queryByText(/Copper/)).toBeNull();
    await user.click(input('Iron').getByRole('button', { name: 'Edit Inserter 4' }));
    expect(onEditInserter).toHaveBeenCalledExactlyOnceWith(4);
});

it('omits blacklisted source items and shows accepted direct and drill-drop routes only', () => {
    showRoutes({ build: build({ inserters: [into(5, BELT_2, { filters: ['copper'], filter_mode: 'blacklist' })] }), transfers: [
        summary({ type: 'machine', id: 8 }, 'iron', 'accepted'),
        summary({ type: 'machine', id: 9 }, 'fuel', 'rejected'),
        summary({ type: 'machine', id: 10 }, 'fuel', 'unknown'),
        summary({ type: 'drill', id: 3 }, 'fuel', 'accepted', { mechanism: 'mining-drop' }),
    ] });
    expect(input('Iron').getByText('Direct machine output: Machine 8')).toBeDefined();
    expect(input('Iron').getByText('From Belt 2')).toBeDefined();
    expect(input('Fuel').getByText('Drill drop: Drill 3')).toBeDefined();
    expect(screen.queryByText(/Machine (9|10)/)).toBeNull();
    expect(screen.queryByText(/Copper/)).toBeNull();
});

const NOTICES = ['Input route details unavailable', 'Some input route details unavailable'];
it.each([
    { why: 'no route evidence was given', transfers: null, notice: NOTICES[0], fallback: UNAVAILABLE },
    { why: 'a summary into the machine is unavailable', transfers: [summary({ type: 'machine', id: 8 }, 'iron', 'unknown', { status: 'unavailable' })],
        notice: NOTICES[1], fallback: UNAVAILABLE },
    // the known empty input: no route, and nothing missing that could have one
    { why: 'only an unrelated summary is unavailable', transfers: [summary({ type: 'machine', id: 77 }, 'iron', 'unknown', { physical_target: null, status: 'unavailable' })],
        notice: undefined, fallback: NONE },
])('keeps unavailable route metadata distinct from a known empty input when $why', ({ transfers, notice, fallback }) => {
    showRoutes({ transfers });
    expect(NOTICES.filter(text => screen.queryByText(text))).toEqual(notice ? [notice] : []);
    expect(noRoutes()).toEqual([fallback, fallback]);
});

it.each([
    { why: 'its source is gone', build: build({ belts: [], inserters: [into(8, { type: 'belt', id: 99 })] }), id: 8,
        line: 'Configured source connection: Belt 99 → Machine 1 · source items unavailable or none inferred', fallbacks: [NONE, NONE] },
    { why: 'its filters exclude every source item', build: build({ inserters: [into(12, BELT_2, { filters: ['not-on-belt'] })] }), id: 12,
        line: 'Configured source connection: Belt 2 → Machine 1 · all inferred items excluded by inserter filters', fallbacks: [NONE, NONE] },
    { why: 'it moves an item the machine does not take', build: build({ inserters: [into(6, BELT_2)] }), id: 6,
        line: 'Copper · Configured source connection: Belt 2 → Machine 1 · item not in known inputs', fallbacks: [null, NONE] },
    // the engine reports routes out of a machine; without its summary no input can be said to have none
    { why: 'its source machine has no transfer summary', build: build({ inserters: [into(11, MACHINE_9)] }), id: 11,
        line: 'Configured machine inserter: Machine 9 → Machine 1 · item route unavailable', fallbacks: [UNAVAILABLE, UNAVAILABLE] },
])('keeps an inserter visible and editable when $why', async ({ build, id, line, fallbacks }) => {
    const { user, onEditInserter } = showRoutes({ build });
    expect(screen.getByText('Unassigned configured connections')).toBeDefined();
    expect(screen.getByText(line)).toBeDefined();
    expect(noRoutes()).toEqual(fallbacks);
    // the unassigned list comes after the inputs
    await user.click(screen.getAllByRole('button', { name: `Edit Inserter ${id}` }).at(-1)!);
    expect(onEditInserter).toHaveBeenCalledExactlyOnceWith(id);
});

it('retains a configured fuel input from source facts even when the machine form has no fuel field', () => {
    showRoutes({ build: build({ machines: [machine(1, { recipe: 'smelt' })], belts: [belt(2, { lanes: [lane('fuel')] })], inserters: [into(7, BELT_2)] }) });
    expect(input('Fuel').getByText('From Belt 2')).toBeDefined();
});

it('keeps explicit inserter route facts when a machine transfer summary is otherwise unavailable', () => {
    showRoutes({ build: build({ inserters: [into(10, MACHINE_9)] }), transfers: [summary(MACHINE_9, 'iron', 'unknown', {
        physical_target: null, status: 'unavailable',
        results: [{ item_name: 'iron', direct: 'unknown', inserters: [{ inserter_id: 10, target: { type: 'machine', id: 1 } }], coverage: 'unknown' }],
    })] });
    expect(input('Iron').getByText('Configured machine inserter: Machine 9 → Machine 1')).toBeDefined();
    expect(screen.getByText(NOTICES[1])).toBeDefined();
});

it('shows configured direct and drill targets as unassigned when their transfer DTOs are absent', () => {
    showRoutes({ build: build({
        machines: [machine(1, { recipe: 'smelt' }), machine(13, { recipe: 'ore', result_target: { type: 'machine', id: 1 } })],
        drills: [drill(14, { mined_item_name: 'iron' })],
    }) });
    expect(screen.getByText('Configured direct output: Machine 13 → Machine 1 · acceptance unavailable')).toBeDefined();
    expect(screen.getByText('Configured drill drop: Drill 14 → Machine 1 · acceptance unavailable')).toBeDefined();
    expect(noRoutes()).toEqual([UNAVAILABLE, UNAVAILABLE]);
    expect(screen.queryByText(/^(Direct machine output|Drill drop):/)).toBeNull();
});
