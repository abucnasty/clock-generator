import { describe, expect, it } from 'vitest';
import {
    BUTTON_NAMES,
    CLOCK_TABLE_NAME,
    PROGRESS_NAMES,
    SELECT_NAMES,
    clockHelpName,
    deleteLaneName,
    recipeName,
    removeFilterName,
    reorderAnnouncements,
    reorderName,
} from './a11yLabels';
import { entityLabel, type LabelKind } from './entityLabel';

const KINDS: LabelKind[] = ['machine', 'inserter', 'belt', 'chest', 'drill'];

describe('names built from a row', () => {
    it('name the row the way the page does, for every kind and for one and two digits', () => {
        for (const kind of KINDS) {
            for (const n of [1, 12]) {
                const row = entityLabel(kind, n);
                expect(reorderName(row)).toBe(`Reorder ${row}`);
                expect(recipeName(row)).toBe(`Recipe, ${row}`);
            }
        }
        expect(reorderName(entityLabel('inserter', 2))).toBe('Reorder Inserter 2');
        expect(recipeName(entityLabel('machine', 12))).toBe('Recipe, Machine 12');
    });

    it('name the second lane of a belt and a filter slot', () => {
        expect(deleteLaneName(entityLabel('belt', 1), 2)).toBe('Delete lane 2 of Belt 1');
        expect(deleteLaneName(entityLabel('belt', 12), 2)).toBe('Delete lane 2 of Belt 12');
        expect(removeFilterName(1, 'iron-plate')).toBe('Remove filter 1: iron-plate');
        expect(removeFilterName(12, 'copper-cable')).toBe('Remove filter 12: copper-cable');
    });

    it('name the help button after the clock it explains', () => {
        expect(clockHelpName('Fixed 4 + 2')).toBe('How Fixed 4 + 2 is made');
    });
});

describe('the constant names', () => {
    it('are all non-empty strings', () => {
        const all = [
            ...Object.values(SELECT_NAMES),
            ...Object.values(BUTTON_NAMES),
            ...Object.values(PROGRESS_NAMES),
            CLOCK_TABLE_NAME,
        ];
        expect(all.length).toBeGreaterThan(10);
        for (const name of all) {
            expect(typeof name).toBe('string');
            expect(name.trim()).not.toBe('');
        }
    });
});

describe('reorderAnnouncements', () => {
    const keys = ['uuid-a', 'uuid-b', 'uuid-c'];
    const announcements = reorderAnnouncements('inserter', keys);
    const rect = { id: '' } as never;
    const event = (active: string, over?: string) =>
        ({ active: { id: active, data: rect, rect: rect }, over: over ? { id: over, data: rect, rect, disabled: false } : null }) as never;

    it('names the row and its position at the start, over and end of a drag', () => {
        expect(announcements.onDragStart?.(event('uuid-b'))).toBe('Picked up Inserter 2.');
        expect(announcements.onDragOver?.(event('uuid-b', 'uuid-c'))).toBe('Inserter 2 is over position 3.');
        expect(announcements.onDragEnd?.(event('uuid-b', 'uuid-a'))).toBe('Inserter 2 was dropped at position 1.');
    });

    it('says something sensible when the row is dropped, or hovered, over nothing', () => {
        expect(announcements.onDragOver?.(event('uuid-a'))).toBe('Inserter 1 is not over a position.');
        expect(announcements.onDragEnd?.(event('uuid-a'))).toBe('Inserter 1 was dropped where it was, at position 1.');
    });

    it('says where the row is back when the drag is cancelled', () => {
        expect(announcements.onDragCancel?.(event('uuid-c'))).toBe('Reordering cancelled; Inserter 3 is back at position 3.');
    });

    it('never reads out a key', () => {
        const texts = [
            announcements.onDragStart?.(event('uuid-a')),
            announcements.onDragOver?.(event('uuid-a', 'uuid-b')),
            announcements.onDragEnd?.(event('uuid-a', 'uuid-b')),
            announcements.onDragEnd?.(event('uuid-a')),
            announcements.onDragCancel?.(event('uuid-b')),
            announcements.onDragStart?.(event('not-a-key')),
        ];
        for (const text of texts) {
            expect(text).toBeTruthy();
            expect(text).not.toContain('uuid-');
            expect(text).not.toContain('not-a-key');
        }
    });
});
