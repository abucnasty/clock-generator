import { AssertionError } from "../common/assert";
import { TICKS_PER_SECOND } from "../data-types/constants";
import Fraction, { fraction } from "../data-types/fraction";
import { decimalOf, fractionOf, ratioOf, type Ratio } from "../entities/traits/ratio";

export type SetpointRate = number | Ratio;

function gcd(a: bigint, b: bigint): bigint {
    while (b !== 0n) [a, b] = [b, a % b];
    return a;
}

export function isRatePair(value: unknown): value is Ratio {
    if (typeof value !== "object" || value === null || Object.keys(value).length !== 2
        || !Object.prototype.hasOwnProperty.call(value, "numerator") || !Object.prototype.hasOwnProperty.call(value, "denominator")) return false;
    const { numerator, denominator } = value as Ratio;
    return Number.isSafeInteger(numerator) && numerator > 0 && Number.isSafeInteger(denominator) && denominator > 0
        && gcd(BigInt(numerator), BigInt(denominator)) === 1n;
}

export function isPositiveRate(value: unknown): value is SetpointRate {
    return typeof value === "number" ? Number.isFinite(value) && value > 0 : isRatePair(value);
}

export function rateText(rate: SetpointRate): string {
    return typeof rate === "number" ? String(rate) : `${rate.numerator}/${rate.denominator}`;
}

/** Projection at a boundary that already measures or compares doubles. */
export const rateDecimal = (rate: SetpointRate): number => typeof rate === "number" ? rate : decimalOf(rate);

export function canonicalRate<T>(config: T): T {
    if (typeof config !== "object" || config === null || !("setpoint" in config)) return config;
    const setpoint = config.setpoint;
    if (typeof setpoint !== "object" || setpoint === null || !("items_per_second" in setpoint)) return config;
    const rate = setpoint.items_per_second;
    if (!isRatePair(rate) || Object.keys(rate)[0] === "numerator") return config;
    const { numerator, denominator } = rate;
    return { ...config, setpoint: { ...setpoint, items_per_second: { numerator, denominator } } };
}

export const RATE_PRECISION_ERROR = "This rate exceeds the supported precision. Change the rate or Copies.";

function reduce(n: bigint, d: bigint) {
    const factor = gcd(n, d);
    return { n: n / factor, d: d / factor };
}

function checked(n: bigint, d: bigint, message: string): Fraction {
    const pair = reduce(n, d);
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    if (pair.n > max || pair.d > max) throw new AssertionError(message);
    return fraction(Number(pair.n), Number(pair.d));
}

export function exactRateUnits(rate: Ratio, copies: number) {
    if (!isRatePair(rate)) throw new RangeError("The rate must be a reduced positive fraction.");
    const c = fraction(copies);
    if (!(copies > 0) || c.getDenominator > 1000) throw new RangeError(RATE_PRECISION_ERROR);
    const n = BigInt(rate.numerator), d = BigInt(rate.denominator);
    const cn = BigInt(c.getNumerator), cd = BigInt(c.getDenominator);
    const ticks = BigInt(TICKS_PER_SECOND.getNumerator);
    return {
        totalSecond: fractionOf(rate),
        totalTick: checked(n, d * ticks, RATE_PRECISION_ERROR),
        copySecond: checked(n * cd, d * cn, RATE_PRECISION_ERROR),
        copyTick: checked(n * cd, d * cn * ticks, RATE_PRECISION_ERROR),
    };
}

/** Narrow only the complete product needed by the caller. */
export function exactPeriod(rate: Ratio, numerators: readonly number[], denominators: readonly number[], name: string): Fraction {
    const message = `The ${name} period at ${rateText(rate)} items/s exceeds exact precision.`;
    const product = (factors: readonly number[]) => factors.reduce((n, factor) => {
        if (!Number.isSafeInteger(factor) || factor <= 0) throw new AssertionError(message);
        return n * BigInt(factor);
    }, 1n);
    return checked(product(numerators), product(denominators), message);
}

export function composedPeriod(base: Fraction, cycles: number, rate?: Ratio): Fraction {
    return rate ? exactPeriod(rate, [base.getNumerator, cycles], [base.getDenominator], "window cycle") : base.multiply(cycles);
}

export function periodAtLimit(period: Fraction, limit: number, exact: boolean): boolean {
    return exact ? BigInt(period.getNumerator) >= BigInt(period.getDenominator) * BigInt(limit) : period.toDecimal() >= limit;
}

export function exactCycleLcm(a: number, b: number, rate: Ratio): number {
    const message = `The cycle multiplier at ${rateText(rate)} items/s exceeds exact precision.`;
    if (![a, b].every(value => Number.isSafeInteger(value) && value > 0)) throw new AssertionError(message);
    const x = BigInt(a), y = BigInt(b);
    return checked(x / gcd(x, y) * y, 1n, message).getNumerator;
}

/** Compare to the sum of per-copy capacities without narrowing the sum. */
export function compareRateToCapacity(rate: Ratio, parts: readonly Ratio[], copies: number) {
    let sum = { n: 0n, d: 1n };
    for (const part of parts) {
        const n = BigInt(part.numerator), d = BigInt(part.denominator);
        sum = reduce(sum.n * d + n * sum.d, sum.d * d);
    }
    const c = ratioOf(fraction(copies));
    const total = reduce(sum.n * BigInt(c.numerator), sum.d * BigInt(c.denominator));
    const difference = BigInt(rate.numerator) * total.d - BigInt(rate.denominator) * total.n;
    return { above: difference > 0n, equal: difference === 0n,
        bound: total.d === 1n ? String(total.n) : `${total.n}/${total.d}` };
}
