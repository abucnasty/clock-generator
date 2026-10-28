import { expect, it } from 'vitest';
import { Config, ConfigSchema } from '../config/schema';
import { loadConfigFromFile } from '../config/loader';
import { ConfigPaths } from '../config/config-paths';
import { Entity, EntityId } from '../entities';
import { MachineStatus } from '../state';
import { SimulationContext } from './sequence/simulation-context';
import { TimelineRecorder } from './timeline-recording';
import { createInserterCoverageValidator, validateInserterCoverage } from '../config/inserter-coverage-validator';
import { validateConfig } from './plan/validate-config';
import { ContainerStorage } from '../simulation/components/container-storage';
import { TickByHand } from './runner/tick-by-hand.fixture';

const item = 'automation-science-pack';
async function disposalConfig(explicit = false): Promise<Config> {
    const sample = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    return ConfigSchema.parse({ ...sample,
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
        inserters: sample.inserters.map(inserter => inserter.source.type === 'machine'
            ? { ...inserter, filters: explicit ? [item] : undefined, sink: { type: 'chest', id: 1 } } : inserter),
    });
}

it.each([false, true])('accepts output with explicit filters=%s, records deliveries, and never accumulates discarded items', async explicit => {
    const config = await disposalConfig(explicit);
    expect(validateConfig(config).period_ticks).toBeGreaterThan(0);
    const context = SimulationContext.fromConfig(config);
    const chest = context.state_registry.getAllStates().find(ContainerStorage.isConstant)!;
    const output = context.inserters.find(inserter => inserter.inserter_state.inserter.sink.entity_id.id === chest.entity_id.id)!.inserter_state;
    expect([...output.inserter.filtered_items]).toEqual([item]);
    const recorder = new TimelineRecorder(context, { period_ticks: 6_000 });
    const tick = new TickByHand(context);
    const advance = () => { for (let i = 0; i < 1_000; i++) { tick.executeForTick(); recorder.record(); } };
    advance();
    const delivered = output.items_dropped;
    advance();
    expect(output.items_dropped).toBeGreaterThan(delivered);
    expect(chest.inventoryState.getTotalQuantity()).toBe(0);
    const recording = recorder.recording('plan', 6_000, 0, 1);
    expect(recording.events.some(event => event.kind === 'drop' && event.item === item && event.amount > 0)).toBe(true);
    expect(recording.entities.find(entity => entity.id === chest.entity_id.id)).toMatchObject({ items: [], note: 'All incoming items are removed. This chest supplies no items.' });
    // Output-loss trials can still close a disposal endpoint and restore it afterwards.
    chest.supply.refused.add(item);
    advance();
    const stopped = output.items_dropped;
    advance();
    expect(output.items_dropped).toBe(stopped);
    expect(context.machines[0].machine_state.status).toBe(MachineStatus.OUTPUT_FULL);
    chest.supply.refused.clear();
    advance();
    expect(output.items_dropped).toBeGreaterThan(stopped);
});

it('keeps configured supplies constant while disposing of other incoming items', async () => {
    const config = await disposalConfig();
    config.chests![0] = { type: 'infinity-chest', id: 1, item_filter: [{ item_name: 'iron-plate', request_count: 10 }], remove_unfiltered_items: true };
    const context = SimulationContext.fromConfig(config);
    const chest = context.state_registry.getAllStates().find(ContainerStorage.isConstant)!;
    expect(chest.chest.getItemFilters()).toEqual(['iron-plate']);
    expect(chest.chest.acceptsItem(item)).toBe(true);
    chest.inventoryState.addQuantity(item, 500);
    chest.inventoryState.removeQuantity('iron-plate', 5);
    expect(chest.getCurrentQuantity('iron-plate')).toBe(10);
    expect(chest.getCurrentQuantity(item)).toBe(0);
});

it('does not treat a removal-only chest as an ingredient source or suggest one to fix a missing input', async () => {
    const config = await disposalConfig();
    config.inserters = [{ id: 1, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 16 }];
    const issues = validateInserterCoverage(config);
    expect(issues.filter(issue => issue.kind === 'missing_input_inserter').length).toBeGreaterThan(0);
    expect(issues.filter(issue => issue.kind === 'missing_input_inserter').flatMap(issue => issue.fix_options)
        .some(fix => fix.type === 'existing_connection' && fix.endpoint_type === 'chest' && fix.endpoint_id === 1)).toBe(false);
    const entity = SimulationContext.fromConfig(config).entity_registry.getEntityByIdOrThrow(EntityId.forInserter(1));
    expect(Entity.isInserter(entity) && entity.filtered_items.size).toBe(0);
    const output = issues.find(issue => issue.kind === 'missing_output_inserter')!;
    expect(output.fix_options).toContainEqual({ type: 'existing_connection', endpoint_type: 'chest', endpoint_id: 1, item_name: item });
});

it('gives an actionable error for an empty receiving chest with removal disabled, while preserving old filtered configs', async () => {
    const config = await disposalConfig();
    const disabled = { ...config, chests: [{ type: 'infinity-chest', id: 1, item_filter: [] }] };
    const parsed = ConfigSchema.safeParse(disabled);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain('enable Remove unfiltered items');
    config.chests![0] = { type: 'infinity-chest', id: 1, item_filter: [{ item_name: item, request_count: 1 }] };
    const chest = SimulationContext.fromConfig(config).state_registry.getAllStates().find(ContainerStorage.isConstant)!;
    expect(chest.chest.remove_unfiltered_items).toBe(false);
    expect(chest.getCurrentQuantity(item)).toBe(1);
    expect(chest.chest.acceptsItem('iron-plate')).toBe(false);
});

it('supports zero-stock filters as accepting endpoints without turning them into supplies', async () => {
    const config = await disposalConfig();
    config.chests![0] = { type: 'infinity-chest', id: 1, item_filter: [{ item_name: item, request_count: 0 }] };
    expect(ConfigSchema.safeParse(config).success).toBe(true);
    const chest = SimulationContext.fromConfig(config).state_registry.getAllStates().find(ContainerStorage.isConstant)!;
    expect(chest.chest.getItemFilters()).toEqual([]);
    expect(chest.chest.acceptsItem(item)).toBe(true);
    expect(chest.getCurrentQuantity(item)).toBe(0);
});


it('invalidates cached connection coverage when the removal switch changes', async () => {
    const config = await disposalConfig(), validate = createInserterCoverageValidator();
    expect(validate(config).filter(issue => issue.kind === 'missing_output_inserter')).toHaveLength(0);
    const disabled: Config = { ...config, chests: [{ type: 'infinity-chest', id: 1, item_filter: [], remove_unfiltered_items: false }] };
    expect(validate(disabled).filter(issue => issue.kind === 'missing_output_inserter')).toHaveLength(1);
    expect(validate(config).filter(issue => issue.kind === 'missing_output_inserter')).toHaveLength(0);
});
