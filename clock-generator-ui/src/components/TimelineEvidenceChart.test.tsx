import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineEntity, TimelineRecording } from 'clock-generator/browser';
import { TimelineEvidenceChart } from './TimelineEvidenceChart';
const inserter: TimelineEntity = { id: 'inserter:1', type: 'inserter', source: 'belt:1', sink: 'machine:1', items: ['iron-plate'], signals: [] };
const a: TimelineRecording = { version: 1, mode: 'clock', start_tick: 0, end_tick: 100, period_ticks: 100, requested_ticks: 100, ticks_before_recording: 1000, ticks_per_second: 60, copies: 1, truncated: false, entities: [inserter], events: [] };
it('shows deliveries and their rates for the selected clock without A/B labels', () => {
    const b: TimelineRecording = { ...a, events: [{ tick: 10, entity_id: inserter.id, kind: 'drop', item: 'iron-plate', amount: 16, source: 'belt:1', sink: 'machine:1' }] };
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={b} selected={inserter} groups={['transfers', 'throughput']} range={{ start: 0, end: 100 }} tick={20} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('Pickups ◆ / deliveries ●');
    expect(html).toContain('rolling 1 s');
    expect(html).toContain('16 items/s');
    expect(html).not.toContain('A/B');
    expect(html).not.toContain('B:');
    expect(html).not.toContain('Comparison clock');
});

const machine: TimelineEntity = { id: 'machine:1', type: 'machine', recipe: 'iron-gear-wheel', items: ['iron-gear-wheel'], signals: [
    { id: 'state', label: 'Machine state', group: 'state', unit: 'state', ticks: [0], values: ['working'] },
    { id: 'produced', label: 'Main product made since tick 0', group: 'production', unit: 'items', item: 'iron-gear-wheel', ticks: [0, 10], values: [0, 3] },
] };
it('shows products made and quantities while leaving craft internals in exact events', () => {
    const recording: TimelineRecording = { ...a, entities: [machine, inserter], events: [
        { tick: 10, entity_id: machine.id, kind: 'craft-complete', amount: 1 },
        { tick: 10, entity_id: machine.id, kind: 'productivity-payout', amount: 2 },
        { tick: 10, entity_id: machine.id, kind: 'produce', amount: 3, item: 'iron-gear-wheel' },
        { tick: 15, entity_id: inserter.id, kind: 'drop', amount: 3, item: 'iron-gear-wheel' },
    ] };
    const props = { recording, selected: machine, groups: ['state', 'transfers'] as const, range: { start: 0, end: 100 }, tick: 20, view: 'activity' as const, onTick() {}, onRange() {}, onZoom() {} };
    const html = renderToStaticMarkup(<TimelineEvidenceChart {...props} groups={[...props.groups]} />);
    expect(html).toContain('Products made');
    expect(html).toContain('3 items');
    expect(html).not.toContain('Craft starts / completions / payouts');
    expect(html).not.toContain('Pickups ◆ / deliveries ●');
    const connected = renderToStaticMarkup(<TimelineEvidenceChart {...props} groups={[...props.groups]} showConnections />);
    expect(connected).toContain('Pickups ◆ / deliveries ●');
});
it('keeps an empty products-made lane when no output was released', () => {
    const recording = { ...a, entities: [{ ...machine, signals: machine.signals.map(signal => signal.id === 'produced' ? { ...signal, ticks: [0], values: [0] } : signal) }] };
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={recording} selected={recording.entities[0]} groups={['transfers']} range={{ start: 0, end: 100 }} tick={20} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('Products made');
    expect(html).toContain('0 items');
});

it('keeps machine output buffers optional while retaining ingredient inventories by default', () => {
    const entity: TimelineEntity = { ...machine, signals: [...machine.signals,
        { id: 'input:iron-plate', label: 'Ingredient', group: 'inventory', unit: 'items', item: 'iron-plate', ticks: [0], values: [2] },
        { id: 'output:iron-gear-wheel', label: 'Output buffer', group: 'inventory', unit: 'items', item: 'iron-gear-wheel', ticks: [0], values: [3] },
    ] };
    const props = { recording: { ...a, entities: [entity] }, selected: entity, range: { start: 0, end: 100 }, tick: 0, view: 'activity' as const, onTick() {}, onRange() {}, onZoom() {} };
    const basic = renderToStaticMarkup(<TimelineEvidenceChart {...props} groups={['inventory']} />);
    expect(basic).toContain('Ingredient');
    expect(basic).not.toContain('Output buffer');
    const buffer = renderToStaticMarkup(<TimelineEvidenceChart {...props} groups={['buffers']} />);
    expect(buffer).toContain('Output buffer');
    expect(buffer).not.toContain('Ingredient');
});

it('explains per-copy, marked-span and cumulative quantities above the chart', () => {
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={{ ...a, copies: 5.5, entities: [machine] }} selected={machine} groups={['transfers']} range={{ start: 0, end: 100 }} tick={20} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('Charts show one modelled copy');
    expect(html).toContain('5.5');
    expect(html).toContain('+N means items made in the marked span');
    expect(html).toContain('Total by selected tick');
});
it('gives a local legend for the selected clock’s states in the visible range', () => {
    const aEntity = { ...machine, signals: [{ ...machine.signals[0], ticks: [0, 10, 30], values: ['working', 'item_ingredient_shortage', 'no_fuel'] }] };
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={{ ...a, entities: [aEntity] }} selected={aEntity} groups={['state']} range={{ start: 0, end: 20 }} tick={10} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('aria-label="State legend"');
    expect(html).toContain('Working');
    expect(html).toContain('Waiting for ingredients');
    expect(html).not.toContain('Waiting for fuel');
    expect(html).not.toContain('Item ingredient shortage');
});

it.each(['activity', 'transfers'] as const)('automatically shows every connected inserter for a belt in %s without enabling connections', view => {
    const belt: TimelineEntity = { id: 'belt:3', type: 'belt', items: ['iron-plate'], signals: [] };
    const attached = [7, 8].map(id => ({ ...inserter, id: `inserter:${id}`, source: `machine:${id}`, sink: belt.id, signals: [
        { id: 'state', label: 'Inserter state', group: 'state' as const, unit: 'state' as const, ticks: [0], values: ['working'] },
    ] }));
    const unrelated = { ...inserter, id: 'inserter:9', source: 'belt:4', sink: 'machine:9' };
    const recording = { ...a, entities: [belt, ...attached, unrelated], events: attached.map(entity => ({ tick: 10, entity_id: entity.id, kind: 'drop' as const, item: 'iron-plate', amount: 16, source: entity.source, sink: belt.id })) };
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={recording} selected={belt} groups={['state', 'transfers']} range={{ start: 0, end: 100 }} tick={20} view={view} showConnections={false} onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('Inserter 7');
    expect(html).toContain('Inserter 8');
    expect(html).not.toContain('Inserter 9');
    expect(html.match(/Pickups ◆ \/ deliveries ●<\/p>/g)).toHaveLength(2);
    expect(html).not.toContain('No selected signals');
});

it('explains an unconnected belt instead of suggesting nonexistent belt signals', () => {
    const belt: TimelineEntity = { id: 'belt:3', type: 'belt', items: [], signals: [] };
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={{ ...a, entities: [belt] }} selected={belt} groups={['state', 'transfers']} range={{ start: 0, end: 100 }} tick={20} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('No recorded inserters are connected to this belt.');
});
