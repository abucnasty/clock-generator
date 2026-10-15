import { describe, expect, it } from 'vitest';
import { edgeMask, scrollEdges } from './scrollEdges';

describe('scrollEdges', () => {
    it('has no edge when the content fits', () => {
        expect(scrollEdges(0, 600, 600)).toEqual({ start: false, end: false });
    });

    it('has the end edge at the start, both in the middle and the start edge at the end', () => {
        expect(scrollEdges(0, 600, 925)).toEqual({ start: false, end: true });
        expect(scrollEdges(150, 600, 925)).toEqual({ start: true, end: true });
        expect(scrollEdges(325, 600, 925)).toEqual({ start: true, end: false });
    });

    it('absorbs subpixel rounding', () => {
        expect(scrollEdges(0, 600, 600.6)).toEqual({ start: false, end: false });
        expect(scrollEdges(324.4, 600, 925)).toEqual({ start: true, end: false });
    });
});

describe('edgeMask', () => {
    it('is undefined when nothing is hidden', () => {
        expect(edgeMask({ start: false, end: false })).toBeUndefined();
    });

    it('fades only the side that has more content', () => {
        const right = edgeMask({ start: false, end: true });
        expect(right?.startsWith('linear-gradient(to right, black 0')).toBe(true);
        expect(right?.endsWith('transparent 100%)')).toBe(true);
        const left = edgeMask({ start: true, end: false });
        expect(left?.startsWith('linear-gradient(to right, transparent 0')).toBe(true);
        expect(left?.endsWith('black 100%)')).toBe(true);
    });

    it('fades both sides in the middle', () => {
        const both = edgeMask({ start: true, end: true });
        expect(both?.startsWith('linear-gradient(to right, transparent 0')).toBe(true);
        expect(both?.endsWith('transparent 100%)')).toBe(true);
    });
});
