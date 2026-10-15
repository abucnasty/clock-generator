import { describe, expect, it } from 'vitest';
import { AA, contrastRatio, parseColor, relativeLuminance } from './contrast';

describe('contrastRatio', () => {
    it('is 21 for white on black, 1 for a colour on itself, and the same either way round', () => {
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
        expect(contrastRatio('#5eb664', '#5eb664')).toBeCloseTo(1, 5);
        expect(contrastRatio('#fca300', '#232323')).toBeCloseTo(contrastRatio('#232323', '#fca300'), 10);
    });

    it('puts the 4.5 line between #767676 and #777777 on white', () => {
        expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
        expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(AA.text);
        expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
        expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(AA.text);
    });

    it('blends a translucent colour over the surface under it', () => {
        // 70% white over #232323: 0.7 * 255 + 0.3 * 35 = 189
        expect(contrastRatio('rgba(255, 255, 255, 0.7)', '#232323')).toBeCloseTo(contrastRatio('#bdbdbd', '#232323'), 2);
        expect(contrastRatio('rgba(255,255,255,0.7)', '#232323')).toBeCloseTo(8.37, 2);
    });

    it('gives the values this item quotes', () => {
        expect(contrastRatio('#000', '#ffe14d')).toBeCloseTo(16.13, 2);
        expect(contrastRatio('#fca300', '#232323')).toBeCloseTo(7.77, 2);
    });
});

describe('relativeLuminance', () => {
    it('is 0 for black and 1 for white', () => {
        expect(relativeLuminance('#000000')).toBe(0);
        expect(relativeLuminance('#fff')).toBeCloseTo(1, 10);
    });
});

describe('parseColor', () => {
    it('reads the short and long hex and rgb() and rgba()', () => {
        expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
        expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
        expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
        expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    });

    it('throws on anything else', () => {
        expect(() => parseColor('red')).toThrow();
        expect(() => parseColor('#12')).toThrow();
        expect(() => parseColor('')).toThrow();
        expect(() => parseColor('rgb(300, 0, 0)')).toThrow();
    });
});

describe('AA', () => {
    it('asks 4.5 of text and 3 of everything else', () => {
        expect(AA.text).toBe(4.5);
        expect(AA.nonText).toBe(3);
    });
});
