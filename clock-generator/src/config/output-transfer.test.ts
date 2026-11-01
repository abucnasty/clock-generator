import { describe, expect, it, vi } from 'vitest';
import { ConfigSchema, type Config } from './schema';
import { deriveOutputTransfers } from './output-transfer';
import { outputTransferGenerationIssues, assertOutputTransferGenerationSupported } from './output-transfer-generation';
import { createInserterCoverageValidator, validateInserterCoverage } from './inserter-coverage-validator';
import { FactorioDataService } from '../data';
import { createEntityRegistryFromConfig } from '../crafting/sequence/simulation-context';
import { CraftingCyclePlan } from '../crafting/sequence/cycle/crafting-cycle';
import { madeTargetBalance } from '../crafting/sequence/cycle/cycle-transfers';
import { TargetProductionRate } from '../crafting/target-production-rate';
import { computeMachineTargetRates } from '../crafting/machine-target-rates';
import { validateConfig } from '../crafting/plan/validate-config';
import { planRun, runBuild } from '../crafting/plan/plan-run';
import { Entity } from '../entities';
import { computeMachineFacts } from '../entities/traits/machine-facts-of';
import { fraction } from '../data-types/fraction';

function cell(recipe = 'supercapacitor'): Config {
    return ConfigSchema.parse({
        target_output: { recipe: 'supercapacitor', items_per_second: 0.1, copies: 1 },
        machines: [
            { id: 1, recipe: 'processing-unit-recycling', prototype: 'recycler', crafting_speed: 1, productivity: 0, result_target: { type: 'machine', id: 2 } },
            { id: 2, recipe, prototype: 'electromagnetic-plant', crafting_speed: 1, productivity: 50 },
        ],
        belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'advanced-circuit', stack_size: 1 }] }],
        chests: [{ id: 1, type: 'infinity-chest', remove_unfiltered_items: true }],
        inserters: [{ source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, filters: ['advanced-circuit'] }],
    }) as Config;
}
const sourceOf = (config: Config) => deriveOutputTransfers(config)[0];
const missingResults = (config: Config) => validateInserterCoverage(config)
    .filter(issue => issue.machine_id === 1 && issue.kind === 'missing_output_inserter').map(issue => issue.item_name);

describe('derived output transfers', () => {
    it('retains one destination and every accepted and rejected recipe result with actual inserter ids', () => {
        const config = cell(), before = JSON.stringify(config);
        expect(sourceOf(config)).toEqual({ source: { type: 'machine', id: 1 }, physical_target: { type: 'machine', id: 2 },
            mechanism: 'result-placement', status: 'known', results: [
                { item_name: 'electronic-circuit', direct: 'accepted', inserters: [], coverage: 'covered' },
                { item_name: 'advanced-circuit', direct: 'rejected', inserters: [{ inserter_id: 1, target: { type: 'belt', id: 1 } }], coverage: 'covered' },
            ] });
        expect(missingResults(config)).toEqual([]);
        expect(JSON.stringify(config)).toBe(before);
    });
    it('keeps zero-accepted physical targets and no-target layouts distinct', () => {
        const config = cell('iron-plate');
        expect(sourceOf(config).results.map(result => result.direct)).toEqual(['rejected', 'rejected']);
        delete config.machines[0].result_target;
        expect(sourceOf(config).physical_target).toBeNull();
        expect(sourceOf(config).results.map(result => result.direct)).toEqual(['none', 'none']);
        expect(missingResults(config)).toEqual(['electronic-circuit']);
    });
    it.each(['machine', 'chest'] as const)('does not count a rejecting %s sink as removal', type => {
        const config = cell();
        config.inserters[0].sink = { type, id: type === 'machine' ? 2 : 1 };
        if (type === 'chest') config.chests = [{ id: 1, type: 'buffer-chest', item_filter: 'iron-plate', storage_size: 100 }];
        expect(sourceOf(config).results[1]).toMatchObject({ inserters: [], coverage: 'missing' });
        expect(missingResults(config)).toEqual(['advanced-circuit']);
    });
    it('preserves legacy output belt removal even when its supply lanes name other items', () => {
        const config = cell(); config.belts[0].lanes[0].ingredient = 'iron-plate';
        expect(sourceOf(config).results[1].coverage).toBe('covered');
        expect(missingResults(config)).toEqual([]);
        config.inserters[0].sink.id = 99;
        expect(sourceOf(config).results[1]).toMatchObject({ coverage: 'unknown', inserters: [] });
    });
    it('keeps ordinary-source legacy coverage while reporting its actual rejecting sink', () => {
        const config = cell();
        config.machines[0] = { ...config.machines[0], recipe: 'advanced-circuit', prototype: 'assembling-machine-3', result_target: undefined };
        config.inserters[0].sink = { type: 'machine', id: 2 };
        expect(sourceOf(config).results[0]).toMatchObject({ item_name: 'advanced-circuit', coverage: 'missing' });
        expect(missingResults(config)).toEqual([]);
    });
    it('uses whitelist and blacklist semantics and keeps multiple actual routes', () => {
        const config = cell();
        config.inserters[0].filter_mode = 'blacklist';
        expect(missingResults(config)).toEqual(['advanced-circuit']);
        config.inserters[0].filters = ['iron-plate'];
        config.inserters.push({ id: 19, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 } });
        expect(sourceOf(config).results[1].inserters.map(route => route.inserter_id)).toEqual([1, 19]);
    });
    it('does not invent a second inserter when transient effective ids collide', () => {
        const config = cell(); config.inserters.push({ ...config.inserters[0], id: 1 });
        expect(sourceOf(config).status).toBe('unavailable');
        expect(sourceOf(config).results[1].inserters).toHaveLength(1);
    });
    it('reports unavailable source/target facts without claiming acceptance or throwing', () => {
        const config = cell();
        config.machines[1].recipe = 'missing-recipe';
        expect(sourceOf(config)).toMatchObject({ status: 'unavailable', results: [
            { item_name: 'electronic-circuit', direct: 'unknown', coverage: 'unknown' },
            { item_name: 'advanced-circuit', direct: 'unknown', coverage: 'covered' },
        ] });
        config.machines[0].recipe = 'missing-recipe';
        expect(sourceOf(config)).toMatchObject({ status: 'unavailable', results: [] });
    });
    it('does not require loaded data to preserve the selected target', () => {
        const config = cell();
        const unavailable = vi.spyOn(FactorioDataService, 'findRecipeOrThrow').mockImplementation(() => { throw new Error('unavailable'); });
        try { expect(sourceOf(config)).toMatchObject({ physical_target: { type: 'machine', id: 2 }, status: 'unavailable', results: [] }); }
        finally { unavailable.mockRestore(); }
    });
    it('shares direct chest acceptance with coverage, including filtered and blocked slots', () => {
        const config = cell(); config.machines[0].result_target = { type: 'chest', id: 1 }; config.inserters = [];
        config.chests = [{ id: 1, type: 'car', slot_filters: Array.from({ length: 80 }, (_, index) =>
            index === 0 ? { slot: 1, item: 'electronic-circuit' } : { slot: index + 1, blocked: true as const }) }];
        expect(sourceOf(config).results.map(result => result.direct)).toEqual(['accepted', 'rejected']);
        expect(missingResults(config)).toEqual(['advanced-circuit']);
    });
    it('shows a drill drop using the resource result and the same target acceptance', () => {
        const config = cell(); config.drills = { configs: [{ id: 7, mined_item_name: 'iron-ore', target: { type: 'chest', id: 1 } }] } as Config['drills'];
        expect(deriveOutputTransfers(config).at(-1)).toEqual({ source: { type: 'drill', id: 7 }, physical_target: { type: 'chest', id: 1 },
            mechanism: 'mining-drop', status: 'known', results: [{ item_name: 'iron-ore', direct: 'accepted', inserters: [], coverage: 'covered' }] });
    });
    it('invalidates live coverage after a belt drop lane or wagon quality changes acceptance', () => {
        const config = cell(), validate = createInserterCoverageValidator();
        const missing = () => validate(config).filter(issue => issue.machine_id === 1 && issue.kind === 'missing_output_inserter').map(issue => issue.item_name);
        expect(missing()).toEqual([]);
        config.inserters[0].sink = { type: 'belt', id: 1, drop: { lane: 2, position: 0 } };
        expect(missing()).toEqual(['advanced-circuit']);
        config.machines[0].result_target = { type: 'chest', id: 1 }; config.inserters = [];
        const slots = FactorioDataService.containerSlots('cargo-wagon', 'normal');
        config.chests = [{ id: 1, type: 'cargo-wagon', quality: 'normal', slot_filters: Array.from({ length: slots }, (_, index) => ({ slot: index + 1, blocked: true })) }];
        expect(missing()).toEqual(['electronic-circuit', 'advanced-circuit']);
        if (config.chests[0].type !== 'cargo-wagon') throw new Error('expected wagon');
        config.chests[0].quality = 'legendary';
        expect(missing()).toEqual([]);
    });
});

describe('physical representation and generation support', () => {
    it.each([['iron-plate', 'no-accepted-results'], ['processing-unit', 'multiple-accepted-results']])('saves %s layout but refuses all demand/planning entry points', (recipe, code) => {
        const config = cell(recipe);
        expect(ConfigSchema.parse(JSON.parse(JSON.stringify(config))).machines[0].result_target).toEqual(config.machines[0].result_target);
        expect(outputTransferGenerationIssues(config)).toMatchObject([{ code, machine_id: 1, target_machine_id: 2 }]);
        const refusal = outputTransferGenerationIssues(config)[0].message;
        expect(() => assertOutputTransferGenerationSupported(config)).toThrow(refusal);
        expect(() => computeMachineTargetRates(config)).toThrow(refusal);
        expect(() => runBuild(config, {})).toThrow(refusal);
        expect(() => validateConfig(config)).toThrow(refusal);
        expect(() => planRun(config)).toThrow(refusal);
        const registry = createEntityRegistryFromConfig(config);
        expect(() => CraftingCyclePlan.create(TargetProductionRate.fromConfig(config.target_output), registry, config, fraction(1))).toThrow(refusal);
        expect(() => madeTargetBalance(registry.getAll().filter(Entity.isMachine), registry, config, fraction(1), 16)).toThrow(refusal);
    });
    it('does not let an unrelated missing route hide a cardinality refusal', () => {
        const config = cell('processing-unit'); config.inserters[0].sink = { type: 'chest', id: 99 };
        expect(outputTransferGenerationIssues(config)[0].code).toBe('multiple-accepted-results');
    });
});

describe('machine result facts', () => {
    it('keeps scalar aliases and exposes effective expected yield for every result', () => {
        const facts = computeMachineFacts({ ...cell().machines[0], productivity: 50 });
        expect(facts.outputs).toMatchObject([
            { item_name: 'electronic-circuit', amount_per_craft: 7.5, stochastic: false },
            { item_name: 'advanced-circuit', amount_per_craft: 0.75, stochastic: true },
        ]);
        expect(facts.outputs![0].rate_per_second).toBe(facts.output_rate_per_second);
        expect(facts.outputs![0].rate_ratio).toEqual(facts.output_rate_ratio);
        expect(facts.outputs![1].rate_per_second / facts.outputs![0].rate_per_second).toBeCloseTo(0.1);
    });
    it('marks shared-probability yields as expected without claiming independent rolls', () => {
        const facts = computeMachineFacts({ ...cell().machines[0], recipe: 'scrap-recycling' });
        expect(facts.outputs).toHaveLength(12);
        expect(facts.outputs!.every(output => output.stochastic)).toBe(true);
    });
});
