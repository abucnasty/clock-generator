import { describe, expect, it } from 'vitest';
import {
    clockHelpName,
    deleteLaneName,
    recipeName,
    removeFilterName,
    rowActionsName,
    selectRowName,
    termsHelpName,
} from './a11yLabels';

describe('names built from a row', () => {
    it('keeps the owning row in each action and field name', () => {
        expect(rowActionsName('Inserter 2')).toBe('More actions for Inserter 2');
        expect(selectRowName('Chest 12')).toBe('Select Chest 12');
        expect(recipeName('Machine 12')).toBe('Recipe, Machine 12');
    });

    it('name the second lane of a belt and a filter slot', () => {
        expect(deleteLaneName('Belt 12', 2)).toBe('Delete lane 2 of Belt 12');
        expect(removeFilterName(12, 'copper-cable')).toBe('Remove filter 12: copper-cable');
    });

    it('name the help button after the clock it explains', () => {
        expect(clockHelpName('Fixed 4 + 2')).toBe('About Fixed 4 + 2');
        expect(termsHelpName('Works?')).toBe('Terms for Works?');
    });
});
