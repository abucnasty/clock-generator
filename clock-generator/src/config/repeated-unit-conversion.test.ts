import { describe, expect, it } from 'vitest';
import { Config, ConfigSchema } from './schema';
import { findRepeatedUnits } from './copies-validator';
import { planRepeatedUnitConversion } from './repeated-unit-conversion';
import { validateConfig } from '../crafting/plan/validate-config';

/** Actual free-lane gear build: four total items/s requires the multiplied Copies after extraction. */
function eightUnits(): Config {
    return {
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 4, copies: 0.5 },
        machines: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 })),
        inserters: Array.from({ length: 8 }, (_, i) => [
            { id: 2 * i + 1, source: { type: 'belt' as const, id: 1, near_lane: 1 as const }, sink: { type: 'machine' as const, id: i + 1 }, stack_size: 1, filters: ['iron-plate'] },
            { id: 2 * i + 2, source: { type: 'machine' as const, id: i + 1 }, sink: { type: 'belt' as const, id: 2 }, stack_size: 1, filters: ['iron-gear-wheel'] },
        ]).flat(),
        belts: [
            { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] },
            { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
        ], chests: [], overrides: { check_start_dependence: false, loop_seed_items: 0 },
    } as Config;
}

describe('complete repeated-unit conversion', () => {
    it('proves shared free-lane membership, preserves total, multiplies fractional Copies and passes real planning', () => {
        const source = eightUnits(), before = structuredClone(source);
        const plan = planRepeatedUnitConversion(source);
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        expect(plan.multiplicity).toBe(8);
        expect(plan.copies).toBe(4);
        expect(plan.candidate.target_output).toEqual({ ...source.target_output, copies: 4 });
        expect(plan.retained.machines).toEqual([{ sourceIndex: 0, sourceId: 1, resultId: 1 }]);
        expect(plan.retained.inserters.map(it => it.sourceIndex)).toEqual([0, 1]);
        expect(plan.candidate.belts).toEqual(source.belts);
        expect(plan.candidate.inserters).toEqual(source.inserters.slice(0, 2));
        expect(() => validateConfig(plan.candidate)).not.toThrow();
        expect(() => validateConfig({ ...plan.candidate, target_output: { ...plan.candidate.target_output, copies: 0.5 } })).toThrow('cannot meet the target');
        expect(source).toEqual(before);
        plan.candidate.belts[0].lanes[0].stack_size = 2;
        expect(source).toEqual(before);
    });

    it('retains the complete composite GCD unit, internal buffers/drills, fuel, rules and nontrivial ID maps', () => {
        const source: Config = {
            target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
            machines: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, recipe: 'iron-plate', crafting_speed: i < 4 ? 1 : 2, productivity: 0, prototype: 'stone-furnace', fuel: 'coal' })),
            chests: [
                ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, type: 'buffer-chest' as const, storage_size: 2, item_filter: 'iron-plate' })),
                { id: 7, type: 'infinity-chest', item_filter: [{ item_name: 'coal', request_count: 50 }] },
            ],
            drills: { configs: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, type: 'electric-mining-drill' as const,
                mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 40, target: { type: 'machine' as const, id: i + 1 }, overrides: { enable_control: { mode: 'AUTO' as const } } })) },
            belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] }],
            inserters: Array.from({ length: 6 }, (_, i) => [
                { id: i * 3 + 1, source: { type: 'chest' as const, id: 7 }, sink: { type: 'machine' as const, id: i + 1 }, filters: ['coal'], overrides: { enable_control: { mode: 'ALWAYS' as const } } },
                { id: i * 3 + 2, source: { type: 'machine' as const, id: i + 1 }, sink: { type: 'chest' as const, id: i + 1 }, filters: ['iron-plate'] },
                { id: i * 3 + 3, source: { type: 'chest' as const, id: i + 1 }, sink: { type: 'belt' as const, id: 1 }, filters: ['iron-plate'], overrides: { animation: { pickup_duration_ticks: 10 },
                    enable_control: { mode: 'CLOCKED' as const, ranges: [{ start: 0, end: 10 }, { start: 20, end: 30 }], period_duration_ticks: 40 } } },
            ]).flat(), overrides: { backed_up_belts: false, ignored_lcm_ingredients: ['coal'], loop_seed_items: 0 },
        } as Config;
        const plan = planRepeatedUnitConversion(source);
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        expect(plan.multiplicity).toBe(2);
        expect(plan.retained.machines.map(it => [it.sourceId, it.resultId])).toEqual([[1, 1], [2, 2], [5, 3]]);
        expect(plan.retained.inserters.map(it => it.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 12, 13, 14]);
        expect(plan.candidate.drills?.configs.map(it => it.target.id)).toEqual([1, 2, 3]);
        expect(plan.candidate.chests?.map(it => it.id)).toEqual([1, 2, 3, 4]);
        expect(plan.candidate.inserters[6].source.id).toBe(4);
        expect(plan.candidate.inserters[7].sink.id).toBe(3);
        expect(plan.candidate.inserters[8].overrides).toEqual(source.inserters[14].overrides);
        expect(plan.candidate.overrides).toEqual(source.overrides);
        expect(plan.candidate.machines.every(it => it.fuel === 'coal')).toBe(true);
    });

    it('keeps private drop geometry with every local dropper, but refuses coupled shared geometry', () => {
        const source = eightUnits();
        source.machines = source.machines.slice(0, 2);
        source.inserters = source.inserters.slice(0, 4);
        source.belts.push({ ...structuredClone(source.belts[1]), id: 3 });
        source.inserters[1].sink = { type: 'belt', id: 2, drop: { lane: 1, position: -0.5 } };
        source.inserters[3].sink = { type: 'belt', id: 3, drop: { lane: 1, position: -0.5 } };
        const privatePlan = planRepeatedUnitConversion(source);
        expect(privatePlan.kind).toBe('available');
        if (privatePlan.kind === 'available') expect(privatePlan.candidate.inserters[1].sink).toEqual(source.inserters[1].sink);
        source.belts.pop();
        source.inserters[3].sink.id = 2;
        expect(ConfigSchema.safeParse(source).success).toBe(true);
        expect(findRepeatedUnits(source).gcd).toBe(2);
        expect(planRepeatedUnitConversion(source)).toMatchObject({ kind: 'unavailable', reason: { code: 'unsupported-boundary' } });
    });

    it('does not discard machine-free transfers or normalize ordered metadata the detector ignores', () => {
        const ordered = eightUnits();
        ordered.inserters.filter((_, i) => i % 2 === 0).forEach(ins => { ins.filters = ['iron-plate', 'copper-plate']; });
        ordered.inserters[0].filters?.reverse();
        expect(findRepeatedUnits(ordered).gcd).toBe(8);
        expect(planRepeatedUnitConversion(ordered)).toMatchObject({ kind: 'unavailable', reason: { code: 'nonuniform-units' } });
        const subsystem = eightUnits();
        subsystem.inserters.push({ id: 17, source: { type: 'belt', id: 1 }, sink: { type: 'belt', id: 2 } });
        expect(planRepeatedUnitConversion(subsystem)).toMatchObject({ kind: 'unavailable', reason: { code: 'unassigned-entities' } });
    });

    it('fails closed on unrepresentable exact Copies, unsupported fields and execution order', () => {
        const source = eightUnits();
        source.target_output.copies = Number.MAX_SAFE_INTEGER;
        expect(planRepeatedUnitConversion(source)).toMatchObject({ kind: 'unavailable', reason: { code: 'copies-not-representable' } });
        const unknown = eightUnits();
        Object.assign(unknown.machines[0], { absolute_entity_reference: 8 });
        expect(planRepeatedUnitConversion(unknown)).toMatchObject({ kind: 'unavailable', reason: { code: 'invalid-config' } });
        const reordered = eightUnits();
        reordered.machines.reverse();
        expect(planRepeatedUnitConversion(reordered)).toMatchObject({ kind: 'unavailable', reason: { code: 'unsupported-order' } });
    });
});
