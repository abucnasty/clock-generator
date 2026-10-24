import { Config } from "../../config";
import { LOOP_WINDOW_MIN_SWINGS, underBlockMap, underBlockStretches, underBlockWindows } from "../sequence/under-block-windows";
import { alwaysEnabledInserters, loopInserters } from "../sequence/unplanned-inserter-clock";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { Entity, Inserter } from "../../entities";
import { Logger } from "../../common/logger";
import { StockRecording } from "../machine-stock";
import { alwaysEnabledByConfig } from "../plan/plan-run";

/**
 * Whether any of a sink's feeders can carry the sink's fuel. Every inserter has filtered items, derived from its
 * source and sink when the config sets no filters, so there is no "no filter" case to read as carrying anything.
 */
export function anyFeederCarriesFuel(sink_feeders: readonly Inserter[], fuel_item: string | undefined): boolean {
    return fuel_item !== undefined && sink_feeders.some(it => it.filtered_items.has(fuel_item));
}

/**
 * The ticks of each stretch under its output block that an inserter taking from a loop into a machine outside it is
 * enabled for: the machine draws an item as fast as it is brought (`drawn_per_tick`, over the run), and a hand of it
 * fits only under its insertion limit, so what is brought in a stretch (`brought_per_stretch`) is all in once the
 * machine has drawn what is over the limit, (brought - (limit - 1)) / drawn ticks; then the hand's pickup, swing and
 * drop. On agricultural science: 9 and 10 bring 32 eggs a stretch, the science biochamber draws a third of an egg a
 * tick and takes eggs under 28, so 15 ticks, and 5 for the hand: 20.
 */
export function drawWindowTicks(inserter: Inserter, limit: number, brought_per_stretch: number, drawn_per_tick: number): number {
    const drawing = Math.max(0, Math.ceil((brought_per_stretch - (limit - 1)) / drawn_per_tick));
    return drawing + inserter.animation.pickup.ticks + inserter.animation.rotation.ticks + inserter.animation.drop.ticks;
}

/** Items of an item the inserters named dropped a tick over the judged part of the run (after its first third) */
function droppedPerTick(stock: StockRecording, inserter_ids: ReadonlySet<string>, item_name: string, period: number): number {
    const periods = Math.floor(stock.ticks / period);
    const from = Math.max(1, Math.floor(periods / 3) * period), to = periods * period;
    let dropped = 0;
    for (const series of stock.inserters.filter(it => inserter_ids.has(it.inserter_id))) {
        for (let tick = from; tick < to; tick++) {
            if (series.held[tick] < series.held[tick - 1] && series.held_item[tick - 1] === item_name) {
                dropped += series.held[tick - 1] - series.held[tick];
            }
        }
    }
    return to > from ? dropped / (to - from) : 0;
}

/**
 * Windows for the inserters that take from a loop of machines into a machine outside it (the eggs for the science
 * biochamber), which the loop leaves always enabled (`alwaysEnabledInserters`), from a long run of the clock (`stock`):
 * each is enabled in every stretch in which the machine it puts into was under its output block, for as many ticks as
 * the machine needs to draw the hands of the stretch under its insertion limit (`drawWindowTicks`), and disabled in the
 * rest, where the machine could take nothing from it or has what it needs (see `underBlockWindows`). Where the
 * machine's output is taken in windows, the stretches follow them and are the same every period.
 *
 * The inserters of the loop itself stay always enabled: the machines they put into are under their block wherever the
 * loop's own inserters take from them, which does not repeat with the clock, and a loop that runs dry does not start
 * again. Left always enabled too: an inserter the build sets to Always on; every inserter into a machine that one of
 * them can fuel (the simulator lets fuel into a machine whose output is blocked, so the premise does not hold for
 * it); one into a machine that is under its block all the time or nearly; and every one of them on a period that is
 * not a whole number of ticks.
 *
 * Only a proposal: the caller keeps the windows if the as-built check of the build with them passes, over a longer run
 * than the check of the clock without them (see `trialWithLoopWindows`), and the clock is made again without them
 * where it does not get back from a loss with them.
 */
export function loopInserterWindows(
    config: Config,
    period: number,
    stock: StockRecording,
    logger: Logger,
): Map<string, { windows: OpenRange[]; item_name: string }> {
    const result = new Map<string, { windows: OpenRange[]; item_name: string }>();
    if (!Number.isInteger(period)) {
        return result;
    }
    const registry = createEntityRegistryFromConfig(config);
    const always_enabled_by_config = alwaysEnabledByConfig(config);
    const in_a_loop = new Set(loopInserters(registry).map(it => it.entity_id.id));
    const inserters = alwaysEnabledInserters(registry)
        .filter(it => !always_enabled_by_config.has(it.entity_id.id) && !in_a_loop.has(it.entity_id.id));
    const all_inserters = registry.getAll().filter(Entity.isInserter);
    for (const sink_id of new Set(inserters.map(it => it.sink.entity_id.id))) {
        const sink = registry.getEntityByIdOrThrow(inserters.find(it => it.sink.entity_id.id === sink_id)!.sink.entity_id);
        if (!Entity.isMachine(sink)) {
            continue;
        }
        const into_sink = inserters.filter(it => it.sink.entity_id.id === sink_id);
        if (anyFeederCarriesFuel(into_sink, sink.fuel_slot?.fuel.item_name)) {
            logger.log(`Loop windows into ${sink_id}: kept always enabled, one of its inserters carries its fuel`);
            continue;
        }
        const output = stock.machines.find(it => it.machine_id === sink_id)?.outputs[sink.output.item_name];
        const map = output === undefined ? null : underBlockMap(output, sink.output.outputBlock.ingredients_blocked_at, period);
        if (map === null) {
            continue;
        }
        const feeding_sink = new Set(all_inserters.filter(it => it.sink.entity_id.id === sink_id).map(it => it.entity_id.id));
        for (const inserter of into_sink) {
            const min_disabled_ticks = LOOP_WINDOW_MIN_SWINGS * inserter.animation.total.ticks;
            const stretches = underBlockStretches(map, min_disabled_ticks).length;
            const lengths = Array.from(inserter.filtered_items).flatMap(item_name => {
                const input = sink.inputs.get(item_name);
                const drawn = droppedPerTick(stock, feeding_sink, item_name, period);
                return input === undefined || drawn <= 0 ? []
                    : [drawWindowTicks(inserter, input.automated_insertion_limit.quantity, drawn * period / stretches, drawn)];
            });
            const windows = lengths.length === 0 ? null : underBlockWindows(map, min_disabled_ticks, Math.max(...lengths));
            if (windows === null) {
                logger.log(`Loop windows of ${inserter.entity_id.id}: kept always enabled, ${sink_id} is under its output block nearly all the time`);
                continue;
            }
            logger.log(`Loop windows of ${inserter.entity_id.id}: ${Math.max(...lengths)} ticks of each stretch ${sink_id} was under its output block, `
                + `off for ${windows.shortest_off_ticks} to ${windows.longest_off_ticks} ticks at a time`);
            result.set(inserter.entity_id.id, { windows: windows.windows, item_name: Array.from(inserter.filtered_items).sort().join(",") });
        }
    }
    return result;
}
