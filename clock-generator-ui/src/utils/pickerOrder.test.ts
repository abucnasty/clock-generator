import { describe, expect, it } from 'vitest';
import { prioritizedIds } from './pickerOrder';
import { searchIds } from './gameNames';

describe('source-first picker order', () => {
    const label = (id: string) => id.replaceAll('-', ' ');
    it('puts priority ids first, once, and gives each contiguous group its name', () => {
        const result = prioritizedIds('', ['copper-plate', 'iron-plate', 'iron-plate'], ['iron-plate', 'coal', 'copper-plate', 'stone'], label, 'From Belt 1');
        expect(result.ids).toEqual(['copper-plate', 'iron-plate', 'coal', 'stone']);
        expect(result.groupOf('iron-plate')).toBe('From Belt 1');
        expect(result.groupOf('coal')).toBe('All items');
    });
    it('searches inside each group, keeping searchIds ranking within the group', () => {
        const first = ['iron-plate', 'copper-plate'];
        const rest = ['plate', 'steel-plate', 'coal'];
        expect(prioritizedIds('plate', first, [...rest, ...first], label).ids).toEqual([...searchIds('plate', first, label), ...searchIds('plate', rest, label)]);
        expect(prioritizedIds('plate', [], [...first, ...rest], label).ids).toEqual(searchIds('plate', [...first, ...rest], label));
    });
});
