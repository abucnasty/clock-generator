/**
 * How a number reads on the page, and the words that go with the numbers of the target output and the clocks table.
 * The one place that rounds a number for display; the stored values are never rounded.
 */

/** Decimals of a rate (items per second) */
const RATE_DECIMALS = 2;
/** Decimals of a tick count, and of the other small facts of a machine */
export const TICK_DECIMALS = 3;
/** Decimals a number field shows while it is not focused */
export const FIELD_DECIMALS = 3;

interface NumberTextOptions {
    /** At most this many decimals; trailing zeros are dropped. Defaults to the decimals of a rate */
    maxDecimals?: number;
    /** Defaults to the browser's, as the number fields use */
    locale?: Intl.LocalesArgument;
}

/**
 * `value` rounded to at most `maxDecimals` decimals, without trailing zeros or grouping ("5.2", "63", "12345.68").
 * A value too small to show at those decimals is shown to 2 significant digits instead, so it never reads as 0.
 */
export function formatNumberText(value: number, options: NumberTextOptions = {}): string {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    if (value === 0) {
        return '0';
    }
    const maxDecimals = options.maxDecimals ?? RATE_DECIMALS;
    const tooSmall = Math.abs(value) < 0.5 * 10 ** -maxDecimals;
    const format: Intl.NumberFormatOptions = tooSmall
        ? { maximumSignificantDigits: 2, useGrouping: false }
        : { maximumFractionDigits: maxDecimals, minimumFractionDigits: 0, useGrouping: false };
    return new Intl.NumberFormat(options.locale, format).format(value);
}

/**
 * The text a number field shows: what is typed while it is focused (the full value), the value rounded while it is not.
 * A field that is cleared or does not hold a number shows what is typed.
 */
export function shownNumberText(args: {
    focused: boolean;
    value: number | null;
    inputValue: string;
    maxDecimals: number;
    locale?: Intl.LocalesArgument;
}): string {
    const { focused, value, inputValue, maxDecimals, locale } = args;
    if (focused || value === null || !Number.isFinite(value)) {
        return inputValue;
    }
    return formatNumberText(value, { maxDecimals, locale });
}

/** The most a machine can make: "max 22.97/s" */
export function maxRateLabel(rate: number, locale?: Intl.LocalesArgument): string {
    return `max ${formatNumberText(rate, { locale })}/s`;
}

/** Under Items per Second: the target is the total for every copy, and what one copy makes of it */
export function itemsPerSecondHelper(itemsPerSecond: number, copies: number, locale?: Intl.LocalesArgument): string {
    const shared = copies > 1 && Number.isFinite(copies) && itemsPerSecond > 0 && Number.isFinite(itemsPerSecond);
    if (!shared) {
        return 'Total for the build';
    }
    return `Total for all ${copies} copies (${formatNumberText(itemsPerSecond / copies, { locale })}/s each)`;
}

/** Under Copies */
export const COPIES_HELPER = "Identical copies of this build you'll place. The clock is made for one copy.";

/** A non-breaking space: the headers below wrap before their brackets, never inside them */
const NBSP = ' ';

/** Potential Clocks header of the wake-ups, which are counted on one copy */
export const WAKE_UPS_HEADER = `Wake-ups/min (1${NBSP}copy)`;
/** Potential Clocks header of what one copy's clock-only run moved in a clock period */
export const OUTPUT_PER_PERIOD_HEADER = `Output per clock period (1${NBSP}copy)`;

/** Potential Clocks header of the rate, which is the total for all the copies the clocks were made for */
export function rateHeader(copies: number): string {
    return copies > 1 ? `Rate (items/s,${NBSP}all${NBSP}${copies}${NBSP}copies)` : 'Rate (items/s)';
}

/** The diagram machine node's last line: "5.224t craft · insertion limit ×15", the ticks at the precision Machine Facts uses */
export function machineNodeCraftLine(ticksPerCraft: number, overloadMultiplier: number, locale?: Intl.LocalesArgument): string {
    const ticks = formatNumberText(ticksPerCraft, { maxDecimals: TICK_DECIMALS, locale });
    return `${ticks}t craft · insertion limit ×${formatNumberText(overloadMultiplier, { locale })}`;
}
