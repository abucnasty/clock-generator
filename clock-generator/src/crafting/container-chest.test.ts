import { expect, it } from 'vitest';
import { loadConfigFromFile } from '../config/loader';
import { ConfigPaths } from '../config/config-paths';
import { ConfigSchema } from '../config/schema';
import { InserterStatus, MachineStatus } from '../state';
import { SimulationContext } from './sequence/simulation-context';
import { ContainerStorage } from '../simulation/components/container-storage';
import { TickByHand } from './runner/tick-by-hand.fixture';

const item = 'automation-science-pack';

it('fills a cargo wagon at the end of the line to its last free slot, then holds its output inserter at target full', async () => {
    const sample = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    // 39 of its 40 slots hold wood: one slot, a stack of 200 packs, is left
    const contents = Array.from({ length: 39 }, (_, index) => ({ slot: index + 2, item: 'wood', count: 100 }));
    const context = SimulationContext.fromConfig(ConfigSchema.parse({ ...sample,
        chests: [{ id: 1, type: 'cargo-wagon', contents }],
        inserters: sample.inserters.map(inserter => inserter.source.type === 'machine' ? { ...inserter, sink: { type: 'chest', id: 1 } } : inserter),
    }));
    const wagon = context.state_registry.getAllStates().find(ContainerStorage.isSlots)!;
    expect(wagon.chest.slot_count).toBe(40);
    const output = context.inserters.find(inserter => inserter.inserter_state.inserter.sink.entity_id.id === wagon.entity_id.id)!.inserter_state;
    const machine = context.machines[0].machine_state;
    const tick = new TickByHand(context);
    for (let i = 0; i < 40_000; i++) tick.executeForTick();
    expect(wagon.getCurrentQuantity(item)).toBe(200);
    expect(wagon.isFull(item)).toBe(true);
    expect(output.items_dropped).toBe(200);
    const made = machine.totalCrafted;
    for (let i = 0; i < 2_000; i++) tick.executeForTick();
    expect(machine.totalCrafted).toBe(made);
    expect(machine.status).toBe(MachineStatus.OUTPUT_FULL);
    // a hand that no longer fit stays in the hand, as in the game
    expect(output.held_item === null || output.status === InserterStatus.TARGET_FULL).toBe(true);
});

it('gives a mixed car the item of its last slot first, across stacks, and waits for a full hand', () => {
    // as the game did: iron 40 in slot 1, copper 100 in 2, gears 30 in 5, iron 100 in 9; an unfiltered inserter into a
    // disposal chest took iron (16 from slot 9 at a time, then 4 of it and 12 from slot 1), then the gears of slot 5
    const context = SimulationContext.fromConfig(ConfigSchema.parse({
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: 'chest', id: 1 }, sink: { type: 'chest', id: 2 } },
            { id: 2, source: { type: 'chest', id: 3 }, sink: { type: 'machine', id: 1 } },
            { id: 3, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 2 } },
        ],
        belts: [],
        chests: [
            { id: 1, type: 'car', contents: [
                { slot: 1, item: 'iron-plate', count: 40 }, { slot: 2, item: 'copper-plate', count: 100 },
                { slot: 5, item: 'iron-gear-wheel', count: 30 }, { slot: 9, item: 'iron-plate', count: 100 }] },
            { id: 2, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true },
            { id: 3, type: 'infinity-chest', item_filter: [{ item_name: 'iron-plate', request_count: 100 }] },
        ],
    }));
    const car = context.state_registry.getAllStates().find(ContainerStorage.isSlots)!;
    const taker = context.inserters.find(inserter => inserter.inserter_state.inserter.source.entity_id.id === car.entity_id.id)!.inserter_state;
    const tick = new TickByHand(context, { machines: false });
    const hands: string[] = [];
    let last = '';
    for (let i = 0; i < 400; i++) {
        tick.executeForTick();
        const held = taker.held_item === null ? '' : `${taker.held_item.item_name}:${taker.held_item.quantity}`;
        if (held !== last && held !== '') hands.push(held);
        last = held;
    }
    // seven hands of iron, the last 4 from slot 9 and 12 from slot 1; then slot 5 is the last that holds anything
    expect(hands).toEqual([...new Array(7).fill('iron-plate:16'), 'iron-gear-wheel:16', 'iron-gear-wheel:14']);
    expect(car.inventoryState.slots[8].item).toBeNull();
    expect(car.inventoryState.slots[0]).toMatchObject({ item: 'iron-plate', count: 28 });
    // the hand of 14 gears waits for more gears, with iron and copper beside them
    expect(taker.held_item).toEqual({ item_name: 'iron-gear-wheel', quantity: 14 });
    expect(car.getCurrentQuantity('iron-gear-wheel')).toBe(0);
    expect(car.getCurrentQuantity('copper-plate')).toBe(100);
});
