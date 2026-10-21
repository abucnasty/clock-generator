import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { ConfigSchema, CopiesError, FactorioDataService, validateConfig } from 'clock-generator/browser';
import { repeatedUnitsProblem } from './repeatedUnitsProblem';

FactorioDataService.initialize(JSON.parse(factorioData));

function build(speeds = [1, 1]) {
    return ConfigSchema.parse({
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 0.1 },
        machines: speeds.map((crafting_speed, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed })),
        inserters: speeds.flatMap((_, i) => [
            { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: i + 1 }, stack_size: 1 },
            { source: { type: 'machine', id: i + 1 }, sink: { type: 'belt', id: 2 }, stack_size: 1 },
        ]),
        belts: [
            { id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] },
            { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
        ],
    });
}

describe('repeated unit recovery', () => {
    it('uses the actual validation error fields and leaves the build unchanged', () => {
        const config = build();
        const before = JSON.stringify(config);
        let caught: unknown;
        try { validateConfig(config); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(CopiesError);
        const error = caught as CopiesError;
        error.message = 'The engine can change its prose independently.';
        expect(repeatedUnitsProblem(error)).toBe('This selection contains 2 identical units (unit 1: Machine 1; unit 2: Machine 2). In Factorio, select just one unit and paste it again. Set Copies to 0.2. Keep Items per Second as the total rate for all copies. Your build has not been changed.');
        expect(JSON.stringify(config)).toBe(before);
    });

    it('does not refuse a heterogeneous unit', () => {
        const config = build([1, 2]);
        config.target_output.items_per_second = 0.5;
        expect(() => validateConfig(config)).not.toThrow();
    });

    it('lists every machine in structured multi-machine groups', () => {
        expect(repeatedUnitsProblem(new CopiesError([{ machine_ids: [1, 2] }, { machine_ids: [3, 4] }], 5.5)))
            .toContain('unit 1: Machines 1, 2; unit 2: Machines 3, 4');
        expect(repeatedUnitsProblem(new CopiesError([{ machine_ids: [1] }, { machine_ids: [2] }], 5.5))).toContain('Set Copies to 11.');
    });
});
