import { describe, expect, it } from 'vitest';
import { focusTargetIndex } from './rowFocus';

describe('focusTargetIndex', () => {
    it('is the row that took the deleted one\'s place', () => {
        expect(focusTargetIndex(1, 3)).toBe(1);
        expect(focusTargetIndex(0, 2)).toBe(0);
    });

    it('is the row before for the last row', () => {
        expect(focusTargetIndex(3, 3)).toBe(2);
    });

    it('is none, for the Add button, when no row is left, or the one left cannot be deleted (the only machine)', () => {
        expect(focusTargetIndex(0, 0)).toBeNull();
        expect(focusTargetIndex(1, 0)).toBeNull();
    });
});
