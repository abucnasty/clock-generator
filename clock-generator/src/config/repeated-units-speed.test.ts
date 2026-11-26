import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Config } from './schema';
import { loadConfigFromFile } from './loader';
import { findRepeatedUnits } from './copies-validator';
import { planRepeatedUnitConversion } from './repeated-unit-conversion';

/**
 * The grenade build written out as seven units, one beside the other 12 tiles apart. The drills of the end unit have a lower speed
 * bonus than the others' (17.725 against 19.0575), which alone tells its units apart; each unit still makes its share. In the second
 * build four assemblers of two units are slower too, so that those units do not make their share.
 */
const fixture = (name: string) => loadConfigFromFile(path.join(__dirname, 'fixtures', name));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('copies written out that differ only in a speed', () => {
    let seven: Config;
    let slow: Config;
    beforeAll(async () => {
        seven = await fixture('grenade-240-seven-units.json');
        slow = await fixture('grenade-240-seven-units-slow-assemblers.json');
    });

    it('are found as copies where each unit makes its share', () => {
        expect(findRepeatedUnits(seven).gcd).toBe(7);
    });

    it('convert to one unit with 7 copies, keeping the unit of least capacity and the gap between the units', () => {
        const plan = planRepeatedUnitConversion(seven);
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        expect([plan.multiplicity, plan.copies]).toEqual([7, 7]);
        // the end unit, whose drills are the slower ones
        expect(plan.retained.machines.map(it => it.sourceId)).toEqual(range(31, 35));
        expect(plan.retained.drills.map(it => it.sourceId)).toEqual(range(25, 28));
        expect(plan.candidate.setpoint.copy_offset).toEqual({ x: 12, y: 0 });
    });

    it('are not copies where a unit does not make its share', () => {
        expect(findRepeatedUnits(slow).gcd).toBe(1);
        const plan = planRepeatedUnitConversion(slow);
        expect(plan.kind === 'unavailable' && plan.reason.code).toBe('not-repeated');
    });
});
