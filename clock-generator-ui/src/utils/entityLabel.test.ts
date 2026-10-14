import { describe, expect, it } from 'vitest';
import { entityLabel, type LabelKind } from './entityLabel';

describe('entityLabel', () => {
    it('names an entity by its kind and id, with no #', () => {
        expect(entityLabel('inserter', 3)).toBe('Inserter 3');
        const kinds: LabelKind[] = ['machine', 'inserter', 'belt', 'chest', 'drill'];
        expect(kinds.map((kind) => entityLabel(kind, 2))).toEqual(['Machine 2', 'Inserter 2', 'Belt 2', 'Chest 2', 'Drill 2']);
        expect(kinds.some((kind) => entityLabel(kind, 12).includes('#'))).toBe(false);
    });
});
