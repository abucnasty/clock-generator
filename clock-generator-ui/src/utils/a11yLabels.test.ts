import { describe, expect, it } from 'vitest';
import {
    BUTTON_NAMES,
    CLOCK_TABLE_NAME,
    FIELD_NAMES,
    PROGRESS_NAMES,
    SELECT_NAMES,
    TABLIST_NAMES,
    clockHelpName,
    deleteLaneName,
    recipeName,
    removeFilterName,
    rowActionsName,
    selectRowName,
    termsHelpName,
} from './a11yLabels';
import { entityLabel, type LabelKind } from './entityLabel';

const KINDS: LabelKind[] = ['machine', 'inserter', 'belt', 'chest', 'drill'];

describe('names built from a row', () => {
    it('name the row the way the page does, for every kind and for one and two digits', () => {
        for (const kind of KINDS) {
            for (const n of [1, 12]) {
                const row = entityLabel(kind, n);
                expect(rowActionsName(row)).toBe(`More actions for ${row}`);
                expect(selectRowName(row)).toBe(`Select ${row}`);
                expect(recipeName(row)).toBe(`Recipe, ${row}`);
            }
        }
        expect(rowActionsName(entityLabel('inserter', 2))).toBe('More actions for Inserter 2');
        expect(recipeName(entityLabel('machine', 12))).toBe('Recipe, Machine 12');
    });

    it('name the second lane of a belt and a filter slot', () => {
        expect(deleteLaneName(entityLabel('belt', 1), 2)).toBe('Delete lane 2 of Belt 1');
        expect(deleteLaneName(entityLabel('belt', 12), 2)).toBe('Delete lane 2 of Belt 12');
        expect(removeFilterName(1, 'iron-plate')).toBe('Remove filter 1: iron-plate');
        expect(removeFilterName(12, 'copper-cable')).toBe('Remove filter 12: copper-cable');
    });

    it('name the help button after the clock it explains', () => {
        expect(clockHelpName('Fixed 4 + 2')).toBe('About Fixed 4 + 2');
        expect(termsHelpName('Works?')).toBe('Terms for Works?');
    });
});

describe('the constant names', () => {
    it('are all non-empty strings', () => {
        const all = [
            ...Object.values(SELECT_NAMES),
            ...Object.values(BUTTON_NAMES),
            ...Object.values(FIELD_NAMES),
            ...Object.values(PROGRESS_NAMES),
            ...Object.values(TABLIST_NAMES),
            CLOCK_TABLE_NAME,
        ];
        expect(all.length).toBeGreaterThan(10);
        for (const name of all) {
            expect(typeof name).toBe('string');
            expect(name.trim()).not.toBe('');
        }
    });
});
