import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { loadConfigFromFile, parseConfig } from '../config/loader';
import { ConfigSchema, type Config } from '../config/schema';
import { CompositeControlLogic, TickControlLogic } from '../control-logic';
import { EntityState, MachineStatus, SlotContainerState } from '../state';
import { SimulationContext } from './sequence/simulation-context';

// The exact-speed recycler cell of the ore voider benchmark (save F): a recycler at crafting speed 16.875 voids iron ore,
// fed by four stack inserters from the ore supply, and places what it gives back into a car, which two stack inserters
// empty back into it
const FIXTURE = path.join(__dirname, 'fixtures', 'ore-voider-F-recycler.json');

const ORE = 'iron-ore';

function run(context: SimulationContext, ticks: number): void {
    const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates()]);
    for (let i = 0; i < ticks; i++) tick.executeForTick();
}

function carOf(context: SimulationContext): SlotContainerState {
    return context.state_registry.getAllStates().find(EntityState.isSlotContainer)!;
}

describe('a machine that places its results itself', () => {
    it('crafts at its speed and places a quarter of the ore back into its car, at the expected amount', async () => {
        const sample = await loadConfigFromFile(FIXTURE);
        // the feed alone: the car keeps what comes back
        const context = SimulationContext.fromConfig({ ...sample, inserters: sample.inserters.filter(it => it.source.id === 2) } as Config);
        const machine = context.machines[0].machine_state;
        expect(machine.machine.crafting_rate.crafts_per_tick).toBeCloseTo(9, 12);
        expect(machine.machine.output.amount_per_craft.toDecimal()).toBe(0.25);
        run(context, 600);
        const car = carOf(context);
        // four hands of 16 every 8 ticks: 8 ore a tick, under its 9 crafts a tick
        expect(machine.craftCount).toBeGreaterThan(4700);
        const waiting = machine.inventoryState.getQuantity(ORE);
        expect(car.getCurrentQuantity(ORE) + waiting).toBe(Math.floor(machine.craftCount / 4));
        // placed in the tick after it was made: what waits is a tick's returns at most
        expect(waiting).toBeLessThanOrEqual(3);
        // nothing it was given is taken for what it made: the given ore is kept apart and was not seeded
        expect(machine.selfIngredients.getQuantity(ORE)).toBeLessThan(100);
    });

    it('stops with a stack of its result waiting when its car is full, and goes on once there is room', async () => {
        // as recorded: stone in all but 2 slots of the car, 100 ore fill them, then 50 wait in its output and it stops
        const sample = await loadConfigFromFile(FIXTURE);
        const stone = Array.from({ length: 78 }, (_, index) => ({ slot: index + 3, item: 'stone', count: 50 }));
        const context = SimulationContext.fromConfig(ConfigSchema.parse({
            ...sample,
            inserters: sample.inserters.filter(it => it.source.id === 2),
            chests: sample.chests!.map(chest => chest.type === 'car' ? { ...chest, contents: stone } : chest),
        }) as Config);
        const machine = context.machines[0].machine_state;
        run(context, 600);
        const car = carOf(context);
        expect(car.getCurrentQuantity(ORE)).toBe(100);
        expect(machine.inventoryState.getQuantity(ORE)).toBe(50);
        expect(machine.status).toBe(MachineStatus.OUTPUT_FULL);
        const crafts = machine.craftCount;
        run(context, 100);
        expect(machine.craftCount).toBe(crafts);
        // room for one hand: it places 16 and crafts on
        car.inventoryState.removeQuantity(ORE, 16);
        run(context, 10);
        expect(machine.craftCount).toBeGreaterThan(crafts);
    });
});

describe('a result target in the config', () => {
    const config = (machine: Record<string, unknown>, chests: unknown[] = [{ id: 1, type: 'car' }]) => JSON.stringify({
        target_output: { recipe: ORE, items_per_second: 400, copies: 1, counts: 'destroyed' },
        machines: [{ id: 1, recipe: 'iron-ore-recycling', productivity: 0, crafting_speed: 16.875, ...machine }],
        inserters: [], belts: [], chests,
    });

    it('is taken on a machine that places its results itself', async () => {
        const parsed = await parseConfig(config({ prototype: 'recycler', result_target: { type: 'chest', id: 1 } }));
        expect(parsed.machines[0].result_target).toEqual({ type: 'chest', id: 1 });
        expect(parsed.target_output.counts).toBe('destroyed');
    });

    it('is refused on any other machine, and where its chest is not in the config', async () => {
        await expect(parseConfig(config({ prototype: 'electric-furnace', result_target: { type: 'chest', id: 1 } }))).rejects.toThrow(
            'Machine 1 (electric-furnace) does not place its results itself: only a machine that does (a recycler) has a `result_target`');
        await expect(parseConfig(config({ prototype: 'recycler', result_target: { type: 'chest', id: 2 } }))).rejects.toThrow(
            'Machine 1 places its results into chest 2, which is not in the config');
    });

    it('reads a target without `counts` as the item made, as every config before it', async () => {
        const parsed = await parseConfig(JSON.stringify({ target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
            machines: [], inserters: [], belts: [] }));
        expect(parsed.target_output.counts).toBeUndefined();
    });
});
