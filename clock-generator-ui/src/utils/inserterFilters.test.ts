import { describe, expect, it } from 'vitest';
import { removeFilterSlot, setFilterSlot, usesAutomaticFilters, usesBlacklist } from './inserterFilters';

describe('inserter filter edits', () => {
    it('starts from the automatic list, preserving the other items and never making holes', () => {
        expect(removeFilterSlot(undefined, ['a', 'b', 'c'], 1)).toEqual({ filters: ['a', 'c'], becameExplicit: true });
        expect(setFilterSlot(undefined, ['a', 'b', 'c'], 2, 'x')).toEqual({ filters: ['a', 'b', 'x'], becameExplicit: true });
        expect(setFilterSlot(undefined, [], 0, 'x')).toEqual({ filters: ['x'], becameExplicit: true });
        expect(setFilterSlot(undefined, ['a'], 4, 'x')).toEqual({ filters: ['a', 'x'], becameExplicit: true });
        expect(setFilterSlot(undefined, ['a', 'b'], 2, 'x')).toEqual({ filters: ['a', 'b', 'x'], becameExplicit: true });
        expect(setFilterSlot([], ['a', 'b'], 0, 'x')).toEqual({ filters: ['x', 'b'], becameExplicit: true });
        expect(removeFilterSlot(undefined, ['a'], 0)).toEqual({ filters: undefined, becameExplicit: false });
    });
    it('edits explicit lists without mutating them and returns empty lists to Automatic', () => {
        const filters = ['a'];
        expect(setFilterSlot(filters, ['b'], 1, 'x')).toEqual({ filters: ['a', 'x'], becameExplicit: false });
        expect(filters).toEqual(['a']);
        expect(removeFilterSlot(filters, ['b'], 0)).toEqual({ filters: undefined, becameExplicit: false });
        expect(setFilterSlot(['a', '', ''], [], 0, 'x')).toEqual({ filters: ['x'], becameExplicit: false });
        expect(setFilterSlot(['a'], ['b'], 0, 'x')).toEqual({ filters: ['x'], becameExplicit: false });
        expect(setFilterSlot(['a', 'b'], [], 1, '')).toEqual({ filters: ['a'], becameExplicit: false });
        expect(removeFilterSlot(['a', 'x'], ['b'], 1)).toEqual({ filters: ['a'], becameExplicit: false });
        expect(usesAutomaticFilters(undefined)).toBe(true);
        expect(usesAutomaticFilters([])).toBe(true);
        expect(usesAutomaticFilters(['a'])).toBe(false);
    });
    it('tells a captured blacklist apart, which only matters while it names items', () => {
        expect(usesBlacklist({ filters: ['a'], filter_mode: 'blacklist' })).toBe(true);
        expect(usesBlacklist({ filters: ['a'], filter_mode: 'whitelist' })).toBe(false);
        expect(usesBlacklist({ filters: ['a'] })).toBe(false);
        expect(usesBlacklist({ filters: undefined, filter_mode: 'blacklist' })).toBe(false);
    });
});
