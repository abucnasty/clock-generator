import { describe, expect, it } from 'vitest';
import { MIN_MARK_PX, markSpan, paintLayer } from './timelineGeometry';

describe('markSpan', () => {
    it('keeps the natural span of a wide mark', () => {
        expect(markSpan(50, 100, 1000, 500)).toEqual({ x: 25, width: 50, narrow: false });
    });
    it('draws a narrow mark 3px wide at the same x', () => {
        expect(markSpan(100, 1, 1000, 500)).toEqual({ x: 50, width: MIN_MARK_PX, narrow: true });
    });
    it('draws a zero-duration mark 3px wide', () => {
        expect(markSpan(100, 0, 1000, 500).width).toBe(3);
    });
    it('keeps a mark at the right end inside the track', () => {
        expect(markSpan(999, 1, 1000, 500)).toEqual({ x: 497, width: 3, narrow: true });
    });
    it('does not call exactly 3px narrow', () => {
        expect(markSpan(0, 6, 1000, 500)).toEqual({ x: 0, width: 3, narrow: false });
    });
    it('never overflows a track narrower than 3px', () => {
        const span = markSpan(10, 1, 100, 2);
        expect(span.width).toBeLessThanOrEqual(2);
        expect(span.x).toBeGreaterThanOrEqual(0);
    });
    it('returns zeros, not NaN, for an empty duration or track', () => {
        expect(markSpan(0, 1, 0, 500)).toEqual({ x: 0, width: 0, narrow: false });
        expect(markSpan(0, 1, 1000, 0)).toEqual({ x: 0, width: 0, narrow: false });
    });
});

describe('paintLayer', () => {
    const wide = { x: 0, width: 10, narrow: false };
    const narrow = { x: 0, width: 3, narrow: true };
    it('ranks wide, narrow, narrow priority', () => {
        expect(paintLayer(wide, true)).toBe(0);
        expect(paintLayer(narrow, false)).toBe(1);
        expect(paintLayer(narrow, true)).toBe(2);
    });
    it('paints a narrow Blocked mark after a narrow Idle mark that started later', () => {
        const marks = [
            { name: 'blocked', layer: paintLayer(narrow, true) },
            { name: 'idle', layer: paintLayer(narrow, false) },
        ];
        expect(marks.sort((a, b) => a.layer - b.layer).map(m => m.name)).toEqual(['idle', 'blocked']);
    });
});
