import { describe, expect, it } from 'vitest';
import type { TargetCounts } from './targetCounts';
import { isTargetAboveMax, machinesMaxOf, maxRateText, targetRateLineOf, totalMachineCapacity, type MachinesMax } from './targetRateLimit';

/**
 * Machine 1 of the logistic science sample (crafting speed 68.906, productivity 100%), as the engine computes it: 11
 * copies make 252.65624125798462/s, the capacity its check names. The engine's check (validateConfig) passes 252.65 and
 * 22.96 (one copy), and refuses 252.66 and 22.97.
 */
const MACHINE_1_MAX = 22.96874920527133;

const one: MachinesMax = { machineIds: [1], perCopy: MACHINE_1_MAX };
const two: MachinesMax = { machineIds: [1, 2], perCopy: 30 };
const line = (itemsPerSecond: number, copies: number, max: MachinesMax | null = one, counts?: TargetCounts) =>
    targetRateLineOf({ itemsPerSecond, copies, max, locale: 'en-US', ...(counts && { counts }) });
/** The line under the rate, from the most on: what makes it, then what to do */
const atMost = (most: string) => `At most ${most}. Lower the rate or raise Copies. Describe one unit in the build.`;
const facts = (output_item: string, output_rate_per_second: number) => ({ output_item, output_rate_per_second });
const gears = (id: number, rate: number) => ({ id, facts: facts('iron-gear-wheel', rate) });

describe('machinesMaxOf', () => {
    it.each([
        ['sums the machines whose output item is the target, as the engine picks them', 'iron-gear-wheel',
            [gears(1, 10), { id: 2, facts: facts('iron-plate', 99) }, gears(3, 2.5)], { machineIds: [1, 3], perCopy: 12.5 }],
        ['goes by the output item, not the recipe: a recipe named otherwise is made by no machine', 'advanced-oil-processing', [{ id: 1, facts: facts('heavy-oil', 10) }], null],
        ['is unknown while a machine\'s facts are, whatever it makes', 'iron-gear-wheel', [gears(1, 10), { id: 2, facts: undefined }], null],
        ['leaves out a machine whose facts could not be worked out', 'iron-gear-wheel', [gears(1, 10), { id: 2, facts: null }], { machineIds: [1], perCopy: 10 }],
        ['is null when no machine makes the target', 'iron-gear-wheel', [{ id: 2, facts: null }], null],
        ['is null without machines', 'iron-gear-wheel', [], null],
        ['is null without a target', '', [gears(1, 10)], null],
    ])('%s', (_, target, machines, max) => {
        expect(machinesMaxOf(target, machines)).toEqual(max);
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
/** The voider's recycler, with its exact output rate */
const voider = recycler(540, { numerator: 135, denominator: 1 });
const destroying = (...machines: Parameters<typeof machinesMaxOf>[1]) => machinesMaxOf('iron-ore', machines, 'destroyed');

describe('machinesMaxOf for a target that counts the item destroyed', () => {
    it('is the crafts a second times what a craft uses less what it gives back: 540 x (1 - 1/4) = 405', () => {
        const max = destroying({ id: 1, facts: voider, comesBack: true })!;
        expect(max).toEqual({ machineIds: [1], perCopy: 405, perCopyRatio: { numerator: 405, denominator: 1 } });
        expect(totalMachineCapacity(max, 1)).toBe(405);
        expect(isTargetAboveMax(400, 1, max)).toBe(false);
        expect(isTargetAboveMax(405, 1, max)).toBe(false);
        expect(isTargetAboveMax(405.01, 1, max)).toBe(true);
    });

    it('is 639.2 for the overbeaconed recycler, 852.3 x 0.75', () => {
        const max = destroying({ id: 1, facts: recycler(852.3), comesBack: true })!;
        expect(max.perCopy).toBeCloseTo(639.225, 6);
        expect(maxRateText(max.perCopy, 'en-US')).toBe('639.22/s');
    });

    it('takes off nothing when what it gives back is not taken back into it', () => {
        expect(destroying({ id: 1, facts: voider })).toEqual({ machineIds: [1], perCopy: 540, perCopyRatio: { numerator: 540, denominator: 1 } });
    });

    it('takes off nothing when the machine\'s own output is another item', () => {
        const facts = { ...recycler(10), output_item: 'copper-ore' };
        expect(destroying({ id: 1, facts, comesBack: true })!.perCopy).toBe(10);
    });

    it('counts the machines that take the item in, not the ones that make it', () => {
        const max = destroying(
            { id: 1, facts: recycler(540), comesBack: true },
            { id: 2, facts: { output_item: 'iron-ore', output_rate_per_second: 99, output_per_craft: 1, inputs: [] } },
            { id: 3, facts: recycler(100), comesBack: true },
        )!;
        expect(max.machineIds).toEqual([1, 3]);
        expect(max.perCopy).toBe(405 + 75);
        expect(destroying({ id: 2, facts: { output_item: 'iron-ore', output_rate_per_second: 99 } })).toBeNull();
        expect(destroying({ id: 1, facts: recycler(540) }, { id: 2, facts: null })!.machineIds).toEqual([1]);
    });

    it('is unknown while a machine\'s facts are, and when the facts do not say what a craft uses', () => {
        expect(destroying({ id: 1, facts: recycler(540) }, { id: 2, facts: undefined })).toBeNull();
        const { output_per_craft: _, ...without } = recycler(540);
        void _;
        expect(destroying({ id: 1, facts: without })).toBeNull();
    });

    it('says destroys in the line under the rate, and gives the same line as before for a target that counts the item made', () => {
        const max = destroying({ id: 1, facts: voider, comesBack: true });
        expect(line(400, 1, max, 'destroyed')).toBeNull();
        expect(line(406, 1, max, 'destroyed')).toBe(atMost('405/s: Machine 1 destroys 405/s'));
        expect(line(4000, 2, max, 'destroyed')).toBe(atMost('810/s: Machine 1 destroys 405/s, times 2 copies'));
        expect(line(400, 1, two, 'destroyed')).toBe(atMost('30/s: Machines 1 and 2 destroy 30/s together'));
        expect(line(400, 1, two, 'made')).toBe(atMost('30/s: Machines 1 and 2 make 30/s together'));
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
    it.each<[string, number, number, MachinesMax | null, string | null]>([
        ['gives the most first, then what makes it, then what to do', 240200, 11, one, atMost('252.65/s: Machine 1 makes 22.96/s, times 11 copies')],
        ['names several machines, and what they make together', 400, 11, two, atMost('330/s: Machines 1 and 2 make 30/s together, times 11 copies')],
        ['names three machines', 50, 1, { machineIds: [1, 2, 4], perCopy: 45.5 }, atMost('45.5/s: Machines 1, 2 and 4 make 45.5/s together')],
        ['counts every copy: one', 240, 1, one, atMost('22.96/s: Machine 1 makes 22.96/s')],
        ['counts every copy: a target the copies can make has no line', 240, 11, one, null],
        ['counts every copy: ten', 240, 10, one, atMost('229.68/s: Machine 1 makes 22.96/s, times 10 copies')],
        // without exact ratios, the legacy numeric facts pass and refuse what the engine's check does
        ['uses the legacy numeric facts: passes what the engine passes', 252.65, 11, one, null],
        ['uses the legacy numeric facts: passes the capacity the check names', 252.65624125798462, 11, one, null],
        ['uses the legacy numeric facts: passes a target just under it', 252.656, 11, one, null],
        ['uses the legacy numeric facts: refuses what the engine refuses', 252.66, 11, one, atMost('252.65/s: Machine 1 makes 22.96/s, times 11 copies')],
        ['uses the legacy numeric facts: passes what the engine passes for one copy', 22.96, 1, one, null],
        ['uses the legacy numeric facts: refuses what the engine refuses for one copy', 22.97, 1, one, atMost('22.96/s: Machine 1 makes 22.96/s')],
        ['says nothing without a target', 0, 11, one, null],
        ['says nothing while the machines\' most is not known', 240200, 11, null, null],
    ])('%s: %s/s, %s copies', (_, itemsPerSecond, copies, max, text) => {
        expect(line(itemsPerSecond, copies, max)).toBe(text);
    });

    it('finds no target above the most when it is not finite, or without copies', () => {
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
