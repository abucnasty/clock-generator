import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineEntity, TimelineRecording } from 'clock-generator/browser';
import { TimelineEvidenceChart } from './TimelineEvidenceChart';
const inserter: TimelineEntity = { id: 'inserter:1', type: 'inserter', source: 'belt:1', sink: 'machine:1', items: ['iron-plate'], signals: [] };
const a: TimelineRecording = { version: 1, mode: 'clock', start_tick: 0, end_tick: 100, period_ticks: 100, requested_ticks: 100, ticks_before_recording: 1000, ticks_per_second: 60, copies: 1, truncated: false, entities: [inserter], events: [] };
it('retains comparison deliveries and their rates when A delivered nothing', () => {
    const b: TimelineRecording = { ...a, events: [{ tick: 10, entity_id: inserter.id, kind: 'drop', item: 'iron-plate', amount: 16, source: 'belt:1', sink: 'machine:1' }] };
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={a} comparison={b} selected={inserter} groups={['transfers', 'throughput']} range={{ start: 0, end: 100 }} tick={20} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('Pickups ◆ / deliveries ●');
    expect(html).toContain('rolling 1 s');
    expect(html).toContain('16 items/s');
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
    const props = { recording, comparison: null, selected: machine, groups: ['state', 'transfers'] as const, range: { start: 0, end: 100 }, tick: 20, view: 'activity' as const, onTick() {}, onRange() {}, onZoom() {} };
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
    const html = renderToStaticMarkup(<TimelineEvidenceChart recording={recording} comparison={null} selected={recording.entities[0]} groups={['transfers']} range={{ start: 0, end: 100 }} tick={20} view="activity" onTick={() => {}} onRange={() => {}} onZoom={() => {}} />);
    expect(html).toContain('Products made');
    expect(html).toContain('0 items');
});

it('keeps machine output buffers optional while retaining ingredient inventories by default', () => {
    const entity: TimelineEntity = { ...machine, signals: [...machine.signals,
        { id: 'input:iron-plate', label: 'Ingredient', group: 'inventory', unit: 'items', item: 'iron-plate', ticks: [0], values: [2] },
        { id: 'output:iron-gear-wheel', label: 'Output buffer', group: 'inventory', unit: 'items', item: 'iron-gear-wheel', ticks: [0], values: [3] },
    ] };
    const props = { recording: { ...a, entities: [entity] }, comparison: null, selected: entity, range: { start: 0, end: 100 }, tick: 0, view: 'activity' as const, onTick() {}, onRange() {}, onZoom() {} };
    const basic = renderToStaticMarkup(<TimelineEvidenceChart {...props} groups={['inventory']} />);
    expect(basic).toContain('Ingredient');
    expect(basic).not.toContain('Output buffer');
    const buffer = renderToStaticMarkup(<TimelineEvidenceChart {...props} groups={['buffers']} />);
    expect(buffer).toContain('Output buffer');
    expect(buffer).not.toContain('Ingredient');
});
