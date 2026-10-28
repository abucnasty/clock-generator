import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { ConfigSchema, FactorioDataService, FeasibilityError, Machine, validateConfig, type Config } from 'clock-generator/browser';
import oreVoiderExact from '../../../clock-generator/resources/config-samples/real/owner/ore-voider/ore-voider-exact-speed.json';
import oreVoiderOverbeaconed from '../../../clock-generator/resources/config-samples/real/owner/ore-voider/ore-voider-overbeaconed.json';
import { configToFormData } from './configForm/configMapping';
import { isTargetAboveMax, machinesMaxOf, resultComesBack, totalMachineCapacity } from './targetRateLimit';

FactorioDataService.initialize(JSON.parse(factorioData));

/** The engine refuses a target above what the build can carry before any simulation, with this error */
function expectNoClockCanHold(error: unknown): void {
    expect(error).toBeInstanceOf(FeasibilityError);
    expect((error as Error).message).toMatch(/^No clock can hold this build's target/);
}

function refusalOf(config: Config): unknown {
    try { validateConfig(config); } catch (error) { return error; }
    return undefined;
}

/** One gear machine, with hands of 4 so that its inserters carry more than it makes and the machine is what limits the target */
function build(copies: number, items_per_second: number, crafting_speed: number) {
    return ConfigSchema.parse({
        target_output: { recipe: 'iron-gear-wheel', copies, items_per_second },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed }],
        inserters: [
            { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 4, filters: ['iron-plate'] },
            { source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 2 }, stack_size: 4, filters: ['iron-gear-wheel'] },
        ],
        belts: [
            { id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] },
            { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
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
                    // the feasibility pass refuses a clear excess first; one a rounding error above the maximum is left to the exact check
                    if (rate === capacity + 0.001) expectNoClockCanHold(error);
                    else expect(String(error)).toMatch(/No clock can hold this build's target|target production rate/);
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
        expectNoClockCanHold(refusalOf(build(0.5, 6, 5)));
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
        if (refused) expectNoClockCanHold(refusalOf(config));
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

describe('the most a recycler destroys agrees with the engine\'s check of the ore voider samples', () => {
    const maxOf = (sample: unknown) => {
        const config = ConfigSchema.parse(sample);
        const form = configToFormData(config);
        const facts = Machine.computeMachineFacts(config.machines[0]);
        const comesBack = resultComesBack(form.machines[0], form.inserters, 'iron-ore');
        return { config, max: machinesMaxOf('iron-ore', [{ id: 1, facts, comesBack }], 'destroyed')! };
    };
    const withRate = (config: ReturnType<typeof maxOf>['config'], items_per_second: number) =>
        ConfigSchema.parse({ ...config, target_output: { ...config.target_output, items_per_second } });

    it('is 405 a second for the exact-speed recycler: 400 passes, and the engine refuses just above it', () => {
        const { config, max } = maxOf(oreVoiderExact);
        expect(config.target_output.counts).toBe('destroyed');
        expect(totalMachineCapacity(max, 1)).toBe(405);
        expect(isTargetAboveMax(400, 1, max)).toBe(false);
        expect(() => validateConfig(withRate(config, 400))).not.toThrow();
        expect(isTargetAboveMax(405.01, 1, max)).toBe(true);
        expectNoClockCanHold(refusalOf(withRate(config, 405.01)));
    });

    it('is 639.2 a second for the overbeaconed recycler, above what its inserters let the engine accept', () => {
        const { config, max } = maxOf(oreVoiderOverbeaconed);
        expect(totalMachineCapacity(max, 1)).toBeCloseTo(639.225, 2);
        expect(isTargetAboveMax(400, 1, max)).toBe(false);
        expect(() => validateConfig(withRate(config, 400))).not.toThrow();
        // the UI's maximum counts the machines only (isTargetAboveMax), not the inserters: 3 to 6 bring in at most 480 a second
        for (const rate of [639, 639.22]) {
            expect(isTargetAboveMax(rate, 1, max)).toBe(false);
            const refusal = refusalOf(withRate(config, rate));
            expectNoClockCanHold(refusal);
            expect((refusal as Error).message).toContain('Inserters 3, 4, 5 and 6 can bring at most 480 a second of iron ore into the build');
        }
        expect(isTargetAboveMax(639.3, 1, max)).toBe(true);
        expectNoClockCanHold(refusalOf(withRate(config, 639.3)));
    });
});

describe('what comes back into a recycler', () => {
    const form = configToFormData(ConfigSchema.parse(oreVoiderExact));
    it('is what an inserter takes from the result target into the machine, with the item or with no filter', () => {
        expect(resultComesBack(form.machines[0], form.inserters, 'iron-ore')).toBe(true);
        expect(resultComesBack(form.machines[0], form.inserters, 'copper-ore')).toBe(false);
        expect(resultComesBack({ ...form.machines[0], result_target: undefined }, form.inserters, 'iron-ore')).toBe(false);
        const unfiltered = form.inserters.map(inserter => ({ ...inserter, filters: undefined }));
        expect(resultComesBack(form.machines[0], unfiltered, 'iron-ore')).toBe(true);
        // the inserters that bring the ore in from the infinity chest do not count
        expect(resultComesBack(form.machines[0], form.inserters.filter(inserter => inserter.source.id !== 1), 'iron-ore')).toBe(false);
    });
});
