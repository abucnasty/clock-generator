import { describe, expect, it } from 'vitest';
import { entityTypeLabel } from './entityTypes';

describe('entityTypeLabel', () => {
    it('is the game name when there is one', () => {
        expect(entityTypeLabel('turbo-transport-belt', (id) => (id === 'turbo-transport-belt' ? 'Turbo transport belt' : id))).toBe('Turbo transport belt');
    });

    it('is the sentence-case label while no names are known, and the id for an unknown type', () => {
        expect(entityTypeLabel('big-mining-drill', (id) => id)).toBe('Big mining drill');
        expect(entityTypeLabel('mystery', (id) => id)).toBe('mystery');
    });
});
