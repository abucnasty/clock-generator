import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChestType } from 'clock-generator/light';
import { InsertersForm } from './InsertersForm';
import type { InserterFormData } from '../hooks/useConfigForm';

const base: InserterFormData = { id: 2, _uuid: 'inserter-2', source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, filters: ['iron-plate', 'copper-plate'] };
const machine = { id: 1, _uuid: 'machine-1', recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 };
const chest = { id: 1, _uuid: 'chest-1', type: ChestType.INFINITY_CHEST, item_filter: [], remove_unfiltered_items: true };

function render(inserter: InserterFormData = base) {
    return renderToStaticMarkup(<InsertersForm inserters={[inserter]} machines={[machine]} belts={[]} chests={[chest]}
        itemNames={['iron-plate', 'copper-plate', 'iron-gear-wheel']} getRecipeInfo={() => null} onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}}
        onReorder={() => {}} onDuplicate={() => {}} onBulkUpdate={() => {}} />);
}

it('shows the editable source → five filter slots → destination workbench without a Routes/Filters toggle', () => {
    const html = render();
    expect(html).toContain('Source, Inserter 2');
    expect(html).toContain('Destination, Inserter 2');
    expect(html).toContain('aria-label="Inserter filter slots"');
    expect((html.match(/aria-label="(?:Filter \d+:[^"]*|Add filter \d+)"/g) ?? [])).toHaveLength(5);
    expect(html).toContain('/icons/iron-plate.png');
    expect(html).toContain('/icons/copper-plate.png');
    expect(html).not.toContain('Inserter view');
    expect(html).not.toContain('Routes</');
    expect(html).not.toContain('Filters</');
});

it('shows automatic filter mode and retains explicit item icons for multiple filters', () => {
    const html = render({ ...base, filters: undefined });
    expect(html).toContain('No items inferred. Choose an item to set an explicit filter.');
    expect(html).not.toContain('Use automatic filters');
    expect(html).toContain('aria-label="Add filter 5"');
    const explicit = render();
    expect(explicit.match(/\/icons\/iron-plate\.png/g)?.length).toBeGreaterThan(0);
    expect(explicit.match(/\/icons\/copper-plate\.png/g)?.length).toBeGreaterThan(0);
    expect(explicit).toContain('Use automatic filters');
    expect(explicit).not.toContain('Filters · Explicit');
});

it('explains that captured blacklists are unsupported', () => {
    expect(render({ ...base, filter_mode: 'blacklist' })).toContain('Blacklist · Not supported');
});

it('keeps an imported drop destination read-only', () => {
    const imported = { ...base, sink: { ...base.sink, drop: { lane: 1, position: 0.5 } } } as InserterFormData;
    const html = render(imported);
    expect(html).toContain('Destination, Inserter 2');
    expect(html).toContain('readOnly');
    expect(html).toContain('Imported geometry: route read-only.');
});

it('keeps advanced stack settings out of the default workbench view', () => {
    const html = render();
    expect(html).not.toContain('Stack size');
    expect(html).not.toContain('Pickup type');
    expect(html).not.toContain('Nearest lane');
});

it('keeps every imported filter editable when a legacy list exceeds five slots', () => {
    const html = render({ ...base, filters: ['iron-plate', 'copper-plate', 'iron-gear-wheel', 'battery', 'stone', 'coal'] });
    expect((html.match(/aria-label="Filter \d+:/g) ?? [])).toHaveLength(6);
    expect(html).toContain('/icons/coal.png');
    expect(html).not.toContain('Add filter 7');
});

it('retains unavailable endpoint identities in the editable route', () => {
    const html = render({ ...base, source: { type: 'machine', id: 99 }, sink: { type: 'chest', id: 98 } });
    expect(html).toContain('Machine 99 is unavailable.');
    expect(html).toContain('Chest 98 is unavailable.');
    expect(html).toContain('Use automatic filters');
});
