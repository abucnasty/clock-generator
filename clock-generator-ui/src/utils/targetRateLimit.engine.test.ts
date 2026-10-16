import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { ConfigSchema, FactorioDataService, Machine, validateConfig } from 'clock-generator/browser';
import { isTargetAboveMax, machinesMaxOf, totalMachineCapacity } from './targetRateLimit';

FactorioDataService.initialize(JSON.parse(factorioData));

function build(copies: number, items_per_second: number, crafting_speed: number) {
    return ConfigSchema.parse({
        target_output: { recipe: 'iron-gear-wheel', copies, items_per_second },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed }],
        inserters: [
            { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 1, filters: ['iron-plate'] },
            { source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 2 }, stack_size: 1, filters: ['iron-gear-wheel'] },
        ],
        belts: [
            { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] },
            { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
        ],
    });
}

describe('target capacity agrees with actual engine validation', () => {
    it.each([0.5, 2.25, 5.5, 0.001, 0.0625])('accepts the exact maximum and rejects an excess with %s Copies', copies => {
        for (const crafting_speed of [5, 1.123456789]) {
            const config = build(copies, 1, crafting_speed);
            const facts = Machine.computeMachineFacts(config.machines[0]);
            expect(facts.output_rate_ratio).toBeDefined();
            const max = machinesMaxOf(config.target_output.recipe, [{ id: 1, facts }])!;
            const capacity = totalMachineCapacity(max, copies);
            expect(capacity).not.toBeNull();
            if (capacity === null) throw new Error('Expected supported exact capacity');
            for (const rate of [capacity, capacity + Math.max(Number.EPSILON * capacity, Number.EPSILON), capacity + 0.001]) {
                const candidate = build(copies, rate, crafting_speed);
                const above = isTargetAboveMax(rate, copies, max);
                let engineRejected = false;
                try { validateConfig(candidate); } catch (error) {
                    expect(String(error)).toMatch(/target production rate/);
                    engineRejected = true;
                }
                expect(above).toBe(engineRejected);
                if (rate === capacity) expect(above).toBe(false);
                if (rate === capacity + 0.001) expect(above).toBe(true);
            }
        }
    });

    it('a machine making 10/s supports 5/s but not 6/s with half a copy', () => {
        const config = build(0.5, 5, 5);
        const facts = Machine.computeMachineFacts(config.machines[0]);
        expect(facts.output_rate_per_second).toBe(10);
        const max = machinesMaxOf('iron-gear-wheel', [{ id: 1, facts }])!;
        expect(totalMachineCapacity(max, 0.5)).toBe(5);
        expect(isTargetAboveMax(5, 0.5, max)).toBe(false);
        expect(isTargetAboveMax(6, 0.5, max)).toBe(true);
        expect(() => validateConfig(config)).not.toThrow();
        expect(() => validateConfig(build(0.5, 6, 5))).toThrow(/target production rate/);
    });

    it.each([
        [2.25, 1.35, false],
        [2.25, 1.3500000000000003, false],
        [2.25, 1.351, true],
        [0.5, 0.3, false],
        [0.5, 0.30000000000000004, false],
        [0.5, 0.301, true],
    ] as const)('retains engine normalization at %s Copies, %s/s', (copies, rate, refused) => {
        const config = build(copies, rate, 0.3);
        const facts = Machine.computeMachineFacts(config.machines[0]);
        expect(facts.output_rate_ratio).toEqual({ numerator: 3, denominator: 5 });
        const max = machinesMaxOf('iron-gear-wheel', [{ id: 1, facts }])!;
        expect(isTargetAboveMax(rate, copies, max)).toBe(refused);
        if (refused) expect(() => validateConfig(config)).toThrow(/target production rate/);
        else expect(() => validateConfig(config)).not.toThrow();
    });

    it('defers a schema-valid tiny rate to the engine without changing it', () => {
        const config = build(2.25, 1e-23, 0.3);
        const facts = Machine.computeMachineFacts(config.machines[0]);
        const max = machinesMaxOf('iron-gear-wheel', [{ id: 1, facts }])!;
        expect(isTargetAboveMax(config.target_output.items_per_second, 2.25, max)).toBe(false);
        expect(() => validateConfig(config)).toThrow(/fraction: too many decimal places/);
        expect(config.target_output.items_per_second).toBe(1e-23);
    });

    it('sums exact ratios before applying Copies and marks mixed legacy facts as approximate', () => {
        const facts = { output_item: 'iron-gear-wheel', output_rate_per_second: 1 / 3, output_rate_ratio: { numerator: 1, denominator: 3 } };
        const max = machinesMaxOf('iron-gear-wheel', [1, 2, 3].map(id => ({ id, facts })))!;
        expect(max.perCopyRatio).toEqual({ numerator: 1, denominator: 1 });
        expect(totalMachineCapacity(max, 0.5)).toBe(0.5);
        const legacy = machinesMaxOf('iron-gear-wheel', [{ id: 1, facts }, { id: 2, facts: { output_item: 'iron-gear-wheel', output_rate_per_second: 1 / 3 } }])!;
        expect(legacy.perCopyRatio).toBeUndefined();
        expect(totalMachineCapacity(legacy, 0.5)).toBe(legacy.perCopy * 0.5);
    });
});
