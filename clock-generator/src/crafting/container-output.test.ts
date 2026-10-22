import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../config/schema';
import { stack, steelHub } from './container-output.fixture';
import { CONTAINER_OUTPUT_PATH_REFUSAL } from '../config/errors';
import { Entity } from '../entities';
import { createEntityRegistryFromConfig, SimulationContext } from './sequence/simulation-context';
import { outputPathOf } from './sequence/cycle/swing-counts';
import { PrepareStep } from './runner/steps/prepare-step';

describe('a product that leaves through a container', () => {
    it('is taken out of the build by the inserters from the container, which the furnace puts it into', () => {
        const registry = createEntityRegistryFromConfig(steelHub());
        const steel = registry.getAll().filter(Entity.isMachine).find(machine => machine.output.item_name === 'steel-plate')!;
        const path = outputPathOf(steel, registry);
        expect(path.container?.entity_id.id).toBe('chest:2');
        expect(path.feeders.map(it => it.entity_id.id)).toEqual(['inserter:2']);
        expect(path.takers.map(it => it.entity_id.id)).toEqual(['inserter:3']);
    });

    it('is as before where the product ends in a container nothing takes from', () => {
        const config = steelHub();
        const registry = createEntityRegistryFromConfig({ ...config, inserters: config.inserters.filter((_, index) => index !== 2), belts: [] });
        const steel = registry.getAll().filter(Entity.isMachine).find(machine => machine.output.item_name === 'steel-plate')!;
        const path = outputPathOf(steel, registry);
        expect(path.container).toBeNull();
        expect(path.feeders.map(it => it.entity_id.id)).toEqual(['inserter:2']);
    });

    it('is refused when it passes through a second container', () => {
        const config = steelHub();
        const two = ConfigSchema.parse({ ...config,
            inserters: [...config.inserters.map((inserter, index) => index === 2 ? { ...inserter, sink: { type: 'chest', id: 3 } } : inserter),
                stack({ type: 'chest', id: 3 }, { type: 'belt', id: 1 }, ['steel-plate'])],
            chests: [...config.chests!, { type: 'car', id: 3 }] });
        const registry = createEntityRegistryFromConfig(two);
        const steel = registry.getAll().filter(Entity.isMachine).find(machine => machine.output.item_name === 'steel-plate')!;
        expect(() => outputPathOf(steel, registry)).toThrow(CONTAINER_OUTPUT_PATH_REFUSAL);
    });

    it('warms up a hub per item: each inserter out of the wagon waits for its own item, not for the wagon to be full of all', () => {
        const context = SimulationContext.fromConfig(steelHub());
        new PrepareStep(context).execute();
        const wagon = context.state_registry.getAllStates().find(state => state.entity_id.id === 'chest:2')!;
        expect((wagon as unknown as { getCurrentQuantity(item: string): number }).getCurrentQuantity('iron-ore')).toBe(1000);
        expect((wagon as unknown as { getCurrentQuantity(item: string): number }).getCurrentQuantity('iron-plate')).toBe(500);
        expect((wagon as unknown as { getCurrentQuantity(item: string): number }).getCurrentQuantity('steel-plate')).toBe(500);
    });
});
