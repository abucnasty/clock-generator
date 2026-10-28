// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { FilterSlotSelector } from '../components/FilterSlotSelector';
import { show } from '../test/fixtures';
import { configToFormData } from './configForm/configMapping';
import { drillItemsInto, inferInserterItems, itemsAround, sourceItemsOf } from './inferInserterItems';
import { buildFlowGraph, flowNodeEntity } from './buildFlowGraph';
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
        show(<>{form.inserters.map((value, index) => <InserterEditor key={value.id} value={value} label={`Inserter ${index + 1}`}
            layout="stacked" machines={form.machines} belts={form.belts} chests={form.chests} inserters={form.inserters}
            itemNames={['lithium', 'copper-plate', 'processing-unit']} getRecipeInfo={recipeInfo} onChange={vi.fn()} />)}</>);
        const field = (name: string) => screen.getByRole<HTMLInputElement>('combobox', { name }).value;
        expect(field('Destination, Inserter 1')).toBe('Rocket silo 1 - processing-unit');
        expect(field('Source, Inserter 2')).toBe('Rocket silo 1 - lithium');
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
    const slots = (filters?: string[]) => <FilterSlotSelector filters={filters} itemNames={[]} onFilterChange={vi.fn()} onRemoveFilter={vi.fn()} />;
    const { rerender } = show(slots());
    expect(screen.getByText('No items inferred. Choose an item to set an explicit filter.')).toBeDefined();
    rerender(slots(['lithium']));
    expect(screen.queryByText(/No items inferred/)).toBeNull();
    // nor in any name or description a screen reader announces: the group and every slot, filled or empty
    expect(screen.getByRole('group', { name: 'Inserter filter slots' })).toBeDefined();
    expect(screen.queryByRole('group', { name: /No items inferred/ })).toBeNull();
    expect(screen.queryByRole('group', { description: /No items inferred/ })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /No items inferred/ })).toEqual([]);
    expect(screen.queryAllByRole('button', { description: /No items inferred/ })).toEqual([]);
    expect(screen.getByRole('button', { name: 'Filter 1: lithium' })).toBeDefined();
    for (const slot of [2, 3, 4, 5]) expect(screen.getByRole('button', { name: `Add filter ${slot}` })).toBeDefined();
});

describe('a container filled by drills', () => {
    // the car build: a big mining drill drops iron ore into a car, two inserters take it to two furnaces
    const car = () => configToFormData({
        target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-plate', crafting_speed: 5, productivity: 0 }, { id: 2, recipe: 'iron-plate', crafting_speed: 5, productivity: 0 }],
        drills: { configs: [{ id: 1, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 0, target: { type: 'chest', id: 1 } }] },
        belts: [],
        inserters: [
            { id: 1, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 } },
            { id: 2, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 2 } },
        ],
        chests: [{ id: 1, type: 'car' }, { id: 2, type: 'tank' }],
    } satisfies Config);
    const smelting: Record<string, RecipeInfo> = { 'iron-plate': { ingredients: ['iron-ore'], results: ['iron-plate'] } };
    const smeltingInfo = (name: string) => smelting[name] ?? null;

    it("infers the drill's ore for the car's takers, as the engine counts it", () => {
        const form = car(), drills = form.drills!.configs;
        expect(drillItemsInto(1, drills)).toEqual(['iron-ore']);
        expect(sourceItemsOf({ type: 'chest', id: 1 }, form.machines, form.belts, form.chests, smeltingInfo, form.inserters, drills)).toEqual(['iron-ore']);
        for (const taker of form.inserters) {
            expect(inferInserterItems(taker, form.machines, form.belts, form.chests, smeltingInfo, form.inserters, undefined, drills)).toEqual(['iron-ore']);
            expect(itemsAround(taker, form.machines, form.belts, form.chests, smeltingInfo, form.inserters, undefined, drills)).toContain('iron-ore');
        }
        // without the drills, nothing is known of the car: what the form showed before
        expect(inferInserterItems(form.inserters[0], form.machines, form.belts, form.chests, smeltingInfo, form.inserters)).toEqual([]);
    });

    it("shows the ore on the car's option, with or without the incoming routes, and not on another container", () => {
        const form = car(), drills = form.drills!.configs;
        const labels = { item: (id: string) => id.toUpperCase(), recipe: (id: string) => id };
        for (const context of [{ inserters: form.inserters, getRecipeInfo: smeltingInfo, drills }, { drills }]) {
            const options = entityOptionsOf(form.machines, form.belts, form.chests, labels, context);
            expect(findOption(options, 'chest', 1)).toMatchObject({ icon: 'car', sublabel: 'IRON-ORE', ingredientIcons: ['iron-ore'] });
            expect(findOption(options, 'chest', 2)).toMatchObject({ sublabel: 'No items inferred', ingredientIcons: undefined });
        }
    });

    it('follows the drill: retargeted, without a resource, or into a machine, it puts nothing into the car', () => {
        const form = car(), drill = form.drills!.configs[0];
        const into = (changes: Partial<typeof drill>) => sourceItemsOf({ type: 'chest', id: 1 }, form.machines, form.belts, form.chests, smeltingInfo, form.inserters, [{ ...drill, ...changes }]);
        expect(into({ target: { type: 'chest', id: 2 } })).toEqual([]);
        expect(into({ mined_item_name: '' })).toEqual([]);
        expect(into({ target: { type: 'machine', id: 1 } })).toEqual([]);
        expect(into({ mined_item_name: 'copper-ore' })).toEqual(['copper-ore']);
    });

    it("draws the ore on the car's diagram node and on its takers", () => {
        const form = car();
        const { nodes } = buildFlowGraph(form.machines, form.inserters, form.belts, form.chests, form.drills!.configs, smeltingInfo);
        const icons = (type: string, id: number) => nodes.filter(node => flowNodeEntity(node).type === type && flowNodeEntity(node).id === id)
            .map(node => (node.data as { filterIcons?: string[] }).filterIcons);
        expect(icons('chest', 1)).toContainEqual(['iron-ore']);
        expect(icons('inserter', 1)).toEqual([['iron-ore']]);
    });
});
