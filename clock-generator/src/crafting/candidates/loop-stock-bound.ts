import { Config } from "../../config";
import { FactorioDataService } from "../../data";
import { handOfItem, traitsOf, traitsOfMachine } from "../../entities/traits/traits-of";
import type { SerializableClockWindows } from "../clock";
import type { BlueprintGenerationResult } from "../plan/unclocked-run";
import { computeMachineTargetRates } from "../machine-target-rates";
import { LoopEdge, machineLoopsOf } from "./loop-windows";

/**
 * Hop 1 of #516's bound for one enable window of an inserter of a loop (a window cycle for one that is always on): what the
 * machine it takes from has left for it. Over the window and the ticks before it since the inserter's previous window
 * closed, the machine makes `made` of the item at the planned rate, as if it gave all it held at that closing edge; the
 * takers out of the loop of that item from that machine take `taken`: each of their windows that opens in those ticks a
 * whole window's share (so each window is counted once over the window cycle), and one that is always on its rate over them. `margin` is `made - taken - hand`, in items: under 0
 * the window can close before the inserter holds a full hand.
 */
export interface SourceLeftover {
    /** The opening edge and the closing edge of the window, in ticks of the window cycle */
    readonly start: number;
    readonly end: number;
    /** The ticks counted: the window's and those before it since the previous window closed */
    readonly ticks: number;
    readonly made: number;
    readonly taken: number;
    readonly hand: number;
    readonly margin: number;
}

/**
 * Hop 2 of #516's bound at the machine an inserter of a loop puts into: `stock_at_window_open - draw_rate x longest_gap >=
 * items_per_craft`. The machine holds its insertion limit of the item (`limit`) when the last of its loop feeders' windows
 * closes (else that window would have brought a hand), and draws `draw_per_tick` (its planned crafts a tick times the item a
 * craft) and loses `spoil_per_tick` (the limit over the item's spoil ticks) for the longest stretch of the window cycle no
 * loop feeder of it is enabled (`longest_gap`, 0 where one is always on). `margin_crafts` is what is left over a craft's
 * items, in crafts: under 0 it can run out before the next window opens.
 */
export interface SinkStock {
    readonly limit: number;
    readonly draw_per_tick: number;
    readonly spoil_per_tick: number;
    readonly longest_gap: number;
    readonly per_craft: number;
    readonly margin_crafts: number;
}

/** Both hops for one inserter of a loop: the machine it takes from (`source`) and the one it puts into (`sink`) */
export interface LoopInserterBound {
    readonly inserter: string;
    readonly item: string;
    readonly source: string;
    readonly sink: string;
    /** Its windows, in their order in the window cycle; one, the window cycle, for an inserter that is always on */
    readonly source_leftover: readonly SourceLeftover[];
    readonly sink_stock: SinkStock;
}

/**
 * #516's two-hop bound (0.26.0 DESIGN section 6) on the windows of a clock of a build with a loop of machines: a report of
 * the margins, which no clock is kept or dropped by. `source_leftover_margin` and `sink_stock_margin_crafts` are the least
 * of hop 1 (items) and of hop 2 (crafts) over the loop's inserters.
 */
export interface LoopStockBound {
    readonly inserters: readonly LoopInserterBound[];
    readonly source_leftover_margin: number;
    readonly sink_stock_margin_crafts: number;
}

/** A figure as the bound reports it: to three decimals */
const round = (value: number): number => Math.round(value * 1000) / 1000;

/** A window of the cycle, which may wrap past its last position: ticks `start` to `end` inclusive, `end` < `start` when it wraps */
interface CycleWindow {
    readonly start: number;
    readonly end: number;
}

/** The windows of an inserter on a cycle of `span` positions, one that runs past the last position and on from 0 made one; null where it is always on */
function cycleWindowsOf(windows: SerializableClockWindows, id: string, span: number): CycleWindow[] | null {
    const ranges = [...(windows[id] ?? [])].sort((a, b) => a.start - b.start);
    const covered = ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
    if (ranges.length === 0 || covered >= span) return null;
    const first = ranges[0], last = ranges[ranges.length - 1];
    if (ranges.length > 1 && first.start === 0 && last.end === span - 1) {
        return [...ranges.slice(1, -1), { start: last.start, end: first.end }];
    }
    return ranges;
}

/** Whether position `tick` of a cycle of `span` positions is in the window */
const isIn = (window: CycleWindow, tick: number): boolean => window.start <= window.end
    ? tick >= window.start && tick <= window.end : tick >= window.start || tick <= window.end;

/** The positions of a cycle of `span` from `from` to `to` inclusive, wrapping */
const lengthOf = (from: number, to: number, span: number): number => ((to - from + span) % span) + 1;

/** The longest stretch of positions of the cycle no window covers; 0 where any feeder is always on */
function longestGapOf(feeders: readonly (CycleWindow[] | null)[], span: number): number {
    if (feeders.some(windows => windows === null)) return 0;
    const covered = new Array<boolean>(span).fill(false);
    for (const window of feeders.flat() as CycleWindow[]) {
        for (let tick = window.start; ; tick = (tick + 1) % span) {
            covered[tick] = true;
            if (tick === window.end) break;
        }
    }
    const first = covered.indexOf(true);
    if (first < 0) return span;
    let longest = 0, run = 0;
    for (let k = 1; k <= span; k++) {
        run = covered[(first + k) % span] ? 0 : run + 1;
        longest = Math.max(longest, run);
    }
    return longest;
}

/**
 * #516's two-hop bound (`LoopStockBound`) on a clock's windows (`windows`, by entity id: an inserter with none is always on)
 * of a window cycle of `period` ticks; null where the build has no loop of machines. Windows and gaps are counted on the
 * positions the cycle's windows can name (every whole tick a period that is not whole reaches), the items over its ticks.
 * The rates are the machines' at the target, a copy (`computeMachineTargetRates`); where several loop feeders bring the
 * item to one machine, or several takers out of the loop take it from one, they share its rate evenly.
 */
export function loopStockBound(config: Config, windows: SerializableClockWindows, period: number): LoopStockBound | null {
    const loops = machineLoopsOf(config);
    if (loops.length === 0) return null;
    const span = Number.isInteger(period) ? period : Math.ceil(period);
    const traits = traitsOf(config);
    const rates = new Map(computeMachineTargetRates(config).map(rate => [`machine:${rate.machine_id}`, rate]));
    const madePerTick = (machine: string, item: string) =>
        (rates.get(machine)?.outputs.find(output => output.item_name === item)?.rate_per_second ?? 0) / 60;
    const perCraftOf = (machine: string, item: string) =>
        traitsOfMachine(traits, machine).production.inputs.find(input => input.item === item)?.per_craft ?? 0;
    const drawPerTick = (machine: string, item: string) =>
        (rates.get(machine)?.crafting_share ?? 0) * (traitsOfMachine(traits, machine).production.inputs.find(input => input.item === item)?.per_tick ?? 0);

    const bounds: LoopInserterBound[] = [];
    for (const loop of loops) {
        const feedersOf = (edge: LoopEdge) => loop.own.filter(it => it.to === edge.to && it.item === edge.item);
        // what the loop draws of an item from a machine: its share of each sink's draw that a loop feeder from it brings
        const loopDrawFrom = (machine: string, item: string) => loop.own.filter(it => it.from === machine && it.item === item)
            .reduce((sum, it) => sum + drawPerTick(it.to, item) / feedersOf(it).length, 0);
        for (const edge of loop.own) {
            const own = cycleWindowsOf(windows, edge.inserter, span);
            const hand = handOfItem(traits, edge.inserter, edge.item);
            const takers = loop.out.filter(it => it.from === edge.from && it.item === edge.item);
            const taker_rate = takers.length === 0 ? 0
                : Math.max(0, madePerTick(edge.from, edge.item) - loopDrawFrom(edge.from, edge.item)) / takers.length;
            const source_leftover = (own ?? [{ start: 0, end: span - 1 }]).map((window, at, all): SourceLeftover => {
                // the ticks since the previous window closed, and the window's own
                const previous = all[(at - 1 + all.length) % all.length];
                const whole = own === null || all.length === 1;
                const counted: CycleWindow = whole ? { start: 0, end: span - 1 } : { start: (previous.end + 1) % span, end: window.end };
                // on a period that is not whole, its positions stand for period / span ticks each
                const ticks = whole ? period : lengthOf(counted.start, counted.end, span) * period / span;
                const taken = takers.reduce((sum, taker) => {
                    const taker_windows = cycleWindowsOf(windows, taker.inserter, span);
                    if (taker_windows === null) return sum + taker_rate * ticks;
                    const share = taker_rate * period / taker_windows.length;
                    return sum + share * (whole ? taker_windows.length : taker_windows.filter(it => isIn(counted, it.start)).length);
                }, 0);
                const made = madePerTick(edge.from, edge.item) * ticks;
                return { start: window.start, end: window.end, ticks: round(ticks), made: round(made), taken: round(taken), hand, margin: round(made - taken - hand) };
            });
            const limit = traitsOfMachine(traits, edge.to).input_limits.limits.find(it => it.item === edge.item)?.limit ?? 0;
            const per_craft = perCraftOf(edge.to, edge.item);
            const draw_per_tick = drawPerTick(edge.to, edge.item);
            const spoil_ticks = FactorioDataService.itemSpoilTicks(edge.item);
            const spoil_per_tick = spoil_ticks === null ? 0 : limit / spoil_ticks;
            const longest_gap = longestGapOf(feedersOf(edge).map(it => cycleWindowsOf(windows, it.inserter, span)), span);
            const left = limit - (draw_per_tick + spoil_per_tick) * longest_gap;
            bounds.push({
                inserter: edge.inserter, item: edge.item, source: edge.from, sink: edge.to, source_leftover,
                sink_stock: { limit, draw_per_tick: round(draw_per_tick), spoil_per_tick: round(spoil_per_tick), longest_gap, per_craft,
                    margin_crafts: per_craft > 0 ? round(left / per_craft - 1) : 0 },
            });
        }
    }
    return {
        inserters: bounds,
        source_leftover_margin: Math.min(...bounds.flatMap(it => it.source_leftover.map(window => window.margin))),
        sink_stock_margin_crafts: Math.min(...bounds.map(it => it.sink_stock.margin_crafts)),
    };
}

/** The assessment's `loop_stock_bound` of a clock: its bound where it has windows for a loop (`loop_windows`), else nothing */
export function loopStockBoundOf(config: Config, result: Pick<BlueprintGenerationResult, "loop_windows" | "clock_windows">, period: number): { loop_stock_bound?: LoopStockBound } {
    const bound = result.loop_windows === undefined ? null : loopStockBound(config, result.clock_windows, period);
    return bound === null ? {} : { loop_stock_bound: bound };
}
