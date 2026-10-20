import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChestType } from 'clock-generator/light';
import { InsertersForm } from './InsertersForm';
import type { InserterFormData } from '../hooks/useConfigForm';

/** A machine emptied into a chest by an inserter whose filters were captured as a blacklist of iron plates */
const blacklist: InserterFormData = { id: 2, _uuid: 'inserter-2', source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 },
    filters: ['iron-plate'], filter_mode: 'blacklist' };

function render(filters: boolean, inserter: InserterFormData = blacklist) {
    return renderToStaticMarkup(<InsertersForm focusRequest={filters ? { id: 2, filters: true } : null} inserters={[inserter]}
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

it('names a captured blacklist in the collapsed summary of the row', () => {
    expect(render(false)).toContain('Filters: Blacklist, not supported');
    expect(render(false, { ...blacklist, filter_mode: undefined })).toContain('Filters: Explicit');
});
