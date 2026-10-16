import { describe, expect, it } from 'vitest';
import { removeFilterSlot, setFilterSlot, usesAutomaticFilters } from './inserterFilters';

describe('inserter filter edits', () => {
    it('starts from the automatic list, preserving the other items and never making holes', () => {
        expect(removeFilterSlot(undefined, ['a', 'b', 'c'], 1)).toEqual({ filters: ['a', 'c'], becameExplicit: true });
        expect(setFilterSlot(undefined, ['a', 'b', 'c'], 2, 'x')).toEqual({ filters: ['a', 'b', 'x'], becameExplicit: true });
        expect(setFilterSlot(undefined, [], 0, 'x')).toEqual({ filters: ['x'], becameExplicit: true });
        expect(setFilterSlot(undefined, ['a'], 4, 'x')).toEqual({ filters: ['a', 'x'], becameExplicit: true });
    });
    it('edits explicit lists without mutating them and returns empty lists to Automatic', () => {
        const filters = ['a'];
        expect(setFilterSlot(filters, ['b'], 1, 'x')).toEqual({ filters: ['a', 'x'], becameExplicit: false });
        expect(filters).toEqual(['a']);
        expect(removeFilterSlot(filters, ['b'], 0)).toEqual({ filters: undefined, becameExplicit: false });
        expect(setFilterSlot(['a', '', ''], [], 0, 'x')).toEqual({ filters: ['x'], becameExplicit: false });
        expect(usesAutomaticFilters(undefined)).toBe(true);
        expect(usesAutomaticFilters([])).toBe(true);
        expect(usesAutomaticFilters(['a'])).toBe(false);
    });
});


describe('filter slot preservation', () => {
    it('adds after the automatic items, or replaces one, retaining the rest', () => {
        expect(setFilterSlot(undefined, ['iron-plate', 'copper-plate'], 2, 'coal').filters).toEqual(['iron-plate', 'copper-plate', 'coal']);
        expect(setFilterSlot([], ['iron-plate', 'copper-plate'], 0, 'coal').filters).toEqual(['coal', 'copper-plate']);
        expect(setFilterSlot(['iron-plate'], ['copper-plate'], 0, 'coal').filters).toEqual(['coal']);
    });
    it('drops trailing empties and returns to Automatic after the last removal', () => {
        expect(setFilterSlot(['iron-plate', 'copper-plate'], [], 1, '').filters).toEqual(['iron-plate']);
        expect(removeFilterSlot(undefined, ['iron-plate'], 0).filters).toBeUndefined();
        expect(removeFilterSlot(['iron-plate', 'coal'], ['copper-plate'], 1).filters).toEqual(['iron-plate']);
    });
});
