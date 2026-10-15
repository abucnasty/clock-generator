import { describe, expect, it } from 'vitest';
import { drillsListed } from './drillsSection';

describe('drillsListed', () => {
    it('folds to the Add row with no drills and level 0', () => {
        expect(drillsListed({ drillCount: 0, miningProductivityLevel: 0, levelFocused: false })).toBe(false);
    });

    it('lists with a drill, or with a productivity level to keep', () => {
        expect(drillsListed({ drillCount: 1, miningProductivityLevel: 0, levelFocused: false })).toBe(true);
        expect(drillsListed({ drillCount: 0, miningProductivityLevel: 3, levelFocused: false })).toBe(true);
    });

    it('stays listed while the level is typed down to 0, and folds once the field is left', () => {
        expect(drillsListed({ drillCount: 0, miningProductivityLevel: 0, levelFocused: true })).toBe(true);
        expect(drillsListed({ drillCount: 0, miningProductivityLevel: 0, levelFocused: false })).toBe(false);
    });
});
