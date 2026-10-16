import { fraction } from "../data-types/fraction";

/** The most the denominator of `copies` may be once it is read as a reduced fraction: 5.5 is 11/2, 2.25 is 9/4 */
const MAX_COPIES_DENOMINATOR = 1000;

/** Whether a number reads as an exact fraction with a small denominator, as a whole number or a short decimal does */
export function isShortDecimalCopies(value: number): boolean {
    try {
        return fraction(value).getDenominator <= MAX_COPIES_DENOMINATOR;
    } catch {
        return false;
    }
}

/** The schema refinement message also identifies this editable form-value problem at the worker boundary. */
export const COPIES_DECIMAL_ERROR = "copies must be a whole number or a short decimal such as 5.5";
