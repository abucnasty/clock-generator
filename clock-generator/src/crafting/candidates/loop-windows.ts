import { Config } from "../../config";
import { LOOP_WINDOW_MIN_SWINGS, underBlockMap, underBlockStretches, underBlockWindows } from "../sequence/under-block-windows";
import { alwaysEnabledInserters, loopInserters } from "../sequence/unplanned-inserter-clock";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { OpenRange } from "../../data-types";
import { Entity, handSizeFor, Inserter } from "../../entities";
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
 * The inserters of the loop itself are not given windows here: the machines they put into are under their block
 * wherever the loop's own inserters take from them, which does not repeat with the clock, so windows read from a run
 * do not fit another, and a loop that runs dry does not start again. Their windows are placed by arithmetic from these
 * (`inLoopInserterWindows`). Left always enabled: an inserter the build sets to Always on; every inserter into a machine that one of
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

/**
 * How the windows of an inserter of a loop itself are placed (see `inLoopInserterWindows`):
 * - "turns": its sink takes nothing while its output is at its output block, which is under a stack of its product,
 *   and takes the loop's item only under an insertion limit that is under a hand, so it takes a hand just after its
 *   output has been taken under the block: the loop's inserters take turns after each window that takes it;
 * - "hands": its sink's insertion limit holds a hand, so a hand it refuses is taken at the next window before it runs
 *   dry: one short window for each hand of the period.
 */
export type InLoopRule = "turns" | "hands";

/** Windows of `ticks` ticks from `start` on positions 0 to `span - 1` of the period, wrapped */
function windowFrom(start: number, ticks: number, span: number): OpenRange[] {
    const first = ((start % span) + span) % span;
    const last = first + ticks - 1;
    return last < span ? [OpenRange.from(first, last)] : [OpenRange.from(first, span - 1), OpenRange.from(0, last - span)];
}

/** The positions of a period windows can name: a whole period's ticks, or every whole tick a fractional one reaches */
function positionsOf(period: number): number {
    return Number.isInteger(period) ? period : Math.ceil(period);
}

/** The windows of the inserters named, as one sorted list with the ones that touch made one */
function windowsOf(windows: ReadonlyMap<string, OpenRange[]>, inserter_ids: readonly string[]): OpenRange[] {
    return OpenRange.reduceRanges(inserter_ids.flatMap(id => windows.get(id) ?? []));
}

/** Hands an inserter dropped a period over the judged part of the run (after its first third), rounded */
function handsPerPeriod(stock: StockRecording, inserter_id: string, period: number): number {
    const series = stock.inserters.find(it => it.inserter_id === inserter_id);
    const periods = Math.floor(stock.ticks / period);
    const from = Math.max(1, Math.floor(Math.floor(periods / 3) * period)), to = Math.floor(periods * period);
    if (series === undefined || to <= from) {
        return 0;
    }
    let hands = 0;
    for (let tick = from; tick < to; tick++) {
        if (series.held[tick - 1] > 0 && series.held[tick] === 0) {
            hands++;
        }
    }
    return Math.round(hands * period / (to - from));
}

/**
 * Windows for the inserters of a loop of machines itself, which `loopInserterWindows` leaves always enabled, placed by
 * arithmetic from the clock's own windows (`windows`, with the windows out of the loop that were kept) and, for
 * "hands", the hands a period each moved in the run of the clock with the loop always enabled (`stock`); no window is
 * read from a run. By the kind of the machine it puts into (see `InLoopRule`):
 *
 * - "turns": the loop's n inserters take turns in each slot of P / A ticks, where A are the anchors: the windows out of
 *   the loop of the machine's takers (`from_loop`, those `loopInserterWindows` gave), or the output windows of the
 *   machine those takers put into where these outnumber them. Inserter j of the loop, in the order of the build, is on
 *   from a swing after each anchor opens, plus j slots / n, for floor(slot / n) + 2 ticks. Where the machine's takers
 *   have no windows out of the loop (none held, or the period is not a whole number of ticks) it stays always enabled.
 *   On agricultural science: the science biochamber's output and the eggs into it are taken 5 times a period of 480,
 *   so slots of 96, and the two egg inserters are on 50 ticks of each, 48 apart, from a swing after the eggs' windows open.
 * - "hands": one window for each hand of the period, a swing and a tick long, spaced evenly from midway between the
 *   openings of the first two output windows of the machine it takes from. On iron bacteria: 2 hands a period of
 *   90.95 ticks, windows of 9 ticks from 15 and 60.
 *
 * Left always enabled: an inserter the build sets to Always on, one that can carry the fuel of the machine it puts into
 * (the simulator lets fuel into a machine whose output is blocked), one whose sink is of neither kind (an insertion
 * limit under a hand without the output block under a stack, or both the other way), one that moved no hand.
 *
 * Only a proposal: the caller keeps the windows where the as-built check passes with them as it did without and with
 * them moved a tick either way (see `trialWithLoopWindows`), and the clock is made again without them where it does
 * not get back from a loss with them.
 */
export function inLoopInserterWindows(
    config: Config,
    period: number,
    windows: ReadonlyMap<string, OpenRange[]>,
    from_loop: ReadonlySet<string>,
    stock: StockRecording,
    logger: Logger,
): Map<string, { windows: OpenRange[]; item_name: string; rule: InLoopRule }> {
    const result = new Map<string, { windows: OpenRange[]; item_name: string; rule: InLoopRule }>();
    const registry = createEntityRegistryFromConfig(config);
    const always_enabled_by_config = alwaysEnabledByConfig(config);
    const in_a_loop = loopInserters(registry);
    const loop_ids = new Set(in_a_loop.map(it => it.entity_id.id));
    const all_inserters = registry.getAll().filter(Entity.isInserter);
    const machine_ids = new Set(registry.getAll().filter(Entity.isMachine).map(it => it.entity_id.id));
    const outputWindowsOf = (machine_id: string) => windowsOf(windows, all_inserters
        .filter(it => it.source.entity_id.id === machine_id && !machine_ids.has(it.sink.entity_id.id)).map(it => it.entity_id.id));
    // the loops: machines joined by the inserters of a loop, each loop's inserters in the order of the build
    const loop_of = new Map<string, string>();
    const root = (id: string): string => loop_of.has(id) && loop_of.get(id) !== id ? root(loop_of.get(id)!) : id;
    for (const it of in_a_loop) {
        const [a, b] = [root(it.source.entity_id.id), root(it.sink.entity_id.id)];
        loop_of.set(a, a);
        loop_of.set(b, a);
    }
    const span = positionsOf(period);
    for (const inserter of in_a_loop) {
        const id = inserter.entity_id.id;
        if (always_enabled_by_config.has(id)) {
            continue;
        }
        const sink = registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (!Entity.isMachine(sink)) {
            continue;
        }
        const items = Array.from(inserter.filtered_items).filter(item_name => sink.inputs.has(item_name));
        if (items.length !== 1 || anyFeederCarriesFuel([inserter], sink.fuel_slot?.fuel.item_name)) {
            continue;
        }
        const limit = sink.inputs.get(items[0])!.automated_insertion_limit.quantity;
        const hand = handSizeFor(inserter, items[0]);
        const block = sink.output.outputBlock;
        const blocks = block.ingredients_blocked_at < block.max_stack_size;
        const rule: InLoopRule | null = blocks && limit < hand ? "turns" : !blocks && limit >= hand ? "hands" : null;
        if (rule === null) {
            continue;
        }
        const loop = in_a_loop.filter(it => root(it.source.entity_id.id) === root(inserter.source.entity_id.id));
        const n = loop.length, j = loop.indexOf(inserter);
        const swing = inserter.animation.total.ticks;
        let placed: OpenRange[];
        if (rule === "turns") {
            const takers = all_inserters.filter(it => it.source.entity_id.id === sink.entity_id.id && !loop_ids.has(it.entity_id.id)
                && from_loop.has(it.entity_id.id));
            const taken = windowsOf(windows, takers.map(it => it.entity_id.id));
            if (taken.length === 0) {
                logger.log(`Loop windows of ${id}: kept always enabled, the takers of ${sink.entity_id.id} out of the loop have no windows`);
                continue;
            }
            const output = outputWindowsOf(takers[0].sink.entity_id.id);
            const anchors = output.length > taken.length ? output : taken;
            const slot = period / anchors.length;
            placed = OpenRange.reduceRanges(anchors.flatMap(anchor =>
                windowFrom(anchor.start_inclusive + swing + Math.round(j * slot / n), Math.floor(slot / n) + 2, span)));
        } else {
            const hands = handsPerPeriod(stock, id, period);
            if (hands < 1) {
                continue;
            }
            const slot = period / hands;
            const output = outputWindowsOf(inserter.source.entity_id.id);
            const phase = output.length === 0 ? 0
                : Math.round((output[0].start_inclusive + (output[1]?.start_inclusive ?? output[0].start_inclusive + period)) / 2) % Math.round(slot);
            const length = Math.min(Math.floor(slot) - 1, swing + 1);
            placed = length >= span ? [OpenRange.from(0, span - 1)] : OpenRange.reduceRanges(Array.from({ length: hands }, (_, k) =>
                windowFrom(phase + Math.round(k * period / hands), length, span)).flat());
        }
        logger.log(`Loop windows of ${id} (${rule}): ${placed.map(range => `${range.start_inclusive}-${range.end_inclusive}`).join(", ")}`);
        result.set(id, { windows: placed, item_name: Array.from(inserter.filtered_items).sort().join(","), rule });
    }
    return result;
}
