import { describe, expect, it } from 'vitest';
import {
    OUTPUT_PER_PERIOD_HEADER,
    WAKE_UPS_HEADER,
    formatNumberText,
    itemsPerSecondHelper,
    machineNodeCraftLine,
    maxRateLabel,
    rateHeader,
    shownNumberText,
} from './numberText';

const locale = 'en-US';

describe('formatNumberText', () => {
    it('rounds to the decimals asked for and drops trailing zeros', () => {
        expect(formatNumberText(22.96874920527133, { locale })).toBe('22.97');
        expect(formatNumberText(68.906247615814, { maxDecimals: 3, locale })).toBe('68.906');
        expect(formatNumberText(62.999999523163, { locale })).toBe('63');
        expect(formatNumberText(240, { locale })).toBe('240');
        expect(formatNumberText(5.2, { locale })).toBe('5.2');
        expect(formatNumberText(0.9996, { maxDecimals: 3, locale })).toBe('1');
    });

    it('does not group thousands', () => {
        expect(formatNumberText(12345.678, { locale })).toBe('12345.68');
    });

    it('gives a whole number with no decimals', () => {
        expect(formatNumberText(22.96874920527133, { maxDecimals: 0, locale })).toBe('23');
    });

    it('gives 0 for 0 and -0', () => {
        expect(formatNumberText(0, { locale })).toBe('0');
        expect(formatNumberText(-0, { locale })).toBe('0');
    });

    it('never shows a tiny value as zero', () => {
        expect(formatNumberText(0.0004, { maxDecimals: 3, locale })).toBe('0.0004');
        expect(formatNumberText(0.00004, { maxDecimals: 3, locale })).toBe('0.00004');
        expect(formatNumberText(1e-7, { maxDecimals: 3, locale })).toBe('0.0000001');
        expect(formatNumberText(-0.0001, { maxDecimals: 3, locale })).toBe('-0.0001');
        for (const tiny of [0.0004, 0.00004, 1e-7, -0.0001, 0.004]) {
            expect(['0', '-0']).not.toContain(formatNumberText(tiny, { maxDecimals: 3, locale }));
            expect(['0', '-0']).not.toContain(formatNumberText(tiny, { locale }));
        }
    });

    it('gives non-finite values as they are', () => {
        expect(formatNumberText(NaN, { locale })).toBe('NaN');
        expect(formatNumberText(Infinity, { locale })).toBe('Infinity');
    });

    it('uses the locale\'s decimal separator', () => {
        expect(formatNumberText(22.9687, { locale: 'de-DE' })).toBe('22,97');
    });
});

describe('shownNumberText', () => {
    const field = { inputValue: '68.906247615814', value: 68.906247615814, maxDecimals: 3, locale };

    it('shows what is typed while focused', () => {
        expect(shownNumberText({ ...field, focused: true })).toBe('68.906247615814');
    });

    it('shows the rounded value while not focused', () => {
        expect(shownNumberText({ ...field, focused: false })).toBe('68.906');
    });

    it('shows what is typed when the field holds no number', () => {
        expect(shownNumberText({ ...field, focused: false, value: null, inputValue: '' })).toBe('');
        expect(shownNumberText({ ...field, focused: false, value: NaN, inputValue: 'abc' })).toBe('abc');
        expect(shownNumberText({ ...field, focused: false, value: Infinity, inputValue: '1e400' })).toBe('1e400');
    });
});

describe('maxRateLabel', () => {
    it('gives the rate to 2 decimals', () => {
        expect(maxRateLabel(22.96874920527133, locale)).toBe('max 22.97/s');
    });
});

describe('itemsPerSecondHelper', () => {
    it('gives the total and the share of each copy', () => {
        expect(itemsPerSecondHelper(240, 11, locale)).toBe('Total for all 11 copies (21.82/s each)');
    });

    it('says the total is for the build with one copy or numbers that cannot be shared', () => {
        expect(itemsPerSecondHelper(240, 1, locale)).toBe('Total for the build');
        expect(itemsPerSecondHelper(0, 5, locale)).toBe('Total for the build');
        expect(itemsPerSecondHelper(NaN, 2, locale)).toBe('Total for the build');
        expect(itemsPerSecondHelper(10, 0, locale)).toBe('Total for the build');
    });
});

describe('rateHeader', () => {
    it('names the copies the rate is the total of', () => {
        expect(rateHeader(11)).toBe('Rate (items/s, all 11 copies)');
        expect(rateHeader(1)).toBe('Rate (items/s)');
    });
});

describe('machineNodeCraftLine', () => {
    it('gives the craft ticks and the insertion limit', () => {
        expect(machineNodeCraftLine(5.2, 15, locale)).toBe('5.2t craft · insertion limit ×15');
    });

    it('rounds the ticks to one decimal', () => {
        expect(machineNodeCraftLine(5.25, 15.5, locale)).toBe('5.3t craft · insertion limit ×15.5');
        expect(machineNodeCraftLine(5.2244897959, 15, locale)).toBe('5.2t craft · insertion limit ×15');
    });
});

describe('the clocks table headers', () => {
    it('are the plan\'s words', () => {
        expect(WAKE_UPS_HEADER).toBe('Wake-ups/min (1 copy)');
        expect(OUTPUT_PER_PERIOD_HEADER).toBe('Output per period (1 copy)');
    });
});
