import {describe, expect, it} from 'vitest';
import {ConfigSchema, type Config} from '../config/schema';
import {assertInserterCoverage, validateInserterCoverage} from '../config/inserter-coverage-validator';
import {CompositeControlLogic, TickControlLogic} from '../control-logic';
import {directMachineInsertionLimit} from '../entities/drill/mining-drill-ext';
import {MachineState, MachineStatus} from '../state';
import {SimulationContext} from './sequence/simulation-context';
import {CraftingCyclePlan} from './sequence/cycle/crafting-cycle';
import {TargetProductionRate} from './target-production-rate';
import {fraction} from '../data-types/fraction';
import {PrepareStep} from './runner/steps/prepare-step';
import {computeMachineTargetRates} from './machine-target-rates';

function cell(): Config {
    return ConfigSchema.parse({
        target_output: {recipe: 'supercapacitor', items_per_second: 0.1, copies: 1},
        machines: [
            {id: 1, recipe: 'processing-unit-recycling', prototype: 'recycler', crafting_speed: 1, productivity: 0, result_target: {type: 'machine', id: 2}},
            {id: 2, recipe: 'supercapacitor', prototype: 'electromagnetic-plant', crafting_speed: 1, productivity: 50},
        ], belts: [],
        chests: [{id: 1, type: 'infinity-chest', item_filter: [{item_name: 'processing-unit', request_count: 100}]},
            {id: 2, type: 'infinity-chest', remove_unfiltered_items: true},
            {id: 3, type: 'infinity-chest', item_filter: ['holmium-plate', 'superconductor', 'battery'].map(item_name => ({item_name, request_count: 100}))}],
        inserters: [
            {id: 1, source: {type: 'chest', id: 1}, sink: {type: 'machine', id: 1}, filters: ['processing-unit']},
            {id: 2, source: {type: 'machine', id: 1}, sink: {type: 'chest', id: 2}, filters: ['advanced-circuit']},
            {id: 3, source: {type: 'chest', id: 3}, sink: {type: 'machine', id: 2}, filters: ['holmium-plate', 'superconductor', 'battery']},
            {id: 4, source: {type: 'machine', id: 2}, sink: {type: 'chest', id: 2}, filters: ['supercapacitor']},
        ],
    }) as Config;
}

describe('a recycler placing results into a machine', () => {
    it('covers direct supplies and still needs its rejected result removed', () => {
        const config = cell();
        expect(() => assertInserterCoverage(config)).not.toThrow();
        config.inserters = config.inserters.filter(inserter => inserter.id !== 2);
        expect(validateInserterCoverage(config)).toMatchObject([{kind: 'missing_output_inserter', machine_id: 1, item_name: 'advanced-circuit'}]);
    });
    it('fills to the shared drill stop, keeps rejected results, and resumes once room returns', () => {
        const config = cell(); config.inserters = config.inserters.filter(inserter => inserter.id === 1);
        const context = SimulationContext.fromConfig(config);
        const source = context.machines[0].machine_state, target = context.machines[1].machine_state;
        const item = source.machine.output.ingredient.item, limit = directMachineInsertionLimit(item, target.machine);
        const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates()]);
        const run = (ticks: number) => { for (let i = 0; i < ticks; i++) tick.executeForTick(); };
        run(10_000);
        expect(MachineState.ingredientQuantity(target, item.name)).toBe(limit);
        expect(limit).toBeGreaterThan(target.machine.inputs.getOrThrow(item.name).automated_insertion_limit.quantity);
        expect(target.inventoryState.getQuantity('advanced-circuit')).toBe(0);
        expect(source.inventoryState.getQuantity('advanced-circuit')).toBeGreaterThan(0);
        expect(source.status).toBe(MachineStatus.OUTPUT_FULL);
        const crafts = source.craftCount; run(100); expect(source.craftCount).toBe(crafts);
        target.inventoryState.removeQuantity(item.name, 20); run(120);
        expect(source.craftCount).toBeGreaterThan(crafts);
        expect(MachineState.ingredientQuantity(target, item.name)).toBe(limit);
    });
    it('plans the recycler feed and target rate from the circuits its target needs', () => {
        const config = cell(), context = SimulationContext.fromConfig(config);
        const cycle = CraftingCyclePlan.create(TargetProductionRate.fromConfig(config.target_output), context.entity_registry, fraction(1));
        const feed = [...cycle.entity_transfer_map.values()].find(entry => entry.entity.entity_id.number === 1)!;
        const output = [...cycle.entity_transfer_map.values()].find(entry => entry.entity.entity_id.number === 4)!;
        expect(feed.total_transfer_count.toDecimal() / output.total_transfer_count.toDecimal()).toBeCloseTo(4 / 5 / 1.5);
        expect(computeMachineTargetRates(config).find(rate => rate.machine_id === 1)!.output_rate_per_second).toBeCloseTo(0.1 / 1.5 * 4);
    });
    it('prepares the downstream build without trapping an unused result in the recycler', () => {
        const context = SimulationContext.fromConfig(cell());
        new PrepareStep(context).execute();
        expect(context.machines.map(machine => machine.machine_state.status)).toEqual([MachineStatus.OUTPUT_FULL, MachineStatus.OUTPUT_FULL]);
    });
    it('refuses a missing target, a self-target and a target recipe that uses none of the results', () => {
        const config = cell();
        const withTarget = (id: number) => ({...config, machines: config.machines.map(machine => machine.id === 1 ? {...machine, result_target: {type: 'machine', id}} : machine)});
        expect(() => ConfigSchema.parse(withTarget(99))).toThrow('which is not in the config');
        expect(() => ConfigSchema.parse(withTarget(1))).toThrow('cannot place its results into itself');
        expect(() => ConfigSchema.parse({...config, machines: config.machines.map(machine => machine.id === 2 ? {...machine, recipe: 'iron-plate'} : machine)})).toThrow('takes none');
    });
    it('refuses a target that needs several of the results until their demands can be planned together', () => {
        const config = cell();
        config.machines[1] = {...config.machines[1], recipe: 'processing-unit'};
        expect(() => ConfigSchema.parse(config)).toThrow('takes more than one of those results');
    });
    it('refuses competing input sources rather than counting their supplies twice', () => {
        const config = cell();
        config.inserters.push({id: 5, source: {type: 'chest', id: 1}, sink: {type: 'machine', id: 2}, filters: ['electronic-circuit']});
        config.chests![0] = {...config.chests![0], item_filter: [{item_name: 'electronic-circuit', request_count: 100}]} as never;
        expect(() => SimulationContext.fromConfig(config)).toThrow('and another source');
    });
});
