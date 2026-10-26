import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChestType } from 'clock-generator/light';
import { InsertersForm } from './InsertersForm';
import type { InserterFormData } from '../hooks/useConfigForm';

/** A machine emptied into a chest by an inserter whose filters were captured as a blacklist of iron plates */
const blacklist: InserterFormData = { id: 2, _uuid: 'inserter-2', source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 },
    filters: ['iron-plate'], filter_mode: 'blacklist' };

function render(filters: boolean, inserter: InserterFormData = blacklist, editRoute = false) {
    return renderToStaticMarkup(<InsertersForm focusRequest={filters || editRoute ? { id: 2, filters } : null} inserters={[inserter]}
        machines={[{ id: 1, _uuid: 'machine-1', recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }]} belts={[]}
        chests={[{ id: 1, _uuid: 'chest-1', type: ChestType.INFINITY_CHEST, item_filter: [], remove_unfiltered_items: true }]}
        itemNames={['iron-plate', 'iron-gear-wheel']} getRecipeInfo={() => null} onAdd={() => {}} onUpdate={() => {}} onRemove={() => {}}
        onReorder={() => {}} onDuplicate={() => {}} onBulkUpdate={() => {}} />);
}

it('names a captured blacklist in the Filters view that Review filters opens, with what to do about it', () => {
    const html = render(true);
    expect(html).toContain('Blacklist, not supported');
    expect(html).toContain('use automatic filters, or set a whitelist in the game and recapture');
    expect(html).not.toContain('Explicit filters');
    expect(render(true, { ...blacklist, filter_mode: undefined })).toContain('Explicit filters');
});

it('shows a read-only route preview with explicit and excluded filter modes', () => {
    const excluded = render(false);
    expect(excluded).toContain('Blacklist · Excluded');
    expect(excluded).toContain('Blacklist · Not supported');
    expect(render(false, { ...blacklist, filter_mode: undefined })).toContain('Explicit filters');
    expect(excluded).toContain('Source:');
    expect(excluded).toContain('Destination:');
    expect(excluded).not.toContain('role="combobox"');
});

it('reveals the existing source and destination editors in General for a route navigation request', () => {
    const html = render(false, blacklist, true);
    expect(html).toContain('aria-label="Source, Inserter 2"');
    expect(html).toContain('aria-label="Destination, Inserter 2"');
    expect(html).toContain('Inserter 2 entity details');
    expect(html).toContain('General');
});
