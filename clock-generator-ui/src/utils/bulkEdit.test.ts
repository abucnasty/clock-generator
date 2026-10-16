import { describe, expect, it } from 'vitest';
import { commonValue, idList, itemsUnion, pruneSelection, rangeSelect, selectionLabel } from './bulkEdit';

describe('bulk selection', () => {
    it('prunes missing UUIDs and retains the object when all remain', () => {
        const selected = new Set(['a', 'c']);
        expect(pruneSelection(selected, ['c', 'b', 'a'])).toBe(selected);
        expect([...pruneSelection(selected, ['a', 'b'])]).toEqual(['a']);
    });
    it('selects ranges in both directions, keeping other selected rows', () => {
        expect([...rangeSelect(['a', 'b', 'c', 'd'], 'a', 'c', new Set(['d']))]).toEqual(['d', 'a', 'b', 'c']);
        expect([...rangeSelect(['a', 'b', 'c'], 'c', 'a', new Set())]).toEqual(['a', 'b', 'c']);
        expect([...rangeSelect(['a', 'b', 'c'], 'gone', 'b', new Set())]).toEqual(['b']);
        expect([...rangeSelect(['a'], null, 'gone', new Set(['a']))]).toEqual(['a']);
    });
    it('compares object values independent of their key order, but preserves array order', () => {
        expect(commonValue([{ a: 1, b: 2 }, { b: 2, a: 1 }], row => row)).toEqual({ a: 1, b: 2 });
        expect(commonValue([1, 1], n => n)).toBe(1);
        expect(commonValue([1, 2], n => n)).toBeNull();
        expect(commonValue([[1, 2], [2, 1]], n => n)).toBeNull();
        expect(commonValue([undefined, undefined], n => n)).toBeUndefined();
        expect(commonValue([], n => n)).toBeNull();
    });
    it('names one, consecutive and split selections', () => {
        expect(selectionLabel([4])).toBe('Inserter 4');
        expect(selectionLabel([1, 2, 3])).toBe('Inserters 1–3');
        expect(selectionLabel([2, 5, 6, 7])).toBe('Inserters 2, 5–7');
        expect(idList([7, 2, 6, 5, 5])).toBe('2, 5–7');
    });
    it('keeps the first-seen order of item unions', () => {
        expect(itemsUnion([['copper', 'iron'], ['iron', 'steel'], [], ['copper']])).toEqual(['copper', 'iron', 'steel']);
    });
});
