import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Config } from 'clock-generator/browser';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { FilterSlotSelector } from '../components/FilterSlotSelector';
import { configToFormData } from './configForm/configMapping';
import { inferInserterItems, sourceItemsOf } from './inferInserterItems';
import { entityOptionsOf, findOption } from './inserterOptions';
import { InserterEditor } from '../components/InserterEditor';

const recipes: Record<string, RecipeInfo> = {
    'lithium': { ingredients: ['holmium-plate'], results: ['lithium'] },
    'lithium-plate': { ingredients: ['lithium'], results: ['lithium-plate'] },
    'rocket-part': { ingredients: ['processing-unit', 'low-density-structure', 'rocket-fuel'], results: ['rocket-part'] },
};
const recipeInfo = (name: string) => recipes[name] ?? null;

function build(type: 'car' | 'tank' | 'cargo-wagon' | 'rocket-silo' = 'rocket-silo') {
    return configToFormData({
        target_output: { recipe: 'lithium-plate', items_per_second: 1, copies: 1 },
        machines: [
            { id: 1, recipe: 'lithium', crafting_speed: 1, productivity: 0 },
            { id: 2, recipe: 'lithium-plate', crafting_speed: 1, productivity: 0 },
        ],
        belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'copper-plate', stack_size: 1 }] }],
        chests: [{ id: 1, type }],
        inserters: [
            { id: 1, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 } },
            { id: 2, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 2 } },
        ],
    } satisfies Config);
}

describe('automatic filters through containers', () => {
    it.each(['car', 'tank', 'cargo-wagon', 'rocket-silo'] as const)('shows incoming supply on the %s selector even without configured contents or filters', type => {
        const form = build(type);
        const options = entityOptionsOf(form.machines, form.belts, form.chests, { item: id => id.toUpperCase(), recipe: id => id },
            { inserters: form.inserters, getRecipeInfo: recipeInfo });
        expect(findOption(options, 'chest', 1)).toMatchObject({ icon: type, sublabel: 'LITHIUM', ingredientIcons: ['lithium'] });
        expect(form.chests[0]).not.toHaveProperty('slot_filters');
        expect(form.chests[0]).not.toHaveProperty('contents');
    });

    it('updates selector indicators when incoming routes change, and says when no items are known', () => {
        const form = build('car');
        const option = () => findOption(entityOptionsOf(form.machines, form.belts, form.chests, { item: id => id, recipe: id => id },
            { inserters: form.inserters, getRecipeInfo: recipeInfo }), 'chest', 1);
        expect(option()?.ingredientIcons).toEqual(['lithium']);
        form.inserters[0].source = { type: 'belt', id: 1 };
        expect(option()?.ingredientIcons).toEqual(['copper-plate']);
        form.inserters.splice(0, 1);
        expect(option()).toMatchObject({ sublabel: 'No items inferred', ingredientIcons: undefined });
    });

    it('shows the current route in the selected silo field, separating incoming ingredients from outgoing cargo', () => {
        const form = build();
        const silo = form.chests[0];
        if (silo.type !== 'rocket-silo') throw new Error('not a silo');
        silo.contents = [{ item: 'lithium', count: 10 }, { item: 'copper-plate', count: 10 }];
        form.inserters[0].source = { type: 'belt', id: 1 };
        form.belts[0].lanes[0].ingredient = 'processing-unit';
        const render = (index: number) => renderToStaticMarkup(<InserterEditor value={form.inserters[index]} label={`Inserter ${index + 1}`}
            layout="stacked" machines={form.machines} belts={form.belts} chests={form.chests} inserters={form.inserters}
            itemNames={['lithium', 'copper-plate', 'processing-unit']} getRecipeInfo={recipeInfo} onChange={() => {}} />);
        expect(render(0)).toContain('value="Chest 1 - processing-unit"');
        expect(render(1)).toContain('value="Chest 1 - lithium"');
    });

    it('never advertises blocked slots as available items or automatic filters', () => {
        const form = build('car');
        const chest = form.chests[0];
        if (chest.type !== 'car') throw new Error('not a car');
        chest.slot_filters = [{ slot: 1, blocked: true, _marker: 'deconstruction-planner' }, { slot: 2, blocked: true }];
        expect(sourceItemsOf(form.inserters[1].source, form.machines, form.belts, form.chests, recipeInfo)).toEqual([]);
        expect(sourceItemsOf(form.inserters[1].source, form.machines, form.belts, form.chests, recipeInfo, form.inserters)).toEqual(['lithium']);
    });
    it.each(['car', 'tank', 'cargo-wagon', 'rocket-silo'] as const)('follows incoming supply through an empty %s', type => {
        const form = build(type);
        expect(inferInserterItems(form.inserters[1], form.machines, form.belts, form.chests, recipeInfo, form.inserters)).toEqual(['lithium']);
    });

    it('does not invent supply from the destination when the source has no contents or incoming route', () => {
        const form = build();
        expect(inferInserterItems(form.inserters[1], form.machines, form.belts, form.chests, recipeInfo, form.inserters.slice(1))).toEqual([]);
    });

    it('updates the inferred items when the incoming source or filters change', () => {
        const form = build();
        form.inserters[0].source = { type: 'belt', id: 1 };
        const supply = () => sourceItemsOf(form.inserters[1].source, form.machines, form.belts, form.chests, recipeInfo, form.inserters);
        expect(supply()).toEqual(['copper-plate']);
        form.inserters[0].filters = ['lithium'];
        expect(supply()).toEqual(['lithium']);
    });

    it('keeps rocket-part ingredients in the input inventory at normal recipe quality', () => {
        const form = build();
        form.inserters[0].filters = ['lithium', 'processing-unit'];
        const supply = () => sourceItemsOf(form.inserters[1].source, form.machines, form.belts, form.chests, recipeInfo, form.inserters);
        expect(supply()).toEqual(['lithium']);
        const chest = form.chests[0];
        if (chest.type !== 'rocket-silo') throw new Error('not a silo');
        chest.recipe_quality = 'rare';
        expect(supply()).toEqual(['lithium', 'processing-unit']);
    });

    it('includes slot filters and starting contents, restricted to the destination recipe', () => {
        const form = build('car');
        const chest = form.chests[0];
        if (chest.type !== 'car') throw new Error('not a car');
        form.chests[0] = { ...chest, slot_filters: [{ slot: 1, item: 'lithium' }], contents: [{ slot: 2, item: 'copper-plate', count: 10 }] };
        expect(sourceItemsOf(form.inserters[1].source, form.machines, form.belts, form.chests, recipeInfo)).toEqual(['copper-plate', 'lithium']);
        expect(inferInserterItems(form.inserters[1], form.machines, form.belts, form.chests, recipeInfo)).toEqual(['lithium']);
    });

    it('handles a container feeding itself without recursing or inventing stock', () => {
        const form = build();
        form.inserters[0].source = { type: 'chest', id: 1 };
        expect(sourceItemsOf(form.inserters[1].source, form.machines, form.belts, form.chests, recipeInfo, form.inserters)).toEqual([]);
    });
});

it('explains empty automatic slots without labelling explicit filters as uninferred', () => {
    const render = (filters?: string[]) => renderToStaticMarkup(<FilterSlotSelector filters={filters} itemNames={[]}
        onFilterChange={() => {}} onRemoveFilter={() => {}} />);
    expect(render()).toContain('No items inferred. Choose an item to set an explicit filter.');
    expect(render(['lithium'])).not.toContain('No items inferred');
});
