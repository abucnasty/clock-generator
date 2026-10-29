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
const line = (itemsPerSecond: number, copies: number, max: MachinesMax | null, counts?: TargetCounts) =>
    targetRateLineOf({ itemsPerSecond, copies, max, counts, locale: 'en-US' });
/** The line under the rate, from the most on: what makes it, then what to do */
const atMost = (most: string) => `At most ${most}. Lower the rate or raise Copies. Describe one unit in the build.`;
const facts = (output_item: string, output_rate_per_second: number) => ({ output_item, output_rate_per_second });
/** A machine making gear wheels at `rate` a second, `exact` being its exact rate */
const gears = (id: number, rate: number, exact?: { numerator: number; denominator: number }) =>
    ({ id, facts: { ...facts('iron-gear-wheel', rate), output_rate_ratio: exact } });
type Machines = Parameters<typeof machinesMaxOf>[1];

describe('machinesMaxOf', () => {
    it.each<{ why: string; target?: string; machines: Machines; max: MachinesMax | null }>([
        { why: 'sums the machines whose output item is the target, as the engine picks them',
            machines: [gears(1, 10), { id: 2, facts: facts('iron-plate', 99) }, gears(3, 2.5)], max: { machineIds: [1, 3], perCopy: 12.5 } },
        { why: 'goes by the output item, not the recipe: a recipe named otherwise is made by no machine', target: 'advanced-oil-processing',
            machines: [{ id: 1, facts: facts('heavy-oil', 10) }], max: null },
        { why: 'is unknown while a machine\'s facts are, whatever it makes', machines: [gears(1, 10), { id: 2, facts: undefined }], max: null },
        { why: 'leaves out a machine whose facts could not be worked out', machines: [gears(1, 10), { id: 2, facts: null }], max: { machineIds: [1], perCopy: 10 } },
        { why: 'is null when no machine makes the target', machines: [{ id: 2, facts: null }], max: null },
        { why: 'is null without machines', machines: [], max: null },
        { why: 'is null without a target', target: '', machines: [gears(1, 10)], max: null },
        // unsupported arithmetic leaves the most unknown, for the worker's check to report, rather than a numeric estimate
        { why: 'is unknown when an exact rate cannot be read', machines: [gears(1, 2, { numerator: 1, denominator: 0 })], max: null },
        { why: 'is unknown when legacy rates sum past the largest number', machines: [gears(1, 1e308), gears(2, 1e308)], max: null },
        { why: 'is unknown when exact rates sum past the largest number',
            machines: [gears(1, 1e308, { numerator: 1e308, denominator: 1 }), gears(2, 1e308, { numerator: 1e308, denominator: 1 })], max: null },
    ])('$why', ({ target = 'iron-gear-wheel', machines, max }) => {
        expect(machinesMaxOf(target, machines)).toStrictEqual(max);
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
/** What the voider's recycler destroys, what it gives back taken back into it: 540 x (1 - 1/4) = 405 */
const voiding: MachinesMax = { machineIds: [1], perCopy: 405, perCopyRatio: { numerator: 405, denominator: 1 } };
const overbeaconed = { id: 1, facts: recycler(852.3), comesBack: true };
const destroying = (...machines: Machines) => machinesMaxOf('iron-ore', machines, 'destroyed');

describe('machinesMaxOf for a target that counts the item destroyed', () => {
    it.each<{ why: string; machines: Machines; max: MachinesMax | null }>([
        { why: 'is the crafts a second times what a craft uses less what it gives back: 540 x (1 - 1/4) = 405', machines: [{ id: 1, facts: voider, comesBack: true }], max: voiding },
        { why: 'is 639.2 for the overbeaconed recycler, 852.3 x 0.75', machines: [overbeaconed], max: { machineIds: [1], perCopy: expect.closeTo(639.225, 6) } },
        { why: 'takes off nothing when what it gives back is not taken back into it', machines: [{ id: 1, facts: voider }],
            max: { machineIds: [1], perCopy: 540, perCopyRatio: { numerator: 540, denominator: 1 } } },
        { why: 'takes off nothing when the machine\'s own output is another item', machines: [{ id: 1, facts: { ...recycler(10), output_item: 'copper-ore' }, comesBack: true }],
            max: { machineIds: [1], perCopy: 10 } },
        { why: 'counts the machines that take the item in, not the ones that make it', machines: [
            { id: 1, facts: recycler(540), comesBack: true },
            { id: 2, facts: { output_item: 'iron-ore', output_rate_per_second: 99, output_per_craft: 1, inputs: [] } },
            { id: 3, facts: recycler(100), comesBack: true },
        ], max: { machineIds: [1, 3], perCopy: 405 + 75 } },
        { why: 'is null when no machine takes the item in', machines: [{ id: 2, facts: { output_item: 'iron-ore', output_rate_per_second: 99 } }], max: null },
        { why: 'leaves out a machine whose facts could not be worked out', machines: [{ id: 1, facts: recycler(540) }, { id: 2, facts: null }], max: { machineIds: [1], perCopy: 540 } },
        { why: 'is unknown while a machine\'s facts are', machines: [{ id: 1, facts: recycler(540) }, { id: 2, facts: undefined }], max: null },
        { why: 'is unknown when the facts do not say what a craft gives', machines: [{ id: 1, facts: { ...recycler(540), output_per_craft: undefined } }], max: null },
    ])('$why', ({ machines, max }) => {
        expect(destroying(...machines)).toStrictEqual(max);
    });
});

describe('maxRateText', () => {
    it.each([
        { why: 'the capacity the check names', rate: 252.65624125798462, text: '252.65/s' },
        { why: 'what machine 1 makes', rate: MACHINE_1_MAX, text: '22.96/s' },
        { why: 'a rate held as 0.28999…', rate: 0.29, text: '0.29/s' },
        { why: 'a whole rate', rate: 30, text: '30/s' },
        { why: 'under 0.01, to 2 significant digits', rate: 0.0047, text: '0.0047/s' },
        { why: 'under 0.01, rounded down', rate: 0.00479, text: '0.0047/s' },
        { why: 'what the overbeaconed recycler destroys', rate: destroying(overbeaconed)!.perCopy, text: '639.22/s' },
    ])('rounds down, so that a target typed in from it can be made: $why, $rate as $text', ({ rate, text }) => {
        expect(maxRateText(rate, 'en-US')).toBe(text);
    });
});

describe('targetRateLineOf', () => {
    it.each<{ why: string; rate: number; copies: number; max: MachinesMax | null; counts?: TargetCounts; text: string | null }>([
        { why: 'gives the most first, then what makes it, then what to do', rate: 240200, copies: 11, max: one, text: atMost('252.65/s: Machine 1 makes 22.96/s, times 11 copies') },
        { why: 'names several machines, and what they make together', rate: 400, copies: 11, max: two, text: atMost('330/s: Machines 1 and 2 make 30/s together, times 11 copies') },
        { why: 'names three machines', rate: 50, copies: 1, max: { machineIds: [1, 2, 4], perCopy: 45.5 }, text: atMost('45.5/s: Machines 1, 2 and 4 make 45.5/s together') },
        { why: 'counts every copy: one', rate: 240, copies: 1, max: one, text: atMost('22.96/s: Machine 1 makes 22.96/s') },
        { why: 'counts every copy: a target the copies can make has no line', rate: 240, copies: 11, max: one, text: null },
        { why: 'counts every copy: ten', rate: 240, copies: 10, max: one, text: atMost('229.68/s: Machine 1 makes 22.96/s, times 10 copies') },
        // without exact ratios, the legacy numeric facts pass and refuse what the engine's check does
        { why: 'uses the legacy numeric facts: passes what the engine passes', rate: 252.65, copies: 11, max: one, text: null },
        { why: 'uses the legacy numeric facts: passes the capacity the check names', rate: 252.65624125798462, copies: 11, max: one, text: null },
        { why: 'uses the legacy numeric facts: passes a target just under it', rate: 252.656, copies: 11, max: one, text: null },
        { why: 'uses the legacy numeric facts: refuses what the engine refuses', rate: 252.66, copies: 11, max: one, text: atMost('252.65/s: Machine 1 makes 22.96/s, times 11 copies') },
        { why: 'uses the legacy numeric facts: passes what the engine passes for one copy', rate: 22.96, copies: 1, max: one, text: null },
        { why: 'uses the legacy numeric facts: refuses what the engine refuses for one copy', rate: 22.97, copies: 1, max: one, text: atMost('22.96/s: Machine 1 makes 22.96/s') },
        { why: 'says nothing without a target', rate: 0, copies: 11, max: one, text: null },
        { why: 'says nothing while the machines\' most is not known', rate: 240200, copies: 11, max: null, text: null },
        // a target that counts the item destroyed says destroys; one that counts the item made, makes, as before
        { why: 'has no line for a target the machines can destroy', rate: 400, copies: 1, max: voiding, counts: 'destroyed', text: null },
        { why: 'says destroys', rate: 406, copies: 1, max: voiding, counts: 'destroyed', text: atMost('405/s: Machine 1 destroys 405/s') },
        { why: 'says destroys, times the copies', rate: 4000, copies: 2, max: voiding, counts: 'destroyed', text: atMost('810/s: Machine 1 destroys 405/s, times 2 copies') },
        { why: 'says destroy of several machines', rate: 400, copies: 1, max: two, counts: 'destroyed', text: atMost('30/s: Machines 1 and 2 destroy 30/s together') },
        { why: 'says make of several machines for a target that counts the item made', rate: 400, copies: 1, max: two, counts: 'made',
            text: atMost('30/s: Machines 1 and 2 make 30/s together') },
    ])('$why: $rate/s, $copies copies', ({ rate, copies, max, counts, text }) => {
        expect(line(rate, copies, max, counts)).toBe(text);
    });
});

describe('isTargetAboveMax', () => {
    it.each<{ why: string; rate: number; copies: number; max: MachinesMax; capacity: number; above: boolean }>([
        { why: 'a target under what the copies destroy', rate: 400, copies: 1, max: voiding, capacity: 405, above: false },
        { why: 'a target of just what they destroy', rate: 405, copies: 1, max: voiding, capacity: 405, above: false },
        { why: 'a target just above it', rate: 405.01, copies: 1, max: voiding, capacity: 405, above: true },
        { why: 'a target that is not finite', rate: Number.POSITIVE_INFINITY, copies: 1, max: one, capacity: MACHINE_1_MAX, above: false },
        { why: 'no copies', rate: 240200, copies: 0, max: one, capacity: 0, above: false },
    ])('compares the target with what the copies make: $why', ({ rate, copies, max, capacity, above }) => {
        expect(totalMachineCapacity(max, copies)).toBe(capacity);
        expect(isTargetAboveMax(rate, copies, max)).toBe(above);
    });
});

describe('unsupported rate arithmetic remains an editable worker-validation concern', () => {
    const exact: MachinesMax = { machineIds: [1], perCopy: 2, perCopyRatio: { numerator: 2, denominator: 1 } };
    it.each<{ why: string; rate: number; copies: number; max: MachinesMax; capacity: number | null }>([
        { why: 'a target of more precision than is supported', rate: 1e-23, copies: 1, max: exact, capacity: 2 },
        { why: 'an exact capacity whose product with the copies overflows', rate: 1, copies: 1e308, max: exact, capacity: null },
        { why: 'a legacy capacity whose product with the copies overflows', rate: 1, copies: 1e308, max: { machineIds: [1], perCopy: 2 }, capacity: null },
        { why: 'an exact ratio that cannot be read, never replaced by a numeric estimate', rate: 3, copies: 1, max: { ...exact, perCopyRatio: { numerator: 1, denominator: 0 } }, capacity: null },
    ])('finds no problem and gives no line, without throwing: $why', ({ rate, copies, max, capacity }) => {
        expect(totalMachineCapacity(max, copies)).toBe(capacity);
        expect(isTargetAboveMax(rate, copies, max)).toBe(false);
        expect(line(rate, copies, max)).toBeNull();
    });
});
