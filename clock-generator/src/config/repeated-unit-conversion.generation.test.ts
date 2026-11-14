import { describe, expect, it } from 'vitest';
import type { Config } from './schema';
import { planRepeatedUnitConversion } from './repeated-unit-conversion';
import { planClockAlternatives } from '../crafting/generate-blueprint';
import { quiet } from '../crafting/generate-blueprint-test-helpers';

/**
 * Eight gear machines that take plates off one belt and drop gears onto another, at 3.5 gears a second for the eight; the
 * plate lane ends dead, and with `fed` two inserters fill it from infinity chests that nothing drops into
 */
function gearUnits(fed: boolean): Config {
    const machines = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }));
    const inserters: Config['inserters'] = Array.from({ length: 8 }, (_, i) => [
        { id: 2 * i + 1, source: { type: 'belt' as const, id: 1, near_lane: 1 as const }, sink: { type: 'machine' as const, id: i + 1 }, stack_size: 1, filters: ['iron-plate'] },
        { id: 2 * i + 2, source: { type: 'machine' as const, id: i + 1 }, sink: { type: 'belt' as const, id: 2 }, stack_size: 1, filters: ['iron-gear-wheel'] },
    ]).flat();
    if (fed) inserters.push(
        { id: 17, source: { type: 'chest', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 1, filters: ['iron-plate'] },
        { id: 18, source: { type: 'chest', id: 2 }, sink: { type: 'belt', id: 1 }, stack_size: 1, filters: ['iron-plate'] },
    );
    const chest = (id: number) => ({ id, type: 'infinity-chest' as const, item_filter: [{ item_name: 'iron-plate', request_count: 100 }] });
    return {
        setpoint: { recipe: 'iron-gear-wheel', items_per_second: 3.5, copies: 0.5 },
        machines, inserters,
        belts: [
            { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1, lane_end: { kind: 'dead_end' } }] },
            { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
        ],
        chests: fed ? [chest(1), chest(2)] : [], overrides: { check_start_dependence: false, kick_start_items: 0 },
    } as Config;
}

describe('the one copy of a build whose input belt is filled from chests', () => {
    it('is planned as the one copy written by hand without those inserters: the belt counts as supplied', () => {
        const plan = planRepeatedUnitConversion(gearUnits(true));
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        const unfed = planRepeatedUnitConversion(gearUnits(false));
        expect(unfed.kind).toBe('available');
        if (unfed.kind !== 'available') return;
        expect(plan.candidate).toEqual(unfed.candidate);
        const converted = planClockAlternatives(plan.candidate, { logger: quiet });
        const byHand = planClockAlternatives(unfed.candidate, { logger: quiet });
        expect(converted.primary?.signature).toBe(byHand.primary?.signature);
        expect(converted.context.primary_stable).toBe(true);
    }, 300_000);
});
