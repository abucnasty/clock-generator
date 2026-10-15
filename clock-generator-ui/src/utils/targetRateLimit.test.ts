import { describe, expect, it } from 'vitest';
import { isTargetAboveMax, machinesMaxOf, targetRateLineOf, type MachinesMax } from './targetRateLimit';

/** Machine 1 of the logistic science sample: crafting speed 68.906, productivity 100% */
const MACHINE_1_MAX = 22.968749205271;

const one: MachinesMax = { machineIds: [1], perCopy: MACHINE_1_MAX };
const line = (itemsPerSecond: number, copies: number, max: MachinesMax | null = one) =>
    targetRateLineOf({ itemsPerSecond, copies, max, locale: 'en-US' });

describe('machinesMaxOf', () => {
    it('sums the max rates of the machines making the target recipe', () => {
        expect(machinesMaxOf([{ id: 1, maxRate: 10 }, { id: 3, maxRate: 2.5 }])).toEqual({ machineIds: [1, 3], perCopy: 12.5 });
    });

    it('is unknown while a machine\'s facts are, and when no machine makes the recipe', () => {
        expect(machinesMaxOf([{ id: 1, maxRate: 10 }, { id: 2, maxRate: undefined }])).toBeNull();
        expect(machinesMaxOf([{ id: 1, maxRate: null }])).toBeNull();
        expect(machinesMaxOf([{ id: 1, maxRate: Number.NaN }])).toBeNull();
        expect(machinesMaxOf([])).toBeNull();
    });
});

describe('targetRateLineOf', () => {
    it('names one machine and what the copies make, in the rates Machine Facts prints', () => {
        expect(line(240200, 11)).toBe('Machine 1 makes at most 22.97/s; 11 copies make 252.66/s.');
    });

    it('names several machines, and what they make together', () => {
        const two: MachinesMax = { machineIds: [1, 2], perCopy: 30 };
        expect(line(400, 11, two)).toBe('Machines 1 and 2 make at most 30/s together; 11 copies make 330/s.');
        const three: MachinesMax = { machineIds: [1, 2, 4], perCopy: 45.5 };
        expect(line(50, 1, three)).toBe('Machines 1, 2 and 4 make at most 45.5/s together.');
    });

    it('counts every copy: a target the copies can make has no line', () => {
        // more than one copy makes, less than 11 do
        expect(line(240, 1)).toBe('Machine 1 makes at most 22.97/s.');
        expect(line(240, 11)).toBeNull();
        expect(line(240, 10)).toBe('Machine 1 makes at most 22.97/s; 10 copies make 229.69/s.');
    });

    it('has no line for a target at the max as it is printed, only beyond it', () => {
        // 11 copies make 252.656…/s, printed 252.66
        expect(line(252.656, 11)).toBeNull();
        expect(line(252.66, 11)).toBeNull();
        expect(line(252.664, 11)).toBeNull();
        expect(line(252.666, 11)).toBe('Machine 1 makes at most 22.97/s; 11 copies make 252.66/s.');
        expect(line(252.67, 11)).not.toBeNull();
        // one machine's max typed in from Machine Facts' "max 22.97/s"
        expect(line(22.97, 1)).toBeNull();
        expect(line(22.98, 1)).not.toBeNull();
    });

    it('says nothing without a target, or while the machines\' max is not known', () => {
        expect(line(0, 11)).toBeNull();
        expect(line(240200, 11, null)).toBeNull();
        expect(isTargetAboveMax(Number.POSITIVE_INFINITY, 1, one)).toBe(false);
        expect(isTargetAboveMax(240200, 0, one)).toBe(false);
    });
});
