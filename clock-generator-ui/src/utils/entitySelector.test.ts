import { expect, it } from 'vitest';
import { entitySelectorKey, filterEntityOptions, type EntitySelectorOption } from './entitySelector';

const options: EntitySelectorOption[] = [
    { type: 'belt', id: 1, label: 'Belt 1', icon: 'turbo-transport-belt', ingredientIcons: ['iron-plate'] },
    { type: 'machine', id: 1, label: 'Machine 1', sublabel: 'Casting copper cable', icon: 'foundry', ingredientIcons: ['casting-copper-cable'] },
    { type: 'machine', id: 2, label: 'Machine 2', sublabel: 'Advanced circuit', icon: 'assembling-machine-3', ingredientIcons: ['advanced-circuit'] },
    { type: 'inserter', id: 1, label: 'Inserter 1', icon: 'stack-inserter', ingredientIcons: ['iron-plate'] },
];
const item = (id: string) => id === 'iron-plate' ? 'Plaque de fer' : id;
it('combines type filters with recipe, item-id and translated item searches', () => {
    expect(filterEntityOptions(options, 'machine', 'copper', item).map(entitySelectorKey)).toEqual(['machine:1']);
    expect(filterEntityOptions(options, 'all', 'advanced-circuit', item).map(entitySelectorKey)).toEqual(['machine:2']);
    expect(filterEntityOptions(options, 'inserter', 'Plaque de fér', item).map(entitySelectorKey)).toEqual(['inserter:1']);
    expect(filterEntityOptions(options, 'machine', 'Plaque de fer', item)).toEqual([]);
});
it('keeps entity types with matching numbers distinct, and never changes the selection data while filtering', () => {
    expect(new Set(options.map(entitySelectorKey)).size).toBe(options.length);
    expect(filterEntityOptions(options, 'belt', '', item)).toEqual([options[0]]);
    expect(options[1].sublabel).toBe('Casting copper cable');
    expect(options.length).toBe(4);
});
