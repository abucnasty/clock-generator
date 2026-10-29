import Fraction from "../../data-types/fraction";

/** An exact rate as plain data, as `SerializableMachineFacts` keeps one: numerator over denominator */
export interface Ratio {
    readonly numerator: number;
    readonly denominator: number;
}

export function ratioOf(value: Fraction): Ratio {
    return { numerator: value.getNumerator, denominator: value.getDenominator };
}

/**
 * The fraction a ratio was made of (`ratioOf`): its pair is already reduced, so the fraction is the same one, numerator
 * and denominator, and so is everything worked out from it
 */
export function fractionOf(ratio: Ratio): Fraction {
    return new Fraction(ratio.numerator, ratio.denominator);
}

/** A ratio as the decimal its fraction gives (`Fraction.toDecimal`): numerator over denominator, bit for bit */
export function decimalOf(ratio: Ratio): number {
    return ratio.numerator / ratio.denominator;
}
