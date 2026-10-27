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

/**
 * The recycler of the exact-speed ore voider, as the engine's facts have it: 540 crafts a second, each using 1 iron ore
 * and giving back a quarter of one on average (135 a second), and the overbeaconed one at 852.3 crafts a second.
 */
const recycler = (crafts: number, exact?: { numerator: number; denominator: number }) => ({
    output_item: 'iron-ore', output_per_craft: 0.25, output_rate_per_second: crafts / 4,
    ...(exact && { output_rate_ratio: exact }),
    inputs: [{ item_name: 'iron-ore', consumption_rate_per_second: crafts, automated_insertion_limit: 4, amount_per_craft: 1 }],
});

describe('machinesMaxOf for a target that counts the item destroyed', () => {
    it('is the crafts a second times what a craft uses less what it gives back: 540 x (1 - 1/4) = 405', () => {
        const max = machinesMaxOf('iron-ore', [{ id: 1, facts: recycler(540, { numerator: 135, denominator: 1 }), comesBack: true }], 'destroyed')!;
        expect(max.machineIds).toEqual([1]);
        expect(max.perCopy).toBe(405);
        expect(max.perCopyRatio).toEqual({ numerator: 405, denominator: 1 });
        expect(totalMachineCapacity(max, 1)).toBe(405);
        expect(isTargetAboveMax(400, 1, max)).toBe(false);
        expect(isTargetAboveMax(405, 1, max)).toBe(false);
        expect(isTargetAboveMax(405.01, 1, max)).toBe(true);
    });

    it('is 639.2 for the overbeaconed recycler, 852.3 x 0.75', () => {
        const max = machinesMaxOf('iron-ore', [{ id: 1, facts: recycler(852.3), comesBack: true }], 'destroyed')!;
        expect(max.perCopy).toBeCloseTo(639.225, 6);
        expect(maxRateText(max.perCopy, 'en-US')).toBe('639.22/s');
    });

    it('takes off nothing when what it gives back is not taken back into it', () => {
        const max = machinesMaxOf('iron-ore', [{ id: 1, facts: recycler(540, { numerator: 135, denominator: 1 }) }], 'destroyed')!;
        expect(max.perCopy).toBe(540);
        expect(max.perCopyRatio).toEqual({ numerator: 540, denominator: 1 });
    });

    it('takes off nothing when the machine\'s own output is another item', () => {
        const facts = { ...recycler(10), output_item: 'copper-ore' };
        expect(machinesMaxOf('iron-ore', [{ id: 1, facts, comesBack: true }], 'destroyed')!.perCopy).toBe(10);
    });

    it('counts the machines that take the item in, not the ones that make it', () => {
        const max = machinesMaxOf('iron-ore', [
            { id: 1, facts: recycler(540), comesBack: true },
            { id: 2, facts: { output_item: 'iron-ore', output_rate_per_second: 99, output_per_craft: 1, inputs: [] } },
            { id: 3, facts: recycler(100), comesBack: true },
        ], 'destroyed')!;
        expect(max.machineIds).toEqual([1, 3]);
        expect(max.perCopy).toBe(405 + 75);
        expect(machinesMaxOf('iron-ore', [{ id: 2, facts: { output_item: 'iron-ore', output_rate_per_second: 99 } }], 'destroyed')).toBeNull();
        expect(machinesMaxOf('iron-ore', [{ id: 1, facts: recycler(540) }, { id: 2, facts: null }], 'destroyed')!.machineIds).toEqual([1]);
    });

    it('is unknown while a machine\'s facts are, and when the facts do not say what a craft uses', () => {
        expect(machinesMaxOf('iron-ore', [{ id: 1, facts: recycler(540) }, { id: 2, facts: undefined }], 'destroyed')).toBeNull();
        const { output_per_craft: _, ...without } = recycler(540);
        void _;
        expect(machinesMaxOf('iron-ore', [{ id: 1, facts: without }], 'destroyed')).toBeNull();
    });

    it('says destroys in the line under the rate, and gives the same line as before for a target that counts the item made', () => {
        const max = machinesMaxOf('iron-ore', [{ id: 1, facts: recycler(540, { numerator: 135, denominator: 1 }), comesBack: true }], 'destroyed')!;
        const destroyed = (itemsPerSecond: number, copies = 1) => targetRateLineOf({ itemsPerSecond, copies, max, counts: 'destroyed', locale: 'en-US' });
        expect(destroyed(400)).toBeNull();
        expect(destroyed(406)).toBe('At most 405/s: Machine 1 destroys 405/s. Lower the rate or raise Copies. Describe one unit in the build.');
        expect(destroyed(4000, 2)).toBe('At most 810/s: Machine 1 destroys 405/s, times 2 copies. Lower the rate or raise Copies. Describe one unit in the build.');
        const two: MachinesMax = { machineIds: [1, 2], perCopy: 30 };
        expect(targetRateLineOf({ itemsPerSecond: 400, copies: 1, max: two, counts: 'destroyed', locale: 'en-US' }))
            .toBe('At most 30/s: Machines 1 and 2 destroy 30/s together. Lower the rate or raise Copies. Describe one unit in the build.');
        expect(targetRateLineOf({ itemsPerSecond: 400, copies: 1, max: two, counts: 'made', locale: 'en-US' }))
            .toBe('At most 30/s: Machines 1 and 2 make 30/s together. Lower the rate or raise Copies. Describe one unit in the build.');
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
