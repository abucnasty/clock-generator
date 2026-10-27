import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { SerializableEntityStateTransitions, SerializableStateTransitionHistory, SerializableTransferHistory } from 'clock-generator/browser';
import { portableFromSerializable } from 'clock-generator/light';
import { StateTransitionTimeline } from './StateTransitionTimeline';
import { TransferHistoryVisualization } from './TransferHistoryVisualization';
import { defaultBuildViewContext, type TimelineViewContext } from '../utils/buildViewContext';

// Expose closed menus and tooltip content in a server-rendered test, calling the actual controls'
// handlers before rendering the controlled options again. Canvas geometry has its own tests.
const controls = vi.hoisted(() => ({ items: [] as { text: string; click(): void }[], buttons: new Map<string, () => void>(), titles: [] as string[] }));
vi.mock('@mui/material', async importOriginal => {
    const actual = await importOriginal<typeof import('@mui/material')>();
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const text = (children: ReactNode) => renderToStaticMarkup(createElement('span', null, children)).replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '');
    return { ...actual,
        Menu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
        MenuItem: ({ children, onClick }: { children: ReactNode; onClick(): void }) => {
            controls.items.push({ text: text(children), click: onClick }); return createElement('div', null, children);
        },
        Button: ({ children, onClick }: { children: ReactNode; onClick(): void }) => {
            controls.buttons.set(text(children), onClick); return createElement('button', { onClick }, children);
        },
        Tooltip: ({ children, title }: { children: ReactNode; title: ReactNode }) => { controls.titles.push(text(title)); return children; },
    };
});
function entity(type: SerializableEntityStateTransitions['entity_type'], statuses: string[]): SerializableEntityStateTransitions {
    return { entity_id: `${type}:1`, entity_type: type, label: `${type} one`, items: ['iron-plate'], initial_status: statuses[0], initial_factorio_state: 'working', factorio_states: [],
        transitions: statuses.map((status, index) => ({ tick: index * 10, duration_ticks: 10, from_status: status, to_status: status, reason: 'test transition' })) };
}
const history: SerializableStateTransitionHistory = { total_duration_ticks: 40, entities: [
    entity('machine', ['WORKING', 'OUTPUT_FULL']), entity('inserter', ['PICKUP', 'TARGET_FULL']), entity('drill', ['WORKING', 'DISABLED']),
] };
let options: TimelineViewContext;
function renderStates(data = history) {
    controls.items = []; controls.buttons.clear(); controls.titles = [];
    return renderToStaticMarkup(<StateTransitionTimeline stateTransitionHistory={portableFromSerializable(data)} options={options} onOptionsChange={next => { options = next; }} />);
}
function clickItem(text: string, occurrence = 0) {
    const item = controls.items.filter(item => item.text === text)[occurrence];
    expect(item, `menu item ${text}`).toBeDefined(); item.click();
}
beforeEach(() => { options = defaultBuildViewContext().timeline; });

it('keeps detailed groups in order and applies each status filter only to its own entity type', () => {
    options.viewMode = 'detailed';
    let html = renderStates();
    expect(html.indexOf('Machine Statuses')).toBeLessThan(html.indexOf('Inserter Statuses'));
    expect(html.indexOf('Inserter Statuses')).toBeLessThan(html.indexOf('Drill Statuses'));
    for (const prefix of ['Machine:', 'Inserter:', 'Drill:']) expect(html).toContain(prefix);
    clickItem('Working'); html = renderStates();
    expect(html).toContain('Machines (1) · 1/2 transitions');
    expect(options.statuses.machine).not.toContain('WORKING'); expect(options.statuses.drill).toContain('WORKING');
    expect(controls.titles.find(title => title.startsWith('machine one'))).toContain('Transitions: 1/2');
    clickItem('Pickup'); renderStates();
    expect(controls.titles.find(title => title.startsWith('inserter one'))).toContain('Transitions: 1/2');
    clickItem('Working', 1); html = renderStates();
    expect(controls.titles.find(title => title.startsWith('drill one'))).toContain('Transitions: 1/2');
    expect(html).toContain('Drill: Working (hidden)'); expect(html).toContain('Machine: Working (hidden)');
});
it('shares simplified category visibility across types without changing detailed selections', () => {
    options.statuses.machine = [];
    renderStates(); clickItem('Active');
    let html = renderStates();
    expect(options.statuses.machine).toEqual([]);
    expect(controls.titles.filter(title => title.includes('Transitions: 1/2'))).toHaveLength(3);
    expect(html).toContain('Active (hidden)');
    options.viewMode = 'detailed'; html = renderStates();
    expect(controls.titles.find(title => title.startsWith('machine one'))).toContain('Transitions: 0/2');
    expect(html).toContain('Machine: Output Full (hidden)');
});
it('All/None affect all statuses and categories, while entity filters hide matching rows and detailed groups', () => {
    options.viewMode = 'detailed';
    renderStates(); controls.buttons.get('None')!(); renderStates();
    expect(Object.values(options.statuses).every(statuses => statuses.length === 0)).toBe(true);
    expect(controls.titles.filter(title => title.includes('Transitions: 0/2'))).toHaveLength(3);
    controls.buttons.get('All')!(); renderStates();
    expect(Object.values(options.statuses).every(statuses => statuses.length > 0)).toBe(true);
    expect(controls.titles.filter(title => title.includes('Transitions: 2/2'))).toHaveLength(3);
    clickItem('Inserters'); const html = renderStates();
    expect(html).not.toContain('Inserter Statuses'); expect(html).not.toContain('Inserter: Pickup');
    expect(html).not.toContain('inserter one'); expect(html).toContain('machine one'); expect(html).toContain('drill one');
});
it('uses the same filtered entities for flow sorting and grouped sorting', () => {
    options.filters.drill = false;
    const grouped = renderStates(); options.sortMode = 'byRelationship'; const flow = renderStates();
    for (const html of [grouped, flow]) {
        expect(html).toContain('machine one'); expect(html).toContain('inserter one'); expect(html).not.toContain('drill one'); expect(html).toContain('2 entities');
    }
});
it('retains state row routes, item icons, counts, initial status and accessible canvas names', () => {
    const row = { ...history.entities[1], source: { entity_id: 'belt:2', entity_type: 'belt' as const, label: 'Input belt' },
        sink: { entity_id: 'machine:3', entity_type: 'machine' as const, label: 'Output machine' } };
    const html = renderStates({ ...history, entities: [row] });
    expect(controls.titles).toContain('inserter oneFrom: Input beltTo: Output machineTransitions: 2/2Initial: Pickup');
    expect(html).toContain('iron-plate'); expect(html).toContain('stack-inserter');
    expect(html).toContain('aria-label="inserter one state timeline, 2 changes"');
});
it('retains transfer routes, item icons, totals, ticks and zero-duration transfers', () => {
    const transfers: SerializableTransferHistory = { total_duration_ticks: 40, entities: [{ entity_id: 'inserter:1', entity_type: 'inserter', label: 'Transfer inserter',
        source: { entity_id: 'belt:2', label: 'Input belt' }, sink: { entity_id: 'machine:3', label: 'Output machine' }, transfers: [
            { item_name: 'iron-plate', start_tick: 0, end_tick: 10, amount: 3 }, { item_name: 'copper-plate', start_tick: 40, end_tick: 40, amount: 4 },
        ] }] };
    controls.titles = [];
    const html = renderToStaticMarkup(<TransferHistoryVisualization transferHistory={transfers} />);
    expect(controls.titles).toContain('Transfer inserterFrom: Input beltTo: Output machineTotal transferred: 7');
    expect(controls.titles.some(title => title.includes('Tick 40 → 40Duration: 0 ticks'))).toBe(true);
    expect(html).toContain('copper-plate'); expect(html).toContain('iron-plate'); expect(html).toContain('stack-inserter');
});
