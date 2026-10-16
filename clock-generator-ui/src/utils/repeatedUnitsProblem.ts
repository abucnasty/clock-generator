import type { CopiesError } from 'clock-generator/browser';
import { fraction } from 'clock-generator/light';

/** Uses the engine's structured detection result; it never detects or changes units itself. */
export function repeatedUnitsProblem(error: Pick<CopiesError, 'units' | 'configured_copies' | 'copies_found'>): string {
    const groups = error.units.map((unit, index) => `unit ${index + 1}: ${unit.machine_ids.length === 1 ? 'Machine' : 'Machines'} ${unit.machine_ids.join(', ')}`).join('; ');
    const copies = fraction(error.configured_copies).multiply(error.copies_found).toDecimal();
    return `This selection contains ${error.copies_found} identical units (${groups}). `
        + `In Factorio, select just one unit and paste it again. Set Copies to ${copies}. `
        + 'Keep Items per Second as the total rate for all copies. Your build has not been changed.';
}
