import { describe, expect, it } from 'vitest';
import type { BeltFormData, ChestFormData, MachineFormData } from './configForm/formData';
import { entityOptionsOf, findOption, stackSizeFrom } from './inserterOptions';
import { effectiveInserterStackSize } from './inserterMetadata';

describe('shared inserter options', () => {
    const machines: MachineFormData[] = [
        { id: 1, _uuid: 'm1', recipe: 'gear', crafting_speed: 1, productivity: 0 },
        { id: 2, _uuid: 'm2', recipe: '', crafting_speed: 1, productivity: 0 },
    ];
    const belts: BeltFormData[] = [{ id: 1, _uuid: 'b1', type: 'transport-belt', lanes: [{ ingredient: 'iron', stack_size: 4 }, { ingredient: 'copper', stack_size: 4 }] }];
    const chests: ChestFormData[] = [
        { id: 1, _uuid: 'c1', type: 'buffer-chest', storage_size: 2, item_filter: 'coal' },
        { id: 2, _uuid: 'c2', type: 'buffer-chest', storage_size: 2, item_filter: '' },
        { id: 3, _uuid: 'c3', type: 'infinity-chest', item_filter: [{ item_name: 'iron', request_count: 1 }, { item_name: 'copper', request_count: 2 }] },
        { id: 4, _uuid: 'c4', type: 'infinity-chest', item_filter: [] },
    ];
    const options = entityOptionsOf(machines, belts, chests, { recipe: id => id.toUpperCase(), item: id => id.toUpperCase() });
    it('uses the same localized labels and sublabels for every entity kind', () => {
        expect(options.map(o => [o.label, o.sublabel])).toEqual([
            ['Machine 1', 'GEAR'], ['Machine 2', 'No recipe'], ['Belt 1', undefined],
            ['Chest 1', 'COAL'], ['Chest 2', 'No item filter'], ['Chest 3', 'IRON, COPPER'], ['Chest 4', 'No filters'],
        ]);
        expect(findOption(options, 'belt', 1)?.ingredientIcons).toEqual(['iron', 'copper']);
        expect(findOption(options, 'chest', 1)?.sublabel).toBe('COAL');
        expect(findOption(options, 'belt', 99)).toBeUndefined();
    });
    it('keeps explicit integers, clears to omission, and uses shared per-type capacities', () => {
        expect(stackSizeFrom(null)).toBeUndefined();
        expect(stackSizeFrom(undefined)).toBeUndefined();
        expect(stackSizeFrom(7)).toBe(7);
        expect(stackSizeFrom(0)).toBe(0);
        expect(Number.isNaN(stackSizeFrom(Number.NaN))).toBe(true);
        for (const [prototype, size] of [['stack-inserter', 16], ['bulk-inserter', 12], ['fast-inserter', 4]] as const) {
            expect(effectiveInserterStackSize({ prototype, stack_size: stackSizeFrom(null) })).toBe(size);
            expect(effectiveInserterStackSize({ prototype, stack_size: stackSizeFrom(7) })).toBe(7);
        }
    });
});
