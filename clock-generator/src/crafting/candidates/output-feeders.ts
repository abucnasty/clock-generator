import { Config } from "../../config";
import { outputFeederWindows, OUTPUT_FEEDER_MIN_SWINGS } from "../sequence/output-feeder-windows";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { Entity, EntityId, Inserter } from "../../entities";
import { Logger } from "../../common/logger";
import { StockRecording } from "../machine-stock";
import { alwaysEnabledByConfig } from "../plan/plan-run";

/** The inserters from one machine into one of the output machines: the only ones that can be given feeder windows */
export function feedersOfOutputMachines(inserters: readonly Inserter[], output_machine_ids: ReadonlySet<string>): Inserter[] {
    return inserters.filter(inserter =>
        EntityId.isMachine(inserter.source.entity_id) && EntityId.isMachine(inserter.sink.entity_id)
        && output_machine_ids.has(inserter.sink.entity_id.id));
}

/**
 * Whether any of a sink's feeders can carry the sink's fuel. Every inserter has filtered items, derived from its
 * source and sink when the config sets no filters, so there is no "no filter" case to read as carrying anything.
 */
export function anyFeederCarriesFuel(sink_feeders: readonly Inserter[], fuel_item: string | undefined): boolean {
    return fuel_item !== undefined && sink_feeders.some(it => it.filtered_items.has(fuel_item));
}

/**
 * Windows for the inserters that are left always enabled and put into the machine the build's output is taken from
 * (the eggs for the science biochamber), when that machine's output inserters are clocked: the machine takes nothing
 * from them while its output is at its block, which on a clock that takes the output in bursts is a stretch of every
 * cycle. They are enabled from the start of an output window until the output is back at its block, as the long run
 * of the build with them always enabled shows (`stock`), and disabled until the next window. Builds whose output
 * never leaves the block for long enough keep them always enabled. See `outputFeederWindows`.
 *
 * Only a proposal: the caller keeps the windows if the as-built check of the build with them passes, over a longer run
 * than the check of the clock without them (see `OUTPUT_FEEDER_CHECK_TICKS`). When any feeder of a sink can carry that
 * sink's fuel, none of its feeders gets windows: the simulator lets fuel into a machine whose output is blocked, so the
 * premise (nothing is taken while the output is at its block) does not hold for it.
 */
export function windowsOfInsertersFeedingTheOutputMachine(
    config: Config,
    windows: Map<string, OpenRange[]>,
    period: number,
    stock: StockRecording,
    output_machine_ids: ReadonlySet<string>,
    logger: Logger,
): Map<string, { windows: OpenRange[]; item_name: string }> {
    const result = new Map<string, { windows: OpenRange[]; item_name: string }>();
    if (!Number.isInteger(period)) {
        return result;
    }
    const registry = createEntityRegistryFromConfig(config);
    const always_enabled_by_config = alwaysEnabledByConfig(config);
    const feeders = feedersOfOutputMachines(alwaysEnabledInserters(registry), output_machine_ids)
        .filter(it => !always_enabled_by_config.has(it.entity_id.id));
    for (const sink_id of new Set(feeders.map(it => it.sink.entity_id.id))) {
        const sink = registry.getEntityByIdOrThrow(feeders.find(it => it.sink.entity_id.id === sink_id)!.sink.entity_id);
        if (!Entity.isMachine(sink)) {
            continue;
        }
        const output_inserters = registry.getAll().filter(Entity.isInserter).filter(it => it.source.entity_id.id === sink_id);
        const output_windows = output_inserters.map(it => windows.get(it.entity_id.id));
        if (output_inserters.length === 0 || output_windows.some(it => it === undefined || it.length === 0)) {
            continue;
        }
        const fuel_item = sink.fuel_slot?.fuel.item_name;
        const sink_feeders = feeders.filter(it => it.sink.entity_id.id === sink_id);
        if (anyFeederCarriesFuel(sink_feeders, fuel_item)) {
            logger.log(`Output feeders of ${sink_id}: kept always enabled, one of them carries its fuel`);
            continue;
        }
        const min_disabled_ticks = OUTPUT_FEEDER_MIN_SWINGS * Math.max(...sink_feeders.map(it => it.animation.total.ticks));
        const ranges = OpenRange.reduceRanges(output_windows.flatMap(it => it!));
        // the least a gap between output windows can be: the margin and a tick to be back at the block come out of it
        const gaps = ranges.map((range, index) =>
            (index + 1 === ranges.length ? period + ranges[0].start_inclusive : ranges[index + 1].start_inclusive) - range.end_inclusive - 1);
        if (Math.min(...gaps) < min_disabled_ticks + 1) {
            continue;
        }
        const output = stock.machines.find(it => it.machine_id === sink_id)?.outputs[sink.output.item_name];
        if (output === undefined) {
            continue;
        }
        const feeder_windows = outputFeederWindows(output, sink.output.outputBlock.ingredients_blocked_at, ranges, period, min_disabled_ticks);
        logger.log(feeder_windows === null
            ? `Output feeders of ${sink_id}: kept always enabled`
            : `Output feeders of ${sink_id}: output back at its block up to ${feeder_windows.latest_back_at_block_ticks} ticks after an output window, `
                + `enabled ${feeder_windows.enabled_after_output_window_ticks} ticks after it, disabled for at least ${feeder_windows.disabled_ticks} ticks`);
        if (feeder_windows === null) {
            continue;
        }
        for (const feeder of sink_feeders) {
            result.set(feeder.entity_id.id, { windows: feeder_windows.windows, item_name: Array.from(feeder.filtered_items).sort().join(",") });
        }
    }
    return result;
}
