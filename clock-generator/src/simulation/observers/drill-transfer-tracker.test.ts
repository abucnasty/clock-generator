import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../config/schema';
import { createEntityRegistryFromConfig } from '../../crafting/sequence/simulation-context';
import { InventoryTransferHistory } from '../../crafting/sequence/inventory-transfer-history';
import { EntityId, Machine, MiningDrill } from '../../entities';
import { DrillStatusCode } from '../status-codes';
import { MutableTickProvider } from '../../control-logic/current-tick-provider';
import { DrillTransferTracker } from './drill-transfer-tracker';

/** A drill into a machine, as the stone brick samples have it, with the tracker that records its enabled runs */
function recorder() {
    const config = ConfigSchema.parse({
        target_output: { recipe: 'stone-brick', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'stone-brick', crafting_speed: 2, productivity: 0, type: 'furnace' }],
        drills: { configs: [{ id: 1, type: 'big-mining-drill', mined_item_name: 'stone', speed_bonus: 0, productivity: 0, target: { type: 'machine', id: 1 } }] },
        inserters: [{ source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, prototype: 'stack-inserter', quality: 'legendary', stack_size: 16 }],
        belts: [],
        chests: [{ type: 'infinity-chest', id: 1, item_filter: [], remove_unfiltered_items: true }],
    });
    const registry = createEntityRegistryFromConfig(config);
    const ticks = MutableTickProvider.create();
    const history = new InventoryTransferHistory();
    const drill = registry.getEntityByIdOrThrow(EntityId.forDrill(1)) as MiningDrill;
    const tracker = new DrillTransferTracker(drill, registry.getEntityByIdOrThrow(EntityId.forMachine(1)) as Machine, ticks, history);
    const [disabled, working] = [DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR, DrillStatusCode.WORKING];
    const at = (tick: number, from: DrillStatusCode, to: DrillStatusCode) => {
        ticks.setCurrentTick(tick);
        tracker.onStatusChange(from, to);
    };
    const ranges = () => (history.getAllTransfers().get(drill.entity_id) ?? []).map(it => [it.tick_range.start_inclusive, it.tick_range.end_inclusive]);
    return { at, disabled, working, ranges };
}

describe('the windows a drill into a machine records in the planning run', () => {
    it('are its runs from enabled to disabled, the end one past its last enabled tick', () => {
        const { at, disabled, working, ranges } = recorder();
        at(10, disabled, working);
        at(14, working, disabled);
        expect(ranges()).toEqual([[10, 14]]);
    });

    // Found, not changed: the tracker has no clamp at the warm-up's end, as the inserters' has. The recorded ticks start
    // again at 0 there, so a drill enabled across it records a reversed range. No exported clock has one: the 609 drill
    // ranges of the 238 blast jobs at 7ef358c0 all run forward. A fix is an item of its own, with its own blast.
    it.fails('start at 0 when the drill was enabled before the warm-up ended', () => {
        const { at, disabled, working, ranges } = recorder();
        at(500, disabled, working);
        // the warm-up ends: the recorded ticks start again
        at(10, working, disabled);
        expect(ranges()).toEqual([[0, 10]]);
    });

    // Found, not changed: a drill still enabled when the run ends records nothing of its last run (no wrap to the
    // period's end). The same: a separate item.
    it.fails('end at the run when the drill is still enabled there', () => {
        const { at, disabled, working, ranges } = recorder();
        at(100, disabled, working);
        expect(ranges()).toEqual([[100, 144]]);
    });
});
