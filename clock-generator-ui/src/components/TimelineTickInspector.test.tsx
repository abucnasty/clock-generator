// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { TimelineEntity, TimelineRecording } from 'clock-generator/browser';
import { show } from '../test/fixtures';
import { DEFAULT_INSPECTION, type TimelineInspection } from '../utils/timelineInspection';
import { TimelineTickInspector } from './TimelineTickInspector';

const entity: TimelineEntity = { id: 'machine:1', type: 'machine', items: ['iron-plate'], signals: [
    { id: 'input:iron-ore', label: 'Ingredient', item: 'iron-ore', group: 'inventory', unit: 'items', ticks: [0], values: [2] },
    { id: 'state', label: 'Machine state', group: 'state', unit: 'state', ticks: [0], values: ['item_ingredient_shortage'] },
    { id: 'produced', label: 'Main product made since tick 0', group: 'production', unit: 'items', item: 'iron-plate', ticks: [0], values: [4] },
    { id: 'output:iron-plate', label: 'Output buffer', group: 'inventory', unit: 'items', ticks: [0], values: [3] },
    { id: 'craft', label: 'Craft progress', group: 'progress', unit: '%', ticks: [0], values: [30] },
] };
const recording = { end_tick: 50 } as TimelineRecording;
type Props = Parameters<typeof TimelineTickInspector>[0];
const inspect = ({ inspection, ...overrides }: Partial<Omit<Props, 'inspection'>> & { inspection?: Partial<TimelineInspection> } = {}) =>
    show(<TimelineTickInspector recording={recording} entity={entity} tick={10} events={[]} connected={[]} onEntityChange={() => {}} {...overrides}
        inspection={{ ...DEFAULT_INSPECTION, view: 'activity', ...inspection }} />);

/** The facts listed in `scope`, as `term: value`, in their order */
const facts = (scope: HTMLElement) => {
    const values = within(scope).queryAllByRole('definition');
    return within(scope).queryAllByRole('term').map((term, index) => `${term.textContent}: ${values[index].textContent}`);
};
const inspector = () => screen.getByRole('complementary', { name: 'Tick inspector' });

it.each([
    { when: 'buffers folded', signals: DEFAULT_INSPECTION.signals,
        shown: ['Ingredient · iron-ore: 2 items', 'Machine state: Waiting for ingredients', 'Total by selected tick · iron-plate: 4 items'],
        folded: ['Output buffer: 3 items', 'Craft progress: 30 %'] },
    { when: 'buffers enabled', signals: [...DEFAULT_INSPECTION.signals, 'buffers'],
        shown: ['Ingredient · iron-ore: 2 items', 'Machine state: Waiting for ingredients', 'Total by selected tick · iron-plate: 4 items', 'Output buffer: 3 items'],
        folded: ['Craft progress: 30 %'] },
] satisfies { when: string; signals: TimelineInspection['signals']; shown: string[]; folded: string[] }[])(
    'keeps displayed facts first and advanced facts in a collapsed disclosure, promoting an enabled output buffer ($when)', ({ signals, shown, folded }) => {
        inspect({ inspection: { signals } });
        const disclosure = screen.getByRole('group');
        expect(within(disclosure).getByText('More machine details')).toBeDefined();
        expect((disclosure as HTMLDetailsElement).open).toBe(false);
        expect(facts(disclosure)).toEqual(folded);
        expect(facts(inspector())).toEqual([...shown, ...folded]);
    });

it('does not extrapolate facts or events beyond the recorded span', () => {
    inspect({ tick: 51, events: [{ tick: 51, entity_id: entity.id, kind: 'produce', amount: 1, item: 'iron-plate' }] });
    expect(screen.getByText('The selected tick is outside its recorded span.')).toBeDefined();
    expect(facts(inspector())).toEqual([]);
    expect(screen.queryByText('Events at this tick')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
});

const belt: TimelineEntity = { id: 'belt:3', type: 'belt', items: ['advanced-circuit'], signals: [] };
it.each([
    { when: 'two inserters', connected: [7, 8].map(id => ({ id: `inserter:${id}`, type: 'inserter', items: ['advanced-circuit'], sink: belt.id, signals: [] })),
        says: 'All connected inserter routes are highlighted. Choose an inserter to inspect its activity.', follows: ['Inserter 7', 'Inserter 8'], to: ['inserter:7', 'inserter:8'] },
    { when: 'only itself', connected: [belt],
        says: 'No recorded inserter connections for this belt.', follows: [], to: [] },
] satisfies { when: string; connected: TimelineEntity[]; says: string; follows: string[]; to: string[] }[])(
    'shows belt context and all connected inserters instead of choosing the first route, never the belt itself (connected: $when)', async ({ connected, says, follows, to }) => {
        const onEntityChange = vi.fn();
        const { user } = inspect({ entity: belt, inspection: { view: 'flow', entityId: belt.id, replayFocus: true }, connected, onEntityChange });
        expect(screen.getByRole('heading', { name: 'Belt 3' })).toBeDefined();
        expect(screen.getByText(says)).toBeDefined();
        expect(screen.queryByText('Connected inserters') !== null).toBe(follows.length > 0);
        const routes = screen.queryAllByRole('button');
        expect(routes.map(route => route.textContent)).toEqual(follows);
        for (const route of routes) await user.click(route);
        expect(onEntityChange.mock.calls).toEqual(to.map(id => [id]));
    });
