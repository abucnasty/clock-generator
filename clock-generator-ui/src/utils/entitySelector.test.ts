import { expect, it } from 'vitest';
import { entitySelectorKey, searchEntityOptions, type EntitySelectorOption } from './entitySelector';

const options: EntitySelectorOption[] = [
    { type: 'belt', id: 1, label: 'Belt 1', icon: 'turbo-transport-belt', ingredientIcons: ['iron-plate'] },
    { type: 'machine', id: 1, label: 'Machine 1', sublabel: 'Casting copper cable', icon: 'foundry', ingredientIcons: ['casting-copper-cable'] },
    { type: 'machine', id: 2, label: 'Machine 2', sublabel: 'Advanced circuit', icon: 'assembling-machine-3', ingredientIcons: ['advanced-circuit'] },
    { type: 'inserter', id: 1, label: 'Inserter 1', icon: 'stack-inserter', ingredientIcons: ['iron-plate'] },
];
const item = (id: string) => id === 'iron-plate' ? 'Plaque de fer' : id;
it('searches across all entity types using recipes, item IDs and translated names', () => {
    expect(searchEntityOptions(options, 'copper', item).map(entitySelectorKey)).toEqual(['machine:1']);
    expect(searchEntityOptions(options, 'advanced-circuit', item).map(entitySelectorKey)).toEqual(['machine:2']);
    expect(searchEntityOptions(options, 'Plaque de fér', item).map(entitySelectorKey)).toEqual(['inserter:1', 'belt:1']);
});
it('keeps entity types with matching numbers distinct, and never changes the selection data while searching', () => {
    expect(new Set(options.map(entitySelectorKey)).size).toBe(options.length);
    expect(searchEntityOptions(options, '', item).map(entitySelectorKey)).toEqual(['machine:1', 'machine:2', 'inserter:1', 'belt:1']);
    expect(options[1].sublabel).toBe('Casting copper cable');
    expect(options.length).toBe(4);
});
