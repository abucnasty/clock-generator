import { describe, expect, it } from 'vitest';
import { Config, ConfigSchema } from './schema';
import { findRepeatedUnits } from './copies-validator';
import { planRepeatedUnitConversion } from './repeated-unit-conversion';
import { validateConfig } from '../crafting/plan/validate-config';
import { FeasibilityError } from './errors';

/**
 * Actual free-lane gear build: 3.5 total items/s requires the multiplied Copies after extraction. The copies take 7 plates
 * a second from the plate lane they share, of the 7.5 it gets.
 */
function eightUnits(): Config {
    return {
        setpoint: { recipe: 'iron-gear-wheel', items_per_second: 3.5, copies: 0.5 },
        machines: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 })),
        inserters: Array.from({ length: 8 }, (_, i) => [
            { id: 2 * i + 1, source: { type: 'belt' as const, id: 1, near_lane: 1 as const }, sink: { type: 'machine' as const, id: i + 1 }, stack_size: 1, filters: ['iron-plate'] },
            { id: 2 * i + 2, source: { type: 'machine' as const, id: i + 1 }, sink: { type: 'belt' as const, id: 2 }, stack_size: 1, filters: ['iron-gear-wheel'] },
        ]).flat(),
        belts: [
            { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1, lane_end: { kind: 'infinite' } }] },
            { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
        ], chests: [], overrides: { check_start_dependence: false, kick_start_items: 0 },
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
        expect(plan.candidate.setpoint).toEqual({ ...source.setpoint, copies: 4 });
        expect(plan.retained.machines).toEqual([{ sourceIndex: 0, sourceId: 1, resultId: 1 }]);
        expect(plan.retained.inserters.map(it => it.sourceIndex)).toEqual([0, 1]);
        expect(plan.candidate.belts).toEqual(source.belts);
        expect(plan.candidate.inserters).toEqual(source.inserters.slice(0, 2));
        expect(() => validateConfig(plan.candidate)).not.toThrow();
        expect(() => validateConfig({ ...plan.candidate, setpoint: { ...plan.candidate.setpoint, copies: 0.5 } })).toThrow(FeasibilityError);
        expect(source).toEqual(before);
        plan.candidate.belts[0].lanes[0].stack_size = 2;
        expect(source).toEqual(before);
    });

    it('reads where the next copy stands from the places of the copies, which are no part of what makes them copies', () => {
        const placed = (gap: (unit: number) => number): Config => {
            const source = eightUnits();
            source.setpoint.copies = 1;
            source.machines.forEach((machine, i) => { machine.position = { x: gap(i), y: 3 }; });
            source.inserters.forEach((inserter, index) => { inserter.position = { x: gap(Math.floor(index / 2)) + 1.5 * (index % 2), y: 5 }; });
            return source;
        };
        const plan = planRepeatedUnitConversion(placed(i => 12 * i - 80.5));
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        expect(plan.candidate.setpoint.copy_offset).toEqual({ x: 12, y: 0 });
        // copies that do not stand a fixed step apart, or a member without a place, leave the gap unsaid
        const uneven = planRepeatedUnitConversion(placed(i => i * i));
        expect(uneven.kind === 'available' && uneven.candidate.setpoint.copy_offset).toBeUndefined();
        const missing = placed(i => 12 * i);
        delete missing.inserters[3].position;
        const unplaced = planRepeatedUnitConversion(missing);
        expect(unplaced.kind === 'available' && unplaced.candidate.setpoint.copy_offset).toBeUndefined();
    });

    /**
     * Two copies of two gear machines and a faster one, each machine with an inserter from the plate belt and one onto the
     * gear belt; `xs` gives where the machines stand, in the order they are listed: three of the first copy, three of the
     * second. Each inserter stands beside its machine, `side` tiles along the belt (the drop beside it on the other side).
     */
    function twoCopies(xs: number[], side: number[] = xs.map(() => 1)): Config {
        const speeds = [1, 1, 2, 1, 1, 2];
        return {
            setpoint: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
            machines: xs.map((x, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', crafting_speed: speeds[i], productivity: 0, position: { x, y: 3 } })),
            inserters: xs.flatMap((x, i) => [
                { id: 2 * i + 1, source: { type: 'belt' as const, id: 1 }, sink: { type: 'machine' as const, id: i + 1 }, position: { x, y: 1 } },
                { id: 2 * i + 2, source: { type: 'machine' as const, id: i + 1 }, sink: { type: 'belt' as const, id: 2 }, position: { x: x + side[i], y: 5 } },
            ]),
            belts: [
                { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] },
                { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
            ], chests: [],
        } as Config;
    }
    const offsetOf = (config: Config) => {
        const plan = planRepeatedUnitConversion(config);
        expect(plan).toMatchObject({ kind: 'available', multiplicity: 2 });
        return plan.kind === 'available' ? plan.candidate.setpoint.copy_offset : 'unavailable';
    };

    it('pairs the members of the copies by their places, not by the order they are listed in', () => {
        // blueprint order: the second copy listed as the first is
        expect(offsetOf(twoCopies([0, 6, 3, 18, 24, 21]))).toEqual({ x: 18, y: 0 });
        // mirror order: the second copy's two gear machines listed the other way round
        expect(offsetOf(twoCopies([0, 6, 3, 24, 18, 21]))).toEqual({ x: 18, y: 0 });
    });

    it('keeps a stated gap the copies agree with and reads the gap again where they do not', () => {
        const stated = (offset: { x: number; y: number }) => {
            const source = twoCopies([0, 6, 3, 24, 18, 21]);
            source.setpoint.copy_offset = offset;
            return source;
        };
        expect(offsetOf(stated({ x: 18, y: 0 }))).toEqual({ x: 18, y: 0 });
        // a gap stated for other copies (one machine each, 6 tiles apart) is not the gap of the copies found
        expect(offsetOf(stated({ x: 6, y: 0 }))).toEqual({ x: 18, y: 0 });
    });

    it('gives no gap between copies that are mirrored against each other', () => {
        // the second copy is the first turned east to west: the faster machine and the drops stand on the other side
        const mirrored = twoCopies([0, 6, 12, 30, 24, 18], [1, 1, 1, -1, -1, -1]);
        expect(offsetOf(mirrored)).toBeUndefined();
        mirrored.setpoint.copy_offset = { x: 18, y: 0 };
        expect(offsetOf(mirrored)).toBeUndefined();
    });

    it('retains the complete composite GCD unit, internal buffers/drills, fuel, rules and nontrivial ID maps', () => {
        const source: Config = {
            setpoint: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
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
                    enable_control: { mode: 'CLOCKED' as const, ranges: [{ start: 0, end: 10 }, { start: 20, end: 30 }], window_cycle_ticks: 40 } } },
            ]).flat(), overrides: { backed_up_belts: false, ignored_lcm_ingredients: ['coal'], kick_start_items: 0 },
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

    /** The eight gear copies with their plate belt filled by inserters from chests: two infinity chests and a buffer chest */
    function fedUnits(): Config {
        const source = eightUnits();
        source.belts[0].lanes[0].lane_end = { kind: 'dead_end' };
        source.chests = [
            { id: 1, type: 'infinity-chest', item_filter: [{ item_name: 'iron-plate', request_count: 100 }] },
            { id: 2, type: 'buffer-chest', storage_size: 48, item_filter: 'iron-plate' },
            { id: 3, type: 'infinity-chest', item_filter: [{ item_name: 'iron-plate', request_count: 100 }] },
        ];
        source.inserters.push(
            { id: 17, source: { type: 'chest', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 1, filters: ['iron-plate'] },
            { id: 18, source: { type: 'chest', id: 2 }, sink: { type: 'belt', id: 1 }, stack_size: 1, filters: ['iron-plate'] },
            { id: 19, source: { type: 'chest', id: 3 }, sink: { type: 'belt', id: 1 }, stack_size: 1, filters: ['iron-plate'] },
        );
        return source;
    }
    /** The same with the two infinity chests alone */
    function infinityFedUnits(): Config {
        const source = fedUnits();
        source.chests = source.chests!.filter(chest => chest.id !== 2);
        source.inserters = source.inserters.filter(inserter => inserter.id !== 18);
        return source;
    }

    it('keeps the inserters that fill a belt from a chest nothing drops into once, outside the copies', () => {
        const source = fedUnits();
        // every copy also takes coal from a chest of its own: an inserter from a chest into a machine is part of its copy
        source.chests!.push(...Array.from({ length: 8 }, (_, i) => ({ id: 4 + i, type: 'infinity-chest' as const, item_filter: [{ item_name: 'coal', request_count: 50 }] })));
        source.inserters.push(...Array.from({ length: 8 }, (_, i) => ({ id: 20 + i, source: { type: 'chest' as const, id: 4 + i }, sink: { type: 'machine' as const, id: i + 1 }, stack_size: 1, filters: ['coal'] })));
        const plan = planRepeatedUnitConversion(source);
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        expect(plan.multiplicity).toBe(8);
        // one copy written by hand: its machine, its three inserters and its coal chest, with the feeders and their chests once
        const byHand: Config = {
            ...source,
            setpoint: { ...source.setpoint, copies: 4 },
            machines: [source.machines[0]],
            inserters: [
                { ...source.inserters[0], id: 1 }, { ...source.inserters[1], id: 2 },
                { ...source.inserters[16], id: 3 }, { ...source.inserters[17], id: 4 }, { ...source.inserters[18], id: 5 },
                { ...source.inserters[19], id: 6, source: { type: 'chest', id: 4 } },
            ],
            chests: source.chests!.slice(0, 4),
        };
        expect(plan.candidate).toEqual(byHand);
        expect(plan.retained.inserters.map(it => it.sourceIndex)).toEqual([0, 1, 16, 17, 18, 19]);
        expect(plan.retained.chests.map(it => it.sourceIndex)).toEqual([0, 1, 2, 3]);
    });

    it('passes Check on the one copy with its feeders from infinity chests', () => {
        const source = infinityFedUnits();
        const plan = planRepeatedUnitConversion(source);
        expect(plan.kind).toBe('available');
        if (plan.kind !== 'available') return;
        expect(plan.candidate.inserters).toEqual([...source.inserters.slice(0, 2), { ...source.inserters[16], id: 3 }, { ...source.inserters[17], id: 4, source: { type: 'chest', id: 2 } }]);
        expect(plan.candidate.chests).toEqual([source.chests![0], { ...source.chests![1], id: 2 }]);
        expect(() => validateConfig(plan.candidate)).not.toThrow();
    });

    it('keeps the refusal when something drops into the chest an inserter fills the belt from', () => {
        const unassigned = { kind: 'unavailable', reason: { code: 'unassigned-entities', message: 'An inserter belongs to a subsystem without a machine.' } };
        // an inserter from the gear belt into the infinity chest
        const intoInfinity = infinityFedUnits();
        intoInfinity.inserters.push({ id: 20, source: { type: 'belt', id: 2 }, sink: { type: 'chest', id: 1 } });
        expect(planRepeatedUnitConversion(intoInfinity)).toEqual(unassigned);
        // an inserter of a copy into the infinity chest: the chest is part of the build's flow
        const fromCopy = infinityFedUnits();
        fromCopy.inserters.splice(1, 1, { ...fromCopy.inserters[1], sink: { type: 'chest', id: 1 } });
        expect(planRepeatedUnitConversion(fromCopy)).toEqual({ kind: 'unavailable', reason: { code: 'unsupported-boundary',
            message: 'Infinity chests are supported only as external sources.' } });
        // an inserter into the buffer chest
        const intoBuffer = fedUnits();
        intoBuffer.inserters.push({ id: 20, source: { type: 'belt', id: 2 }, sink: { type: 'chest', id: 2 } });
        expect(planRepeatedUnitConversion(intoBuffer)).toEqual({ kind: 'unavailable', reason: { code: 'unassigned-entities',
            message: 'A buffer chest or drill belongs to a subsystem without a machine.' } });
    });

    it('does not set aside an inserter from a chest that drops into anything but a belt', () => {
        const unassigned = { kind: 'unavailable', reason: { code: 'unassigned-entities', message: 'An inserter belongs to a subsystem without a machine.' } };
        // from the infinity chest into a car
        const intoCar = infinityFedUnits();
        intoCar.chests!.push({ id: 4, type: 'car' });
        intoCar.inserters.push({ id: 20, source: { type: 'chest', id: 3 }, sink: { type: 'chest', id: 4 } });
        expect(planRepeatedUnitConversion(intoCar)).toEqual(unassigned);
        // from the infinity chest into the buffer chest
        const intoChest = fedUnits();
        intoChest.inserters.push({ id: 20, source: { type: 'chest', id: 3 }, sink: { type: 'chest', id: 2 } });
        expect(planRepeatedUnitConversion(intoChest)).toEqual({ kind: 'unavailable', reason: { code: 'unassigned-entities',
            message: 'A buffer chest or drill belongs to a subsystem without a machine.' } });
    });

    it('keeps the refusal of an inserter that fills a belt no copy takes from', () => {
        const source = infinityFedUnits();
        source.belts.push({ id: 3, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] });
        source.inserters.push({ id: 20, source: { type: 'chest', id: 3 }, sink: { type: 'belt', id: 3 } });
        expect(planRepeatedUnitConversion(source)).toEqual({ kind: 'unavailable', reason: { code: 'unassigned-entities',
            message: 'An unreferenced belt or infinity chest cannot be assigned to a complete copy.' } });
    });

    it('refuses units of a machine that places its results into a container', () => {
        // two ore voider cells side by side: each recycler places its returns into a car of its own
        const unit = (n: number) => ({
            machine: { id: n, recipe: 'iron-ore-recycling', crafting_speed: 16.875, productivity: 0, prototype: 'recycler', result_target: { type: 'chest' as const, id: 2 * n } },
            inserters: [
                { id: 2 * n - 1, source: { type: 'chest' as const, id: 2 * n }, sink: { type: 'machine' as const, id: n }, stack_size: 16, filters: ['iron-ore'] },
                { id: 2 * n, source: { type: 'chest' as const, id: 2 * n - 1 }, sink: { type: 'machine' as const, id: n }, stack_size: 16, filters: ['iron-ore'] },
            ],
            chests: [{ type: 'infinity-chest', id: 2 * n - 1, item_filter: [{ item_name: 'iron-ore', request_count: 100 }] }, { type: 'car', id: 2 * n }],
        });
        const units = [unit(1), unit(2)];
        const source = ConfigSchema.parse({
            setpoint: { recipe: 'iron-ore', items_per_second: 400, copies: 1, counts: 'destroyed' },
            machines: units.map(it => it.machine), inserters: units.flatMap(it => it.inserters), belts: [], chests: units.flatMap(it => it.chests),
        }) as Config;
        expect(planRepeatedUnitConversion(source)).toMatchObject({ kind: 'unavailable', reason: { code: 'unsupported-boundary' } });
    });

    it('fails closed on unrepresentable exact Copies, unsupported fields and execution order', () => {
        const source = eightUnits();
        source.setpoint.copies = Number.MAX_SAFE_INTEGER;
        expect(planRepeatedUnitConversion(source)).toMatchObject({ kind: 'unavailable', reason: { code: 'copies-not-representable' } });
        const unknown = eightUnits();
        Object.assign(unknown.machines[0], { absolute_entity_reference: 8 });
        expect(planRepeatedUnitConversion(unknown)).toMatchObject({ kind: 'unavailable', reason: { code: 'invalid-config' } });
        const reordered = eightUnits();
        reordered.machines.reverse();
        expect(planRepeatedUnitConversion(reordered)).toMatchObject({ kind: 'unavailable', reason: { code: 'unsupported-order' } });
    });
});
