import { describe, expect, it } from 'vitest';
import { filtersWithSlotRemoved, filtersWithSlotSet } from './filterSlots';

describe('filtersWithSlotSet', () => {
    it('adds to the auto filters when the "+" after them is set, keeping them', () => {
        expect(filtersWithSlotSet(undefined, ['iron-plate', 'copper-plate'], 2, 'coal', 5)).toEqual(['iron-plate', 'copper-plate', 'coal']);
    });

    it('replaces one auto filter and keeps the others', () => {
        expect(filtersWithSlotSet([], ['iron-plate', 'copper-plate'], 0, 'coal', 5)).toEqual(['coal', 'copper-plate']);
    });

    it('takes no more auto filters than there are slots', () => {
        expect(filtersWithSlotSet(undefined, ['a', 'b', 'c', 'd', 'e', 'f'], 4, 'z', 5)).toEqual(['a', 'b', 'c', 'd', 'z']);
    });

    it('sets a slot of the player\'s own list, and ignores the auto filters', () => {
        expect(filtersWithSlotSet(['iron-plate'], ['copper-plate'], 1, 'coal', 5)).toEqual(['iron-plate', 'coal']);
        expect(filtersWithSlotSet(['iron-plate'], ['copper-plate'], 0, 'coal', 5)).toEqual(['coal']);
    });

    it('drops empty slots at the end', () => {
        expect(filtersWithSlotSet(['iron-plate', 'copper-plate'], [], 1, '', 5)).toEqual(['iron-plate']);
    });
});

describe('filtersWithSlotRemoved', () => {
    it('removes an auto filter and keeps the others as the player\'s own', () => {
        expect(filtersWithSlotRemoved(undefined, ['iron-plate', 'copper-plate'], 0)).toEqual(['copper-plate']);
    });

    it('removes from the player\'s own list, and ignores the auto filters', () => {
        expect(filtersWithSlotRemoved(['iron-plate', 'coal'], ['copper-plate'], 1)).toEqual(['iron-plate']);
    });

    it('is none set (back to the auto filters) once the last is removed', () => {
        expect(filtersWithSlotRemoved(['iron-plate'], ['copper-plate'], 0)).toBeUndefined();
        expect(filtersWithSlotRemoved(undefined, ['iron-plate'], 0)).toBeUndefined();
    });
});
