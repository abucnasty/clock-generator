import { describe, expect, it } from "vitest";
import * as Library from "fractionability";
import Fraction, { fraction } from "./fraction";

const NOISY_SPEEDS = [68.89999866485596, 40.312498807907104, 191.49999618530273, 180.79999923706055];

const PARSE_INPUTS: Array<[number | string] | [number, number]> = [
    [0],
    [1],
    [7],
    [0.5],
    [1.75],
    [100.0625],
    [68.89999866485596],
    [40.312498807907104],
    [191.49999618530273],
    ["3/4"],
    ["6/8"],
    [1, 60],
    [-5],
    [-2.5],
    ["12"],
    [6, -4],
];

function parts(value: { getNumerator: number; getDenominator: number }) {
    return [value.getNumerator, value.getDenominator];
}

describe("Fraction parsing", () => {
    it.each(PARSE_INPUTS)("parses %s like the library does", (...args) => {
        const ours = new Fraction(...(args as [number, number?]));
        const theirs = new Library.default(...(args as [number, number?]));
        expect(parts(ours)).toEqual(parts(theirs));
    });

    it("builds fraction(1, 60) as 1/60", () => {
        expect(parts(fraction(1, 60))).toEqual([1, 60]);
    });

    it("keeps the denominator positive", () => {
        expect(parts(fraction(6, -4))).toEqual([-3, 2]);
    });

    it("rejects a zero denominator and non-integer parts", () => {
        expect(() => fraction(1, 0)).toThrow("Denominator cannot be zero");
        expect(() => fraction(1.5, 2)).toThrow("Numerator and denominator must be integers");
    });
});

describe("Fraction arithmetic against the library where the library is exact", () => {
    const operands: Array<number | string> = [0, 1, 7, 0.5, 1.75, 100.0625, "3/4", "6/8", 0.1, 2.5];

    it("add, subtract, multiply and divide agree for small operands", () => {
        for (const a of operands) {
            for (const b of operands) {
                const ours = fraction(a as number);
                const theirs = Library.fraction(a as number);
                expect(parts(ours.add(fraction(b as number)))).toEqual(parts(theirs.add(Library.fraction(b as number))));
                expect(parts(ours.multiply(fraction(b as number)))).toEqual(
                    parts(theirs.multiply(Library.fraction(b as number))),
                );
                expect(parts(ours.subtract(fraction(b as number)))).toEqual(
                    parts(theirs.subtract(Library.fraction(b as number))),
                );
                if (b !== 0) {
                    expect(parts(ours.divide(fraction(b as number)))).toEqual(
                        parts(theirs.divide(Library.fraction(b as number))),
                    );
                }
            }
        }
    });

    it("takes a plain number as an operand", () => {
        expect(parts(fraction(3, 4).multiply(0.5))).toEqual([3, 8]);
        expect(parts(fraction(3, 4).add(1))).toEqual([7, 4]);
        expect(parts(fraction(3, 4).subtract(1))).toEqual([-1, 4]);
        expect(parts(fraction(3, 4).divide(3))).toEqual([1, 4]);
    });

    it("divides by a negative fraction, which the library cannot", () => {
        expect(parts(fraction(3, 4).divide(fraction(-3, 2)))).toEqual([-1, 2]);
    });

    it("rejects division by zero", () => {
        expect(() => fraction(3).divide(0)).toThrow();
    });
});

describe("Fraction on a chain that overflows the library", () => {
    const factors = [...NOISY_SPEEDS, 1.75, 4, ...NOISY_SPEEDS, 1.75];

    it("reproduces the library's failure on the same chain", () => {
        let thrown: unknown;
        try {
            let value = Library.fraction(1);
            for (const factor of factors) value = value.multiply(factor);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeDefined();
        expect((thrown as Error).name).toBe("FractionError");
        expect((thrown as Error).message).toMatch(/^Invalid input format: .*e\+/);
    });

    it("multiplies the chain and divides back, finite and within 1e-9 of the floating-point product", () => {
        let value = fraction(1);
        let expected = 1;
        for (const factor of factors) {
            value = value.multiply(factor);
            expected *= factor;
            expect(Number.isFinite(value.toDecimal())).toBe(true);
            expect(Math.abs(value.toDecimal() - expected) / expected).toBeLessThan(1e-9);
        }
        for (const divisor of [0.5, 0.5, 4, 1.75]) {
            value = value.divide(divisor);
            expected /= divisor;
            expect(Math.abs(value.toDecimal() - expected) / expected).toBeLessThan(1e-9);
        }
        expect(Number.isFinite(value.getNumerator)).toBe(true);
        expect(value.getDenominator).toBeLessThanOrEqual(2 ** 40);
    });

    it("divides the chain back to one with a bounded denominator and a safe numerator", () => {
        let value = fraction(1);
        for (const factor of factors) value = value.multiply(factor);
        for (const factor of factors) value = value.divide(factor);
        expect(Math.abs(value.toDecimal() - 1)).toBeLessThan(1e-9);
        expect(Number.isSafeInteger(value.getNumerator)).toBe(true);
        expect(Number.isSafeInteger(value.getDenominator)).toBe(true);
        expect(value.getDenominator).toBeLessThanOrEqual(2 ** 40);
    });

    it("adds and subtracts operands whose cross products pass 2^53", () => {
        const a = fraction(NOISY_SPEEDS[1]);
        const b = fraction(NOISY_SPEEDS[2]);
        const sum = a.add(b).toDecimal();
        const difference = a.subtract(b).toDecimal();
        expect(Math.abs(sum - (NOISY_SPEEDS[1] + NOISY_SPEEDS[2])) / sum).toBeLessThan(1e-12);
        expect(Math.abs(difference - (NOISY_SPEEDS[1] - NOISY_SPEEDS[2])) / Math.abs(difference)).toBeLessThan(1e-12);
    });

    it("is exact for a product whose reduced result fits safe integers, even when the plain product does not", () => {
        const big = fraction(2 ** 40 + 1, 3);
        const result = big.multiply(fraction(3 * 2 ** 20, 2 ** 40 + 1));
        expect(parts(result)).toEqual([2 ** 20, 1]);
    });

    it("keeps the sign when it bounds a negative result", () => {
        let value = fraction(-1);
        for (const factor of factors) value = value.multiply(factor);
        expect(value.toDecimal()).toBeLessThan(0);
        expect(Number.isSafeInteger(value.getDenominator)).toBe(true);
    });
});

describe("Fraction formats", () => {
    it("prints like the library", () => {
        for (const [n, d] of [
            [3, 4],
            [-3, 4],
            [3, -4],
            [6, 3],
            [-6, 3],
            [5, 5],
            [-5, 5],
            [0, 7],
            [1, 60],
        ]) {
            expect(fraction(n, d).toString()).toBe(Library.fraction(n, d).toString());
        }
        expect(fraction(3, 4).toString()).toBe("3/4");
        expect(fraction(6, 3).toString()).toBe("2");
        expect(fraction(5, 5).toString()).toBe("1");
        expect(fraction(-3, 4).toString()).toBe("-3/4");
        expect(fraction(-6, 3).toString()).toBe("-2");
    });

    it("converts to a decimal", () => {
        expect(fraction(3, 4).toDecimal()).toBe(0.75);
        expect(fraction(-1, 4).toDecimal()).toBe(-0.25);
        expect(fraction(1, 60).toDecimal()).toBe(1 / 60);
    });
});

describe("the review's cases (0.14.0)", () => {
    it("bounds a value under 1 whose exact result needs BigInt, instead of dividing by zero", () => {
        // 2^-60 has no fraction with a denominator of 2^40 or less nearer than 0 itself (1/2^40 is 2^-40 off), so the
        // bound gives 0: the resolution of the bound, documented in the class comment, not a failure
        const small = new Fraction(1, 2 ** 30).multiply(new Fraction(1, 2 ** 30));
        expect(Math.abs(small.toDecimal() - 2 ** -60)).toBeLessThanOrEqual(2 ** -40);
        expect(small.getDenominator).toBeLessThanOrEqual(2 ** 40);
        const negative = new Fraction(-1, 2 ** 30).multiply(new Fraction(1, 2 ** 30));
        expect(Math.abs(negative.toDecimal() + 2 ** -60)).toBeLessThanOrEqual(2 ** -40);
        // a value under 1 whose exact result fits safe integers is exact, with no bound on its denominator
        const held = new Fraction(1, 3).divide(new Fraction(2 ** 30 + 1, 1)).multiply(new Fraction(1, 2 ** 20 + 1));
        expect(held.getNumerator).toBe(1);
        expect(held.getDenominator).toBe(3 * (2 ** 30 + 1) * (2 ** 20 + 1));
        // one that does not fit is bounded and kept to the bound's precision
        const bounded = new Fraction(1, 2 ** 30 + 1).multiply(new Fraction(1, 2 ** 30 - 1));
        expect(Math.abs(bounded.toDecimal() - 1 / ((2 ** 30 + 1) * (2 ** 30 - 1)))).toBeLessThanOrEqual(2 ** -40);
        expect(bounded.getDenominator).toBeLessThanOrEqual(2 ** 40);
    });

    it("refuses a number it cannot read as a fraction instead of hanging", () => {
        expect(() => new Fraction(Infinity)).toThrow("Invalid input format");
        expect(() => new Fraction(NaN)).toThrow();
        expect(() => new Fraction(1e-300)).toThrow("too many decimal places");
        expect(() => fraction(1e-300)).toThrow("too many decimal places");
    });
});
