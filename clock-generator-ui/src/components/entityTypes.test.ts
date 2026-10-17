import { describe, expect, it } from 'vitest';
import { entityTypeLabel } from './entityTypes';

describe('entityTypeLabel', () => {
    it.each([
        ['transport-belt', 'Yellow'], ['fast-transport-belt', 'Red'],
        ['express-transport-belt', 'Blue'], ['turbo-transport-belt', 'Green'],
    ])('uses the short colour name for %s even when game names are loaded', (id, colour) => {
        expect(entityTypeLabel(id, () => 'Full game name')).toBe(colour);
    });

    it('uses the game name for drills when available', () => {
        expect(entityTypeLabel('big-mining-drill', () => 'Localized drill name')).toBe('Localized drill name');
    });

    it('is the sentence-case label while no names are known, and the id for an unknown type', () => {
        expect(entityTypeLabel('big-mining-drill', (id) => id)).toBe('Big mining drill');
        expect(entityTypeLabel('mystery', (id) => id)).toBe('mystery');
    });
});
