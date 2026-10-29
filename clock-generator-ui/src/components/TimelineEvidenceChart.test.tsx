// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import type { TimelineEntity, TimelineRecording } from 'clock-generator/browser';
import { expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { TimelineEvidenceChart } from './TimelineEvidenceChart';

type Props = Parameters<typeof TimelineEvidenceChart>[0];
const chart = (props: Pick<Props, 'recording' | 'selected' | 'groups'> & Partial<Props>) =>
    <TimelineEvidenceChart range={{ start: 0, end: 100 }} tick={20} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} {...props} />;
// each lane's canvas is named by the lane's label and the span it draws
const lanes = () => screen.queryAllByRole('img').map(lane => lane.getAttribute('aria-label'));
const lane = (label: string) => `${label}, 0 to 100 ticks. Values are available in the tick inspector.`;

const inserter: TimelineEntity = { id: 'inserter:1', type: 'inserter', source: 'belt:1', sink: 'machine:1', items: ['iron-plate'], signals: [] };
const a: TimelineRecording = { version: 1, mode: 'clock', start_tick: 0, end_tick: 100, period_ticks: 100, requested_ticks: 100, ticks_before_recording: 1000, ticks_per_second: 60, copies: 1, truncated: false, entities: [inserter], events: [] };
const machine: TimelineEntity = { id: 'machine:1', type: 'machine', recipe: 'iron-gear-wheel', items: ['iron-gear-wheel'], signals: [
    { id: 'state', label: 'Machine state', group: 'state', unit: 'state', ticks: [0], values: ['working'] },
    { id: 'produced', label: 'Main product made since tick 0', group: 'production', unit: 'items', item: 'iron-gear-wheel', ticks: [0, 10], values: [0, 3] },
] };

it('shows deliveries and their rates for the selected clock without A/B labels', () => {
    const recording: TimelineRecording = { ...a, events: [{ tick: 10, entity_id: inserter.id, kind: 'drop', item: 'iron-plate', amount: 16, source: 'belt:1', sink: 'machine:1' }] };
    show(chart({ recording, selected: inserter, groups: ['transfers', 'throughput'] }));
    expect(lanes()).toEqual([lane('Pickups ◆ / deliveries ●'), lane('Delivered · iron-plate · rolling 1 s')]);
    expect(screen.getByText('16 items/s')).toBeDefined();
    expect(document.body.textContent).not.toMatch(/A\/B|B:|Comparison clock/);
});

it('shows products made and quantities while leaving craft internals in exact events', () => {
    const recording: TimelineRecording = { ...a, entities: [machine, inserter], events: [
        { tick: 10, entity_id: machine.id, kind: 'craft-complete', amount: 1 },
        { tick: 10, entity_id: machine.id, kind: 'productivity-payout', amount: 2 },
        { tick: 10, entity_id: machine.id, kind: 'produce', amount: 3, item: 'iron-gear-wheel' },
        { tick: 15, entity_id: inserter.id, kind: 'drop', amount: 3, item: 'iron-gear-wheel' },
    ] };
    const props = { recording, selected: machine, groups: ['state', 'transfers'] } satisfies Parameters<typeof chart>[0];
    const { rerender } = show(chart(props));
    // no lane of craft starts, completions or payouts, and the inserter it feeds only on request
    expect(lanes()).toEqual([lane('Machine state'), lane('Products made')]);
    expect(screen.getByText('Total by selected tick · 3 items')).toBeDefined();
    rerender(chart({ ...props, showConnections: true }));
    expect(lanes()).toEqual([lane('Machine state'), lane('Products made'), lane('Pickups ◆ / deliveries ●')]);
});

it.each([
    { why: 'of 5.5 copies', copies: 5.5, made: { ticks: [0, 10], values: [0, 3] }, cover: '5.5 copies', total: '3 items' },
    { why: 'kept empty when nothing was made', copies: 1, made: { ticks: [0], values: [0] }, cover: '1 copy', total: '0 items' },
])('explains per-copy, marked-span and cumulative quantities above a products-made lane $why', ({ copies, made, cover, total }) => {
    const entity = { ...machine, signals: machine.signals.map(signal => signal.id === 'produced' ? { ...signal, ...made } : signal) };
    show(chart({ recording: { ...a, copies, entities: [entity] }, selected: entity, groups: ['transfers'] }));
    expect(screen.getByText(`Charts show one modelled copy. Whole-build rates above cover ${cover}. +N means items made in the marked span; totals run from tick 0 to the selected tick.`)).toBeDefined();
    expect(lanes()).toEqual([lane('Products made')]);
    expect(screen.getByText(`Total by selected tick · ${total}`)).toBeDefined();
});

it('keeps machine output buffers optional while retaining ingredient inventories by default', () => {
    const entity: TimelineEntity = { ...machine, signals: [...machine.signals,
        { id: 'input:iron-plate', label: 'Ingredient', group: 'inventory', unit: 'items', item: 'iron-plate', ticks: [0], values: [2] },
        { id: 'output:iron-gear-wheel', label: 'Output buffer', group: 'inventory', unit: 'items', item: 'iron-gear-wheel', ticks: [0], values: [3] },
    ] };
    const props = { recording: { ...a, entities: [entity] }, selected: entity, tick: 0 };
    const { rerender } = show(chart({ ...props, groups: ['inventory'] }));
    expect(lanes()).toEqual([lane('Ingredient · iron-plate')]);
    rerender(chart({ ...props, groups: ['buffers'] }));
    expect(lanes()).toEqual([lane('Output buffer · iron-gear-wheel')]);
});

it('gives a local legend for the selected clock’s states in the visible range', () => {
    const entity = { ...machine, signals: [{ ...machine.signals[0], ticks: [0, 10, 30], values: ['working', 'item_ingredient_shortage', 'no_fuel'] }] };
    show(chart({ recording: { ...a, entities: [entity] }, selected: entity, groups: ['state'], range: { start: 0, end: 20 }, tick: 10 }));
    const legend = screen.getByRole('list', { name: 'State legend' });
    expect(within(legend).getAllByRole('listitem').map(state => state.textContent)).toEqual(['Working', 'Waiting for ingredients']);
    // a state past the range is left out, and none is shown by its id
    expect(document.body.textContent).not.toMatch(/Waiting for fuel|Item ingredient shortage/);
});

it.each(['activity', 'transfers'] as const)('automatically shows every connected inserter for a belt in %s without enabling connections', view => {
    const belt: TimelineEntity = { id: 'belt:3', type: 'belt', items: ['iron-plate'], signals: [] };
    const attached = [7, 8].map(id => ({ ...inserter, id: `inserter:${id}`, source: `machine:${id}`, sink: belt.id, signals: [
        { id: 'state', label: 'Inserter state', group: 'state' as const, unit: 'state' as const, ticks: [0], values: ['working'] },
    ] }));
    const unrelated = { ...inserter, id: 'inserter:9', source: 'belt:4', sink: 'machine:9' };
    const recording = { ...a, entities: [belt, ...attached, unrelated], events: attached.map(entity => ({ tick: 10, entity_id: entity.id, kind: 'drop' as const, item: 'iron-plate', amount: 16, source: entity.source, sink: belt.id })) };
    show(chart({ recording, selected: belt, groups: ['state', 'transfers'], view, showConnections: false }));
    expect(lanes()).toEqual([lane('Inserter state'), lane('Pickups ◆ / deliveries ●'), lane('Inserter state'), lane('Pickups ◆ / deliveries ●')]);
    expect(screen.getAllByText('Pickups ◆ / deliveries ●')).toHaveLength(2);
    // each lane is captioned by the inserter it records
    expect(screen.getAllByText(/^Inserter \d+$/).map(name => name.textContent)).toEqual(['Inserter 7', 'Inserter 7', 'Inserter 8', 'Inserter 8']);
    expect(screen.queryByText(/No selected signals/)).toBeNull();
});

it('explains an unconnected belt instead of suggesting nonexistent belt signals', () => {
    const belt: TimelineEntity = { id: 'belt:3', type: 'belt', items: [], signals: [] };
    show(chart({ recording: { ...a, entities: [belt] }, selected: belt, groups: ['state', 'transfers'] }));
    expect(lanes()).toEqual([]);
    expect(screen.getByText('No recorded inserters are connected to this belt.')).toBeDefined();
});
