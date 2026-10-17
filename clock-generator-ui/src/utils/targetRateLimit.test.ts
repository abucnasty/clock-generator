import { describe, expect, it } from 'vitest';
import { isTargetAboveMax, machinesMaxOf, maxRateText, targetRateLineOf, totalMachineCapacity, type MachinesMax } from './targetRateLimit';

/**
 * Machine 1 of the logistic science sample (crafting speed 68.906, productivity 100%), as the engine computes it: 11
 * copies make 252.65624125798462/s, the capacity its check names. The engine's check (validateConfig) passes 252.65 and
 * 22.96 (one copy), and refuses 252.66 and 22.97.
 */
const MACHINE_1_MAX = 22.96874920527133;

const one: MachinesMax = { machineIds: [1], perCopy: MACHINE_1_MAX };
const line = (itemsPerSecond: number, copies: number, max: MachinesMax | null = one) =>
    targetRateLineOf({ itemsPerSecond, copies, max, locale: 'en-US' });
const facts = (output_item: string, output_rate_per_second: number) => ({ output_item, output_rate_per_second });

describe('machinesMaxOf', () => {
    it('sums the machines whose output item is the target, as the engine picks them', () => {
        expect(machinesMaxOf('iron-gear-wheel', [
            { id: 1, facts: facts('iron-gear-wheel', 10) },
            { id: 2, facts: facts('iron-plate', 99) },
            { id: 3, facts: facts('iron-gear-wheel', 2.5) },
        ])).toEqual({ machineIds: [1, 3], perCopy: 12.5 });
    });

    it('goes by the output item, not the recipe: a recipe named otherwise is made by no machine', () => {
        expect(machinesMaxOf('advanced-oil-processing', [{ id: 1, facts: facts('heavy-oil', 10) }])).toBeNull();
    });

    it('is unknown while a machine\'s facts are, whatever it makes', () => {
        expect(machinesMaxOf('iron-gear-wheel', [{ id: 1, facts: facts('iron-gear-wheel', 10) }, { id: 2, facts: undefined }])).toBeNull();
    });

    it('leaves out a machine whose facts could not be worked out, and is null when none makes the target', () => {
        expect(machinesMaxOf('iron-gear-wheel', [{ id: 1, facts: facts('iron-gear-wheel', 10) }, { id: 2, facts: null }])).toEqual({ machineIds: [1], perCopy: 10 });
        expect(machinesMaxOf('iron-gear-wheel', [{ id: 2, facts: null }])).toBeNull();
        expect(machinesMaxOf('iron-gear-wheel', [])).toBeNull();
        expect(machinesMaxOf('', [{ id: 1, facts: facts('iron-gear-wheel', 10) }])).toBeNull();
    });
});

describe('maxRateText', () => {
    it('rounds down, so that a target typed in from it can be made', () => {
        expect(maxRateText(252.65624125798462, 'en-US')).toBe('252.65/s');
        expect(maxRateText(MACHINE_1_MAX, 'en-US')).toBe('22.96/s');
        expect(maxRateText(0.29, 'en-US')).toBe('0.29/s');
        expect(maxRateText(30, 'en-US')).toBe('30/s');
        expect(maxRateText(0.0047, 'en-US')).toBe('0.0047/s');
        expect(maxRateText(0.00479, 'en-US')).toBe('0.0047/s');
    });
});

describe('targetRateLineOf', () => {
    it('gives the most first, then what makes it, then what to do', () => {
        expect(line(240200, 11)).toBe('At most 252.65/s: Machine 1 makes 22.96/s, times 11 copies. Lower the rate or raise Copies. Describe one unit in the build.');
    });

    it('names several machines, and what they make together', () => {
        const two: MachinesMax = { machineIds: [1, 2], perCopy: 30 };
        expect(line(400, 11, two)).toBe('At most 330/s: Machines 1 and 2 make 30/s together, times 11 copies. Lower the rate or raise Copies. Describe one unit in the build.');
        const three: MachinesMax = { machineIds: [1, 2, 4], perCopy: 45.5 };
        expect(line(50, 1, three)).toBe('At most 45.5/s: Machines 1, 2 and 4 make 45.5/s together. Lower the rate or raise Copies. Describe one unit in the build.');
    });

    it('counts every copy: a target the copies can make has no line', () => {
        expect(line(240, 1)).toBe('At most 22.96/s: Machine 1 makes 22.96/s. Lower the rate or raise Copies. Describe one unit in the build.');
        expect(line(240, 11)).toBeNull();
        expect(line(240, 10)).toBe('At most 229.68/s: Machine 1 makes 22.96/s, times 10 copies. Lower the rate or raise Copies. Describe one unit in the build.');
    });

    it('uses the legacy numeric facts when exact ratios are unavailable', () => {
        expect(line(252.65, 11)).toBeNull();
        expect(line(252.65624125798462, 11)).toBeNull();
        expect(line(252.656, 11)).toBeNull();
        expect(line(252.66, 11)).not.toBeNull();
        expect(line(22.96, 1)).toBeNull();
        expect(line(22.97, 1)).toBe('At most 22.96/s: Machine 1 makes 22.96/s. Lower the rate or raise Copies. Describe one unit in the build.');
    });

    it('says nothing without a target, or while the machines\' most is not known', () => {
        expect(line(0, 11)).toBeNull();
        expect(line(240200, 11, null)).toBeNull();
        expect(isTargetAboveMax(Number.POSITIVE_INFINITY, 1, one)).toBe(false);
        expect(isTargetAboveMax(240200, 0, one)).toBe(false);
    });
});


describe('unsupported rate arithmetic remains an editable worker-validation concern', () => {
    const exact: MachinesMax = { machineIds: [1], perCopy: 2, perCopyRatio: { numerator: 2, denominator: 1 } };

    it('does not throw or invent a local capacity problem for unsupported target precision', () => {
        expect(isTargetAboveMax(1e-23, 1, exact)).toBe(false);
        expect(line(1e-23, 1, exact)).toBeNull();
    });

    it('keeps overflowed exact and legacy products unknown, without a misleading limit', () => {
        for (const max of [exact, { machineIds: [1], perCopy: 2 }]) {
            expect(totalMachineCapacity(max, 1e308)).toBeNull();
            expect(isTargetAboveMax(1, 1e308, max)).toBe(false);
            expect(line(1, 1e308, max)).toBeNull();
        }
    });

    it('never substitutes a numeric estimate when an exact ratio cannot be read', () => {
        const invalid = { ...exact, perCopyRatio: { numerator: 1, denominator: 0 } };
        expect(totalMachineCapacity(invalid, 1)).toBeNull();
        expect(isTargetAboveMax(3, 1, invalid)).toBe(false);
        expect(line(3, 1, invalid)).toBeNull();
        expect(machinesMaxOf('gear', [{ id: 1, facts: {
            output_item: 'gear', output_rate_per_second: 2, output_rate_ratio: invalid.perCopyRatio,
        } }])).toBeNull();
    });

    it('keeps overflowed sums unknown for exact and legacy facts', () => {
        for (const output_rate_ratio of [undefined, { numerator: 1e308, denominator: 1 }]) {
            expect(machinesMaxOf('gear', [1, 2].map(id => ({ id, facts: {
                output_item: 'gear', output_rate_per_second: 1e308, output_rate_ratio,
            } })))).toBeNull();
        }
    });
});
