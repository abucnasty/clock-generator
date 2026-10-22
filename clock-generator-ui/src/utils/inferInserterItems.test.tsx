import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Config } from 'clock-generator/browser';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { FilterSlotSelector } from '../components/FilterSlotSelector';
import { configToFormData } from './configForm/configMapping';
import { inferInserterItems, sourceItemsOf } from './inferInserterItems';

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
        form.chests[0] = { ...form.chests[0], type: 'rocket-silo', recipe_quality: 'rare' };
        expect(supply()).toEqual(['lithium', 'processing-unit']);
    });

    it('includes slot filters and starting contents, restricted to the destination recipe', () => {
        const form = build('car');
        form.chests[0] = { ...form.chests[0], type: 'car', slot_filters: [{ slot: 1, item: 'lithium' }], contents: [{ slot: 2, item: 'copper-plate', count: 10 }] };
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
