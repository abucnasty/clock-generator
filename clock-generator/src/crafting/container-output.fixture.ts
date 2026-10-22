import { Config, ConfigSchema } from '../config/schema';

export const stack = (source: object, sink: object, filters?: string[]) =>
    ({ source, sink, prototype: 'stack-inserter', quality: 'legendary', stack_size: 16, ...(filters ? { filters } : {}) });

/**
 * The owner's steel build in small: a drill fills a wagon with ore, one furnace makes plates from it and puts them back
 * into the wagon, the other makes steel from the plates and puts it back too, and the steel is taken out of the wagon
 * onto a belt. The wagon is a hub: source and sink of every item of the chain.
 */
export function steelHub(items_per_second = 26): Config {
    return ConfigSchema.parse({
        target_output: { recipe: 'steel-plate', items_per_second, copies: 1 },
        machines: [
            { id: 1, recipe: 'steel-plate', crafting_speed: 105.875, productivity: 300, type: 'furnace' },
            { id: 2, recipe: 'iron-plate', crafting_speed: 80.0375, productivity: 50, type: 'furnace' },
        ],
        drills: { configs: [
            { id: 1, type: 'big-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 15.8244, productivity: 79990, target: { type: 'chest', id: 2 } }] },
        inserters: [
            stack({ type: 'chest', id: 2 }, { type: 'machine', id: 1 }, ['iron-plate']),
            stack({ type: 'machine', id: 1 }, { type: 'chest', id: 2 }, ['steel-plate']),
            stack({ type: 'chest', id: 2 }, { type: 'belt', id: 1 }, ['steel-plate']),
            stack({ type: 'machine', id: 2 }, { type: 'chest', id: 2 }, ['iron-plate']),
            stack({ type: 'chest', id: 2 }, { type: 'machine', id: 2 }, ['iron-ore']),
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'steel-plate', stack_size: 4 }] }],
        chests: [
            { type: 'infinity-chest', id: 1, item_filter: [], remove_unfiltered_items: true },
            { type: 'cargo-wagon', id: 2, slot_filters: [
                ...Array.from({ length: 20 }, (_, i) => ({ slot: i + 1, item: 'iron-ore' })),
                ...Array.from({ length: 5 }, (_, i) => ({ slot: i + 21, item: 'iron-plate' })),
                ...Array.from({ length: 5 }, (_, i) => ({ slot: i + 26, item: 'steel-plate' })),
                ...Array.from({ length: 10 }, (_, i) => ({ slot: i + 31, blocked: true })),
            ] },
        ],
    });
}

