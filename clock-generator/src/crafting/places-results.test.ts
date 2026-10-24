import { describe, expect, it } from 'vitest';
import { loadConfigFromFile, parseConfig } from '../config/loader';
import { ConfigSchema, type Config } from '../config/schema';
import { CompositeControlLogic, TickControlLogic } from '../control-logic';
import { EntityState, MachineState, MachineStatus, SlotContainerState } from '../state';
import { SimulationContext, createEntityRegistryFromConfig } from './sequence/simulation-context';
import { ConfigPaths } from '../config/config-paths';

// The exact-speed recycler cell of the ore voider benchmark (save F): a recycler at crafting speed 16.875 voids iron ore,
// fed by four stack inserters from the ore supply, and places what it gives back into a car, which two stack inserters
// empty back into it
const FIXTURE = ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED;

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
        // placed in the tick it was made, as recorded: nothing waits while the car has room
        expect(waiting).toBe(0);
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

/** A recycler at the speed of a normal one with no modules, fed from an infinity chest, its results kept in its output */
function recyclerWithTakers(recipe: string, ingredient: string, takers: { prototype: string; item: string }[]): Config {
    return ConfigSchema.parse({
        target_output: { recipe: takers[0].item, items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe, productivity: 0, crafting_speed: 0.5, prototype: 'recycler' }],
        inserters: [
            { id: 1, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, filters: [ingredient] },
            ...takers.map((taker, index) => ({ id: index + 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: index + 2 },
                prototype: taker.prototype, filters: [taker.item] })),
        ],
        belts: [],
        chests: [{ type: 'infinity-chest', id: 1, item_filter: [{ item_name: ingredient, request_count: 100 }] },
            ...takers.map((_, index) => ({ type: 'car', id: index + 2 }))],
    }) as Config;
}

/** The hands an inserter drops in a run, by their size */
function handsDropped(context: SimulationContext, inserter_id: string, ticks: number): Map<number, number> {
    const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates()]);
    const state = context.state_registry.getAllStates().filter(EntityState.isInserter).find(it => it.entity_id.id === inserter_id)!;
    const hands = new Map<number, number>();
    for (let i = 0; i < ticks; i++) {
        const before = state.items_dropped;
        tick.executeForTick();
        const dropped = state.items_dropped - before;
        if (dropped > 0) hands.set(dropped, (hands.get(dropped) ?? 0) + 1);
    }
    return hands;
}

describe('a machine that places its results itself, with no result target', () => {
    it('stops, and takes no ingredients, while a stack of any one of its results waits in its output', async () => {
        // recycling electronic circuits gives a copper cable at 3/4 and an iron plate at 1/4: nothing takes the plates
        const context = SimulationContext.fromConfig(recyclerWithTakers('electronic-circuit-recycling', 'electronic-circuit',
            [{ prototype: 'stack-inserter', item: 'copper-cable' }]));
        const machine = context.machines[0].machine_state;
        // 16 crafts a second, an iron plate every 4: 100 plates in 25 s
        run(context, 30 * 60);
        expect(machine.inventoryState.getQuantity('iron-plate')).toBe(100);
        expect(machine.status).toBe(MachineStatus.OUTPUT_FULL);
        expect(MachineState.machineIsOutputBlocked(machine)).toBe(true);
        // emptied of circuits, it is given none while the plates wait
        machine.inventoryState.removeQuantity('electronic-circuit', machine.inventoryState.getQuantity('electronic-circuit'));
        const crafts = machine.craftCount;
        run(context, 600);
        expect(machine.craftCount).toBe(crafts);
        expect(machine.inventoryState.getQuantity('electronic-circuit')).toBe(0);
        // room for one plate: circuits come in again and it crafts
        machine.inventoryState.removeQuantity('iron-plate', 1);
        run(context, 60);
        expect(machine.craftCount).toBeGreaterThan(crafts);
    });

    it('is emptied a part hand at a time by an inserter that is no bulk one, and a full hand at a time by a bulk one', async () => {
        // iron ore back at 1/4 of 16 crafts a second: one every 15 ticks, so a hand of 4 or 16 never waits full
        const long_handed = handsDropped(SimulationContext.fromConfig(recyclerWithTakers('iron-ore-recycling', ORE,
            [{ prototype: 'long-handed-inserter', item: ORE }])), 'inserter:2', 60 * 60);
        expect(Math.max(...long_handed.keys())).toBeLessThan(4);
        // 240 ore back in the minute, every one of them carried
        expect([...long_handed].reduce((sum, [size, count]) => sum + size * count, 0)).toBeGreaterThan(230);
        const stack = handsDropped(SimulationContext.fromConfig(recyclerWithTakers('iron-ore-recycling', ORE,
            [{ prototype: 'stack-inserter', item: ORE }])), 'inserter:2', 60 * 60);
        expect([...stack.keys()]).toEqual([16]);
    });
});

/** A recycler on scrap placing its results into a rocket silo, one inserter per result out of the silo */
async function scrapIntoSilo(recipe_quality?: string, productivity = 0): Promise<string> {
    const { RecipeMetadata } = await import('../entities/machine/recipe/recipe-metadata');
    const results = RecipeMetadata.fromRecipeName('scrap-recycling').outputs.map(it => it.name);
    return JSON.stringify({
        target_output: { recipe: 'scrap', items_per_second: 2, copies: 1, counts: 'destroyed' },
        machines: [{ id: 1, recipe: 'scrap-recycling', productivity, crafting_speed: 0.5, prototype: 'recycler', result_target: { type: 'chest', id: 2 } }],
        inserters: [
            { id: 1, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, filters: ['scrap'] },
            ...results.map((item, index) => ({ id: index + 2, source: { type: 'chest', id: 2 }, sink: { type: 'chest', id: index + 3 }, filters: [item] })),
        ],
        belts: [],
        chests: [
            { type: 'infinity-chest', id: 1, item_filter: [{ item_name: 'scrap', request_count: 100 }] },
            { type: 'rocket-silo', id: 2, ...(recipe_quality !== undefined && { recipe_quality }) },
            ...results.map((_, index) => ({ type: 'infinity-chest', id: index + 3, item_filter: [], remove_unfiltered_items: true })),
        ],
    });
}

describe('a rocket silo as the result target', () => {
    it('is refused where its rocket part recipe is of normal quality and takes some of the results', async () => {
        // recorded: processing units and low density structure fill its input slots, and the recycler stops for good
        await expect(parseConfig(await scrapIntoSilo())).rejects.toThrow('Machine 1 places processing-unit and low-density-structure into rocket silo 2, '
            + 'whose rocket part recipe takes them at normal quality');
        await expect(parseConfig(await scrapIntoSilo('normal'))).rejects.toThrow("Set the silo's `recipe_quality` to another quality");
        await expect(parseConfig(await scrapIntoSilo('uncommon'))).resolves.toBeDefined();
    });

    it('takes results too rare for their hands to come out whole in a clock period: that is refused, not run', async () => {
        // at +300% (scrap recycling productivity researched to level 30) the takers' hands come out whole in no period
        const { generateClockAlternatives } = await import('./generate-blueprint');
        const config = await parseConfig(await scrapIntoSilo('uncommon', 300));
        const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow('A clock for results that come this rarely is not planned yet');
    });
});

describe('a recycler brought an item its recipe does not use', () => {
    it('is refused: it picks its recipe from its input, as a furnace does, and the switch is not recorded', async () => {
        const config = await loadConfigFromFile(ConfigPaths.RECYCLING_SCRAP_SILO);
        const gears: Config = {
            ...config,
            inserters: [...config.inserters, { id: 14, source: { type: 'chest', id: 15 }, sink: { type: 'machine', id: 1 }, filters: ['iron-gear-wheel'] } as never],
            chests: [...config.chests!, { type: 'infinity-chest', id: 15, item_filter: [{ item_name: 'iron-gear-wheel', request_count: 50 }] } as never],
        };
        expect(() => createEntityRegistryFromConfig(gears)).toThrow('Inserter 14 brings iron-gear-wheel into Machine 1, which makes scrap-recycling from scrap. '
            + 'A furnace or a recycler picks its recipe from the items it is brought');
    });
});
