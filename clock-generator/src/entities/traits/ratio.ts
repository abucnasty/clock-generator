import Fraction from "../../data-types/fraction";

/** An exact rate as plain data, as `SerializableMachineFacts` keeps one: numerator over denominator */
export interface Ratio {
    readonly numerator: number;
    readonly denominator: number;
}

export function ratioOf(value: Fraction): Ratio {
    return { numerator: value.getNumerator, denominator: value.getDenominator };
}
