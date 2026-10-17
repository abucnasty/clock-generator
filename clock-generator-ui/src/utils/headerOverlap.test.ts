import { describe, expect, it } from 'vitest';
import { isUnderHeader } from './headerOverlap';

describe('isUnderHeader', () => {
    const HEADER_BOTTOM = 120;

    it('is false for an element below the header, and true for one under it', () => {
        expect(isUnderHeader({ top: 130, bottom: 170 }, HEADER_BOTTOM)).toBe(false);
        expect(isUnderHeader({ top: 100, bottom: 140 }, HEADER_BOTTOM)).toBe(true);
    });

    it('is false for an element scrolled out above the window', () => {
        expect(isUnderHeader({ top: -40, bottom: 0 }, HEADER_BOTTOM)).toBe(false);
        expect(isUnderHeader({ top: -80, bottom: -40 }, HEADER_BOTTOM)).toBe(false);
    });

    it('is false for an element whose top is exactly at the edge', () => {
        expect(isUnderHeader({ top: 120, bottom: 160 }, HEADER_BOTTOM)).toBe(false);
    });
});
