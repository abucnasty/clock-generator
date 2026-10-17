import { expect, it } from 'vitest';
import { ChestType } from '../common/entity-types';
import { loadConfigFromFile } from '../config/loader';
import { ConfigPaths } from '../config/config-paths';
import { CompositeControlLogic, TickControlLogic } from '../control-logic';
import { EntityState, MachineStatus } from '../state';
import { SimulationContext } from './sequence/simulation-context';

it('fills a finite terminal chest and stops production, while an infinity chest keeps accepting output', async () => {
    const sample = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    const item = 'automation-science-pack';
    for (const infinity of [false, true]) {
        const context = SimulationContext.fromConfig({ ...sample,
            chests: infinity
                ? [{ id: 1, type: ChestType.INFINITY_CHEST, item_filter: [{ item_name: item, request_count: 1 }] }]
                : [{ id: 1, type: ChestType.BUFFER_CHEST, storage_size: 1, item_filter: item }],
            inserters: sample.inserters.map(inserter => inserter.source.type === 'machine'
                ? { ...inserter, sink: { type: 'chest', id: 1 } } : inserter),
        });
        const chest = context.state_registry.getAllStates().find(EntityState.isChest)!;
        const output = context.inserters.find(inserter => inserter.inserter_state.inserter.sink.entity_id.id === chest.entity_id.id)!.inserter_state;
        const machine = context.machines[0].machine_state;
        const tick = new CompositeControlLogic([new TickControlLogic(context.tick_provider), ...context.machines, context.inserterUpdates()]);
        for (let i = 0; i < 5_000; i++) tick.executeForTick();
        const dropped = output.items_dropped, made = machine.totalCrafted;
        expect(dropped).toBeGreaterThan(0);
        for (let i = 0; i < 1_000; i++) tick.executeForTick();
        if (infinity) {
            expect(chest.isFull()).toBe(false);
            expect(chest.getAvailableSpace()).toBe(Infinity);
            expect(output.items_dropped).toBeGreaterThan(dropped);
            expect(machine.totalCrafted).toBeGreaterThan(made);
        } else {
            expect(chest.isFull()).toBe(true);
            expect(chest.getCurrentQuantity()).toBe(chest.getCapacity());
            expect(dropped).toBe(chest.getCapacity());
            expect(output.items_dropped).toBe(dropped);
            expect(machine.totalCrafted).toBe(made);
            expect(machine.status).toBe(MachineStatus.OUTPUT_FULL);
        }
    }
});
