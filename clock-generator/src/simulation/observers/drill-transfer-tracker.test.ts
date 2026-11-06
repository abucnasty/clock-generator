import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../config/schema';
import { createEntityRegistryFromConfig } from '../../crafting/sequence/simulation-context';
import { InventoryTransferHistory } from '../../crafting/sequence/inventory-transfer-history';
import { EntityId, Machine, MiningDrill } from '../../entities';
import { DrillStatusCode } from '../status-codes';
import { MutableTickProvider } from '../current-tick-provider';
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
    /** The recorded run ends at this tick */
    const endRun = (tick: number) => {
        ticks.setCurrentTick(tick);
        tracker.endRun();
    };
    return { at, disabled, working, ranges, endRun };
}

describe('the windows a drill into a machine records in the planning run', () => {
    it('are its runs from enabled to disabled, the end one past its last enabled tick', () => {
        const { at, disabled, working, ranges } = recorder();
        at(10, disabled, working);
        at(14, working, disabled);
        expect(ranges()).toEqual([[10, 14]]);
    });

    // The recorded ticks start again at 0 when the warm-up ends, so a tick read in the warm-up is larger than the run's
    // current one. As the inserters' tracker does, a drill enabled before that counts from the run's first tick.
    it('start at 0 when the drill was enabled before the warm-up ended', () => {
        const { at, disabled, working, ranges } = recorder();
        at(500, disabled, working);
        // the warm-up ends: the recorded ticks start again
        at(10, working, disabled);
        expect(ranges()).toEqual([[0, 10]]);
    });

    it('end at the run\'s end when the drill is still enabled there', () => {
        const { at, disabled, working, ranges, endRun } = recorder();
        at(100, disabled, working);
        endRun(144);
        expect(ranges()).toEqual([[100, 144]]);
    });

    it('are the whole run when the drill was enabled before the warm-up ended and is still enabled at the end', () => {
        const { at, disabled, working, ranges, endRun } = recorder();
        at(500, disabled, working);
        endRun(144);
        expect(ranges()).toEqual([[0, 144]]);
    });

    it('have no window at the end of a run in which the drill is disabled', () => {
        const { at, disabled, working, ranges, endRun } = recorder();
        at(10, disabled, working);
        at(14, working, disabled);
        endRun(144);
        expect(ranges()).toEqual([[10, 14]]);
    });

    it('go on from the end of the run when the drill is still enabled there and is disabled after', () => {
        const { at, disabled, working, ranges, endRun } = recorder();
        at(100, disabled, working);
        endRun(144);
        at(150, working, disabled);
        expect(ranges()).toEqual([[100, 144], [144, 150]]);
    });
});
