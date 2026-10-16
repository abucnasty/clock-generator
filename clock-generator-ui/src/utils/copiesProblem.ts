import { isShortDecimalCopies } from 'clock-generator/light';

export const COPIES_POSITIVE_PROBLEM = 'Set Copies to more than 0.';

/** The same value boundary as the engine, shared by the field, first problem and target-limit guard. */
export function copiesProblem(copies: number): string | null {
    if (!Number.isFinite(copies) || copies <= 0) return COPIES_POSITIVE_PROBLEM;
    return isShortDecimalCopies(copies) ? null : 'Use a whole number or a short decimal for Copies, such as 0.5 or 2.25.';
}
