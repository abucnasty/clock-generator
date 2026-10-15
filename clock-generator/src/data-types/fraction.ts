/**
 * Exact rational arithmetic for the generator.
 *
 * This replaces the `fractionability` package, whose multiply, divide and subtract build their result by
 * printing the product into a string and parsing it again. Once a product passes about 1e21, JavaScript prints
 * it in exponent notation and the parser throws (`Invalid input format: 2.38e+27/1.04e+25`); even before that,
 * beyond 2^53 the products are inexact and the gcd reduction is silently wrong. The generator hands in numbers
 * with float noise (crafting speeds such as 68.89999866485596 parse to denominators near 1e14), so a long chain
 * of multiplications overflowed.
 *
 * Parsing is the library's, input for input (integers, non-integer numbers by multiplying by 10 until they are
 * integers, "n/d" strings, the two-argument integer form), so every existing sample computes the same values.
 *
 * Arithmetic is exact. Operands and results are stored as plain numbers; whenever a plain product could pass
 * Number.MAX_SAFE_INTEGER the calculation is done with BigInt and reduced with a BigInt gcd. A reduced result
 * that fits in safe integers is stored exactly as it is.
 *
 * The one place this stops being exact: a reduced result whose numerator or denominator still does not fit in a
 * safe integer is replaced by the closest fraction whose denominator is at most 2^40 (and whose numerator is
 * safe), found by continued fractions on the BigInt value. That bound is needed because the speeds carry float
 * noise: a chain of such factors has an exact result with a denominator that grows without limit, while nothing
 * downstream is more precise than a double. The error of one bounding is below one part in 2^80 of the value,
 * far under the float noise already in the inputs. A value too large for a safe integer even as a whole number
 * is stored as the nearest double with denominator 1.
 */

class FractionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FractionError";
    }
}

type InputType = Fraction | string | number;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_DENOMINATOR = 2n ** 40n;

function parseInput(input: unknown): { numerator: number; denominator: number } {
    let value = (input as { toString(): string } | null | undefined)?.toString().trim();
    if (!value) throw new FractionError("Input cannot be empty");
    let isNegative = false;
    if (value.startsWith("-")) {
        isNegative = true;
        value = value.slice(1);
    }
    if (value.endsWith("%")) {
        const percentValue = parseFloat(value.slice(0, -1));
        if (isNaN(percentValue)) throw new FractionError(`Invalid percentage: ${value}`);
        return { numerator: isNegative ? -percentValue : percentValue, denominator: 100 };
    }
    if (value.includes(":")) {
        const [num, den] = value.split(":").map(Number);
        if (isNaN(num) || isNaN(den) || den === 0) throw new FractionError(`Invalid ratio: ${value}`);
        return { numerator: isNegative ? -num : num, denominator: den };
    }
    if (/^\d+$/.test(value)) {
        const numerator = parseInt(value, 10);
        if (isNaN(numerator)) throw new FractionError(`Invalid whole number: ${value}`);
        return { numerator: isNegative ? -numerator : numerator, denominator: 1 };
    }
    if (/^\d+\/\d+$/.test(value)) {
        const [num, den] = value.split("/").map(Number);
        if (isNaN(num) || isNaN(den) || den === 0) throw new FractionError(`Invalid fraction: ${value}`);
        return { numerator: isNegative ? -num : num, denominator: den };
    }
    if (/^\d+ \d+\/\d+$/.test(value)) {
        const [whole, part] = value.split(" ");
        const [num, den] = part.split("/").map(Number);
        if (isNaN(parseInt(whole, 10)) || isNaN(num) || isNaN(den) || den === 0) {
            throw new FractionError(`Invalid mixed number: ${value}`);
        }
        const numerator = parseInt(whole, 10) * den + num;
        return { numerator: isNegative ? -numerator : numerator, denominator: den };
    }
    if (/^\d+\.\d+$/.test(value)) {
        let decimal = parseFloat(value);
        if (isNaN(decimal)) throw new FractionError(`Invalid decimal: ${value}`);
        let denominator = 1;
        while (decimal % 1 !== 0) {
            decimal *= 10;
            denominator *= 10;
        }
        return { numerator: isNegative ? -decimal : decimal, denominator };
    }
    if (typeof input === "number" && !isNaN(input)) {
        if (Number.isInteger(input)) return { numerator: input, denominator: 1 };
        let decimal = input;
        let denominator = 1;
        while (decimal % 1 !== 0) {
            decimal *= 10;
            denominator *= 10;
        }
        return { numerator: decimal, denominator };
    }
    throw new FractionError(`Invalid input format: ${input}`);
}

function gcdNumber(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b !== 0) {
        [a, b] = [b, a % b];
    }
    return a;
}

function gcdBig(a: bigint, b: bigint): bigint {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b !== 0n) {
        [a, b] = [b, a % b];
    }
    return a;
}

function absBig(a: bigint): bigint {
    return a < 0n ? -a : a;
}

/** The fraction nearest to n/d (d > 0) with denominator <= 2^40 and numerator <= MAX_SAFE_INTEGER, as numbers. */
function boundedApproximation(n: bigint, d: bigint): { numerator: number; denominator: number } {
    const negative = n < 0n;
    const absN = absBig(n);
    let [x, y] = [absN, d];
    let [h2, h1, k2, k1] = [0n, 1n, 1n, 0n];
    while (y !== 0n) {
        const a = x / y;
        [x, y] = [y, x % y];
        const h = a * h1 + h2;
        const k = a * k1 + k2;
        if (k > MAX_DENOMINATOR || h > MAX_SAFE) {
            if (k1 === 0n) {
                // The whole-number part alone does not fit: nearest double over 1.
                const whole = Number(absN / d);
                return { numerator: negative ? -whole : whole, denominator: 1 };
            }
            const t = [a, (MAX_DENOMINATOR - k2) / k1, (MAX_SAFE - h2) / h1].reduce((m, v) => (v < m ? v : m));
            let [bestH, bestK] = [h1, k1];
            if (t >= 1n) {
                const semiH = t * h1 + h2;
                const semiK = t * k1 + k2;
                const semiError = absBig(semiH * d - absN * semiK) * bestK;
                const bestError = absBig(bestH * d - absN * bestK) * semiK;
                if (semiError < bestError) [bestH, bestK] = [semiH, semiK];
            }
            return { numerator: Number(negative ? -bestH : bestH), denominator: Number(bestK) };
        }
        [h2, h1, k2, k1] = [h1, h, k1, k];
    }
    return { numerator: Number(negative ? -h1 : h1), denominator: Number(k1) };
}

export default class Fraction {
    private numerator: number;
    private denominator: number;

    constructor(value: number | string, denominator?: number) {
        if (typeof value === "number" && denominator !== undefined) {
            if (!Number.isInteger(value) || !Number.isInteger(denominator)) {
                throw new Error("Numerator and denominator must be integers");
            }
            if (denominator === 0) {
                throw new Error("Denominator cannot be zero");
            }
            this.numerator = value;
            this.denominator = denominator;
        } else {
            const parsed = parseInput(value);
            this.numerator = parsed.numerator;
            this.denominator = parsed.denominator;
        }
        this.simplify();
    }

    get getNumerator(): number {
        return this.numerator;
    }

    get getDenominator(): number {
        return this.denominator;
    }

    private simplify(): void {
        if (this.denominator === 0) throw new Error("Denominator cannot be zero");
        const divisor = gcdNumber(this.numerator, this.denominator);
        let num = this.numerator / divisor;
        let den = this.denominator / divisor;
        if (den < 0) {
            num = -num;
            den = -den;
        }
        // Normalise -0 so that structural comparison of two equal fractions holds.
        this.numerator = num === 0 ? 0 : num;
        this.denominator = den;
    }

    toString(): string {
        const numerator = this.numerator;
        const denominator = this.denominator;
        const sign = numerator < 0 !== denominator < 0 ? "-" : "";
        const absNumerator = Math.abs(numerator);
        const absDenominator = Math.abs(denominator);
        if (absNumerator === absDenominator) return `${sign}1`;
        if (absDenominator === 1) return `${sign}${absNumerator}`;
        return `${sign}${absNumerator}/${absDenominator}`;
    }

    toDecimal(): number {
        return this.numerator / this.denominator;
    }

    add(value: InputType): Fraction {
        const other = Fraction.from(value);
        const p = this.numerator * other.denominator;
        const q = other.numerator * this.denominator;
        const num = p + q;
        const den = this.denominator * other.denominator;
        if (Number.isSafeInteger(p) && Number.isSafeInteger(q) && Number.isSafeInteger(num) && Number.isSafeInteger(den)) {
            return new Fraction(num, den);
        }
        return Fraction.fromBigInts(
            BigInt(this.numerator) * BigInt(other.denominator) + BigInt(other.numerator) * BigInt(this.denominator),
            BigInt(this.denominator) * BigInt(other.denominator),
        );
    }

    subtract(value: InputType): Fraction {
        const other = Fraction.from(value);
        const p = this.numerator * other.denominator;
        const q = other.numerator * this.denominator;
        const num = p - q;
        const den = this.denominator * other.denominator;
        if (Number.isSafeInteger(p) && Number.isSafeInteger(q) && Number.isSafeInteger(num) && Number.isSafeInteger(den)) {
            return new Fraction(num, den);
        }
        return Fraction.fromBigInts(
            BigInt(this.numerator) * BigInt(other.denominator) - BigInt(other.numerator) * BigInt(this.denominator),
            BigInt(this.denominator) * BigInt(other.denominator),
        );
    }

    multiply(value: InputType): Fraction {
        const other = Fraction.from(value);
        const num = this.numerator * other.numerator;
        const den = this.denominator * other.denominator;
        if (Number.isSafeInteger(num) && Number.isSafeInteger(den)) {
            return new Fraction(num, den);
        }
        return Fraction.fromBigInts(
            BigInt(this.numerator) * BigInt(other.numerator),
            BigInt(this.denominator) * BigInt(other.denominator),
        );
    }

    divide(value: InputType): Fraction {
        const other = Fraction.from(value);
        if (other.numerator === 0) throw new FractionError(`Invalid fraction: ${this.numerator * other.denominator}/0`);
        const num = this.numerator * other.denominator;
        const den = this.denominator * other.numerator;
        if (Number.isSafeInteger(num) && Number.isSafeInteger(den)) {
            return new Fraction(num, den);
        }
        return Fraction.fromBigInts(
            BigInt(this.numerator) * BigInt(other.denominator),
            BigInt(this.denominator) * BigInt(other.numerator),
        );
    }

    private static from(value: InputType): Fraction {
        return value instanceof Fraction ? value : new Fraction(value);
    }

    /** Reduces an exact BigInt ratio; stores it as is when it fits safe integers, else bounds it (see the file comment). */
    private static fromBigInts(n: bigint, d: bigint): Fraction {
        if (d < 0n) {
            n = -n;
            d = -d;
        }
        const divisor = gcdBig(n, d);
        if (divisor > 1n) {
            n /= divisor;
            d /= divisor;
        }
        if (absBig(n) <= MAX_SAFE && d <= MAX_SAFE) {
            return new Fraction(Number(n), Number(d));
        }
        const bounded = boundedApproximation(n, d);
        return new Fraction(bounded.numerator, bounded.denominator);
    }
}

export function fraction(value: number | string, denominator?: number): Fraction {
    return new Fraction(value, denominator);
}
