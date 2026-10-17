import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineEntity, TimelineRecording } from 'clock-generator/browser';
import { DEFAULT_INSPECTION } from '../utils/timelineInspection';
import { TimelineTickInspector } from './TimelineTickInspector';
const entity: TimelineEntity = { id: 'machine:1', type: 'machine', items: ['iron-plate'], signals: [
    { id: 'input:iron-ore', label: 'Ingredient', item: 'iron-ore', group: 'inventory', unit: 'items', ticks: [0], values: [2] },
    { id: 'state', label: 'Machine state', group: 'state', unit: 'state', ticks: [0], values: ['item_ingredient_shortage'] },
    { id: 'produced', label: 'Main product made since tick 0', group: 'production', unit: 'items', item: 'iron-plate', ticks: [0], values: [4] },
    { id: 'output:iron-plate', label: 'Output buffer', group: 'inventory', unit: 'items', ticks: [0], values: [3] },
    { id: 'craft', label: 'Craft progress', group: 'progress', unit: '%', ticks: [0], values: [30] },
] };
const recording = { end_tick: 50 } as TimelineRecording;
it('keeps displayed facts first and advanced facts in a collapsed disclosure', () => {
    const html = renderToStaticMarkup(<TimelineTickInspector recording={recording} entity={entity} inspection={{ ...DEFAULT_INSPECTION, view: 'activity' }} tick={10} events={[]} connected={[]} onEntityChange={() => {}} />);
    const disclosure = html.match(/<details[^>]*data-inspector-details[^>]*>/)?.[0];
    expect(disclosure).toBeDefined();
    expect(disclosure).not.toMatch(/\bopen(?:=|\s|>)/);
    const [visible, advanced] = html.split(disclosure!);
    expect(visible).toContain('Ingredient');
    expect(visible).toContain('Waiting for ingredients');
    expect(visible).toContain('Total by selected tick');
    expect(visible).not.toContain('Output buffer');
    expect(visible).not.toContain('Craft progress');
    expect(advanced).toContain('More machine details');
    expect(advanced).toContain('Output buffer');
    expect(advanced).toContain('Craft progress');
});
it('promotes an enabled output-buffer signal from the disclosure to the first layer', () => {
    const html = renderToStaticMarkup(<TimelineTickInspector recording={recording} entity={entity} inspection={{ ...DEFAULT_INSPECTION, view: 'activity', signals: ['state', 'inventory', 'transfers', 'buffers'] }} tick={10} events={[]} connected={[]} onEntityChange={() => {}} />);
    const visible = html.split(/<details[^>]*data-inspector-details[^>]*>/)[0];
    expect(visible).toContain('Output buffer');
});
it('does not extrapolate facts or events beyond the recorded span', () => {
    const html = renderToStaticMarkup(<TimelineTickInspector recording={recording} entity={entity} inspection={{ ...DEFAULT_INSPECTION, view: 'activity' }} tick={51} events={[]} connected={[]} onEntityChange={() => {}} />);
    expect(html).toContain('outside its recorded span');
    expect(html).not.toContain('Total by selected tick');
    expect(html).not.toContain('Craft progress');
});
