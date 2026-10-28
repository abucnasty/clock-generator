import { describe, expect, it } from 'vitest';
import {
    COPIES_HELPER,
    OUTPUT_PER_PERIOD_HEADER,
    TICK_DECIMALS,
    WAKE_UPS_HEADER,
    durationText,
    formatNumberText,
    itemsPerSecondHelper,
    machineNodeCraftLine,
    makesHeader,
    maxRateLabel,
    rateHeader,
    shownNumberText,
    NUMBER_FIELD_INPUT_FORMAT,
    isUneditedPrecisionLoss,
} from './numberText';

const locale = 'en-US';

describe('formatNumberText', () => {
    it.each<[string, number, number | undefined, string]>([
        ['rounds to 2 decimals by default', 22.96874920527133, undefined, '22.97'],
        ['rounds to the decimals asked for', 68.906247615814, 3, '68.906'],
        ['rounds a negative value the same', -68.906247615814, 3, '-68.906'],
        ['drops trailing zeros', 62.999999523163, undefined, '63'],
        ['drops trailing zeros', 240, undefined, '240'],
        ['drops trailing zeros', 5.2, undefined, '5.2'],
        ['drops trailing zeros', 0.9996, 3, '1'],
        ['rounds half up at the last decimal', 0.0005, 3, '0.001'],
        ['keeps a value just under the half', 0.00049999, 3, '0.0005'],
        ['does not group thousands', 12345.678, undefined, '12345.68'],
        ['gives a whole number with no decimals', 22.96874920527133, 0, '23'],
        ['gives 0 for 0', 0, undefined, '0'],
        ['gives 0 for -0', -0, undefined, '0'],
        ['gives non-finite values as they are', NaN, undefined, 'NaN'],
        ['gives non-finite values as they are', Infinity, undefined, 'Infinity'],
    ])('%s: %s', (_, value, maxDecimals, text) => {
        expect(formatNumberText(value, { locale, ...(maxDecimals !== undefined && { maxDecimals }) })).toBe(text);
    });

    it.each([[0.0004, '0.0004'], [0.00004, '0.00004'], [1e-7, '0.0000001'], [-0.0001, '-0.0001'], [0.004, '0.004']])(
        'never shows the tiny %s as zero, at 3 decimals or the default 2', (value, text) => {
            expect(formatNumberText(value, { maxDecimals: 3, locale })).toBe(text);
            expect(formatNumberText(value, { locale })).toBe(text);
        },
    );

    it('uses the locale\'s decimal separator', () => {
        expect(formatNumberText(22.9687, { locale: 'de-DE' })).toBe('22,97');
    });
});

describe('shownNumberText', () => {
    const field = { inputValue: '68.906247615814', value: 68.906247615814, maxDecimals: 3, locale, focused: false };

    it.each([
        ['what is typed while focused', { focused: true }, '68.906247615814'],
        ['the rounded value while not focused', {}, '68.906'],
        ['what is typed when the field is cleared', { value: null, inputValue: '' }, ''],
        ['what is typed when the field holds no number', { value: NaN, inputValue: 'abc' }, 'abc'],
        ['what is typed when the field holds no finite number', { value: Infinity, inputValue: '1e400' }, '1e400'],
    ])('shows %s', (_, change, text) => {
        expect(shownNumberText({ ...field, ...change })).toBe(text);
    });

    it('keeps invalid input full when requested, retaining valid blurred rounding by default', () => {
        const third = { ...field, value: 0.3333333333333333, inputValue: '0.3333333333333333' };
        expect(shownNumberText({ ...third, preserveInputOnBlur: true })).toBe('0.3333333333333333');
        expect(shownNumberText({ ...third, preserveInputOnBlur: false })).toBe('0.333');
        expect(shownNumberText(third)).toBe('0.333');
        expect(third.value).toBe(0.3333333333333333);
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
        expect(itemsPerSecondHelper(5, 0.5, locale)).toBe('Total for all 0.5 copies (10/s each)');
    });

    it('says the total is for the build with one copy or numbers that cannot be shared', () => {
        expect(itemsPerSecondHelper(240, 1, locale)).toBe('Total for the build');
        expect(itemsPerSecondHelper(0, 5, locale)).toBe('Total for the build');
        expect(itemsPerSecondHelper(NaN, 2, locale)).toBe('Total for the build');
        expect(itemsPerSecondHelper(10, 0, locale)).toBe('Total for the build');
    });
});

describe('the clocks table headers', () => {
    it('are the plan\'s words, with non-breaking spaces inside the brackets', () => {
        expect(WAKE_UPS_HEADER).toBe('Wake-ups/min (1\u00a0copy)');
        expect(OUTPUT_PER_PERIOD_HEADER).toBe('Output per clock period (1\u00a0copy)');
    });

    it.each([
        [11, '(items/s,\u00a0all\u00a011\u00a0copies)'],
        [1, '(items/s)'],
        [0.5, '(items/s,\u00a0all\u00a00.5\u00a0copies)'],
    ])('name the copies the rate and what the clock makes are the total of: %s', (copies, unit) => {
        expect(rateHeader(copies)).toBe(`Rate ${unit}`);
        expect(makesHeader(copies)).toBe(`Makes ${unit}`);
    });
});

describe('COPIES_HELPER', () => {
    it('says what a copy is and what the clock is made for', () => {
        expect(COPIES_HELPER).toBe("Describe one identical unit. Copies may include a partial unit, such as 0.5 or 2.25.");
    });
});

describe('durationText', () => {
    it('gives the ticks and the seconds in one form', () => {
        expect(durationText(240, locale)).toBe('240 ticks (4\u00a0s)');
        expect(durationText(1234.5678, locale)).toBe('1234.568 ticks (20.58\u00a0s)');
        expect(durationText(1.5, locale)).toBe('1.5 ticks (0.03\u00a0s)');
    });
});

describe('machineNodeCraftLine', () => {
    it('gives the craft ticks, rounded to the decimals Machine Facts shows them with, and the insertion limit', () => {
        expect(machineNodeCraftLine(5.2, 15, locale)).toBe('5.2t craft · insertion limit ×15');
        expect(machineNodeCraftLine(5.25, 15.5, locale)).toBe('5.25t craft · insertion limit ×15.5');
        expect(machineNodeCraftLine(5.2244897959, 15, locale)).toBe(`${formatNumberText(5.2244897959, { maxDecimals: TICK_DECIMALS, locale })}t craft · insertion limit ×15`);
        expect(machineNodeCraftLine(5.2244897959, 15, locale)).toBe('5.224t craft · insertion limit ×15');
    });
});

describe('controlled NumberField precision', () => {
    it.each([1e-23, Number.MIN_VALUE, 0.3333333333333333, 0.0625, 68.906247615814, Number.MAX_VALUE])(
        'keeps %s in the default input text while retaining twenty-fraction-digit edit precision', value => {
            expect(NUMBER_FIELD_INPUT_FORMAT.maximumFractionDigits).toBe(20);
            expect(Number(new Intl.NumberFormat('en-US', NUMBER_FIELD_INPUT_FORMAT).format(value))).toBe(value);
        },
    );

    const blur = { value: 1e-23, nextValue: 0, reason: 'input-blur', edited: false, customFormat: false };
    it('preserves an unedited tiny controlled value on blur', () => {
        expect(isUneditedPrecisionLoss(blur)).toBe(true);
        expect(isUneditedPrecisionLoss({ ...blur, value: Number.MIN_VALUE, min: 0 })).toBe(true);
    });

    it('leaves actual edits, steppers, clearing, normal numbers and supplied formats unchanged', () => {
        for (const change of [
            { edited: true }, { reason: 'input-change' }, { reason: 'increment-press' },
            { nextValue: null }, { value: 0, nextValue: 0 }, { value: 0.0625, nextValue: 0.0625 },
            { value: 16, nextValue: 17 }, { customFormat: true },
            { value: undefined }, { value: null }, { value: Infinity }, { value: NaN },
        ]) expect(isUneditedPrecisionLoss({ ...blur, ...change })).toBe(false);
    });

    it('does not mistake min/max clamping for precision rounding', () => {
        for (const change of [{ value: -1e-23, min: 0 }, { max: 0 }, { value: -1, min: 0 }, { value: 17, nextValue: 16, max: 16 }]) {
            expect(isUneditedPrecisionLoss({ ...blur, ...change })).toBe(false);
        }
    });
});
