import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { FactorioDataService } from 'clock-generator/browser';
import { containerSlotCount, paintSlotFilters, shownSlotFilter, slotCounts, slotCountsText, slotRange } from './containerSlotFilters';
import { MACHINE_QUALITIES } from './machinePrototype';

FactorioDataService.initialize(JSON.parse(data));

describe('inventory filter editing', () => {
    it.each(['car', 'tank', 'cargo-wagon'] as const)('sizes the %s grid from the supported game inventories at every quality', type => {
        for (const quality of MACHINE_QUALITIES) {
            expect(containerSlotCount({ type, quality })).toBe(FactorioDataService.containerSlots(type, quality));
        }
    });

    it('paints thirty slots in either drag direction, preserves other filters and does not mutate the original', () => {
        const filters = [{ slot: 1, item: 'iron-plate' }, { slot: 50, item: 'copper-plate' }];
        const forward = paintSlotFilters(filters, slotRange(1, 30), 'lithium');
        expect(forward).toEqual(paintSlotFilters(filters, slotRange(30, 1), 'lithium'));
        expect(forward.filter(filter => filter.item === 'lithium').map(filter => filter.slot)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
        expect(forward.find(filter => filter.slot === 50)).toEqual(filters[1]);
        expect(filters).toEqual([{ slot: 1, item: 'iron-plate' }, { slot: 50, item: 'copper-plate' }]);
    });

    it('clears a chosen slot without renumbering the remaining filters or dropping filters past the current inventory', () => {
        const filters = [{ slot: 1, item: 'lithium' }, { slot: 2, item: 'iron-plate' }, { slot: 100, item: 'copper-plate' }];
        expect(paintSlotFilters(filters, [1], null)).toEqual(filters.slice(1));
    });

    it('replaces a pasted filter instead of adding a duplicate slot', () => {
        const filters = [{ slot: 2, item: 'iron-plate' }, { slot: 5, item: 'lithium' }];
        const pasted = paintSlotFilters(filters, [2], filters[1].item);
        expect(pasted).toEqual([{ slot: 2, item: 'lithium' }, { slot: 5, item: 'lithium' }]);
        expect(paintSlotFilters(pasted, [2], 'lithium')).toEqual(pasted);
    });

    it('paints a marker as a blocked slot that remembers it, and shows a blocked slot of unknown marker as No item', () => {
        const painted = paintSlotFilters([{ slot: 1, item: 'iron-plate' }], [2, 3], 'deconstruction-planner');
        expect(painted).toEqual([{ slot: 1, item: 'iron-plate' }, { slot: 2, blocked: true, _marker: 'deconstruction-planner' }, { slot: 3, blocked: true, _marker: 'deconstruction-planner' }]);
        expect(painted.map(shownSlotFilter)).toEqual(['iron-plate', 'deconstruction-planner', 'deconstruction-planner']);
        expect(shownSlotFilter({ slot: 4, blocked: true })).toBe('no-item');
        expect(paintSlotFilters(painted, [2], 'coal')[1]).toEqual({ slot: 2, item: 'coal' });
    });
});

describe('the count of an inventory', () => {
    it('counts each slot once, filtered, blocked or free, and none past the last', () => {
        const filters = [
            { slot: 1, item: 'iron-plate' }, { slot: 2, item: 'iron-plate' }, { slot: 3, blocked: true as const },
            { slot: 4, item: '' }, { slot: 41, item: 'coal' }, { slot: 42, blocked: true as const },
        ];
        expect(slotCounts(filters, 40)).toEqual({ filtered: 2, blocked: 1, free: 37 });
        expect(slotCountsText(slotCounts(filters, 40))).toBe('2 filtered · 1 blocked · 37 free');
        // a wagon of 30 filtered and 10 blocked slots has none free (the UX review's wagon)
        const wagon = [...slotRange(1, 30).map(slot => ({ slot, item: 'iron-ore' })), ...slotRange(31, 40).map(slot => ({ slot, blocked: true as const }))];
        expect(slotCountsText(slotCounts(wagon, 40))).toBe('30 filtered · 10 blocked · 0 free');
    });
});
