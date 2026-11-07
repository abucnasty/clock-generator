import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { loopStockBound } from "./loop-stock-bound";
import { machineLoopsOf } from "./loop-windows";

/** `count` windows of `ticks` ticks a period, evenly from `offset`, one that runs past the last tick split as a clock writes it */
const every = (window_cycle_ticks: number, count: number, offset: number, ticks: number) => Array.from({ length: count }, (_, k) => {
    const start = (k * window_cycle_ticks / count + offset) % window_cycle_ticks, end = (start + ticks - 1) % window_cycle_ticks;
    return end < start ? [{ start, end: window_cycle_ticks - 1 }, { start: 0, end }] : [{ start, end }];
}).flat();

describe("machineLoopsOf", () => {
    // the planner graph's composite nodes with an edge between two machines
    it("reads agricultural science's egg loop: 5 and 8 its own, 9 and 10 its takers into the science biochamber", async () => {
        const [loop, ...rest] = machineLoopsOf(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250));
        expect(rest).toEqual([]);
        expect(loop.own.map(it => [it.inserter, it.from, it.to])).toEqual([["inserter:5", "machine:4", "machine:3"], ["inserter:8", "machine:3", "machine:4"]]);
        expect(loop.out.filter(it => it.to.startsWith("machine:")).map(it => it.inserter)).toEqual(["inserter:9", "inserter:10"]);
    });

    it("has no loop for the ore voider, whose machine and chest loop has no edge between two machines", async () => {
        expect(machineLoopsOf(await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_EXACT_SPEED))).toEqual([]);
    });
});

describe("loopStockBound", () => {
    // 0.26.0's selected agricultural science set: each egg inserter of the loop 50 ticks of every 96, the two 48 apart; the
    // science biochamber's egg inserters 24 ticks of each 96. An egg biochamber draws 1/15 egg a tick, holds 7 at the close.
    it("gives the egg loop's sinks 2.9 crafts over the 46-tick gap, and its sources 9.6 eggs short of a hand a window", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250);
        const bound = loopStockBound(config, {
            "inserter:5": every(480, 5, 0, 50), "inserter:8": every(480, 5, 48, 50),
            "inserter:9": every(480, 5, 15, 24), "inserter:10": every(480, 5, 15, 24),
        }, 480)!;
        expect(bound.inserters.map(it => it.inserter)).toEqual(["inserter:5", "inserter:8"]);
        expect(bound.inserters[0].sink_stock).toMatchObject({ limit: 7, longest_gap: 46, per_craft: 1, margin_crafts: 2.927 });
        // a window and the 46 ticks before it: 96 ticks of 7/30 egg, less a window of the science biochamber's (16), less a hand
        expect(bound.inserters[0].source_leftover).toHaveLength(5);
        expect(bound.inserters[0].source_leftover[0]).toMatchObject({ ticks: 96, made: 22.4, taken: 16, hand: 16, margin: -9.6 });
        expect(bound).toMatchObject({ source_leftover_margin: -9.6, sink_stock_margin_crafts: 2.927 });
    });

    it("counts an inserter of the loop that is always on over the whole window cycle, with no gap at its sink", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250);
        const bound = loopStockBound(config, { "inserter:9": every(480, 5, 15, 24), "inserter:10": every(480, 5, 15, 24) }, 480)!;
        expect(bound.inserters[0].source_leftover).toEqual([{ start: 0, end: 479, ticks: 480, made: 112, taken: 80, hand: 16, margin: 16 }]);
        expect(bound.inserters[0].sink_stock).toMatchObject({ longest_gap: 0, margin_crafts: 6 });
    });

    // iron bacteria spoil in a minute: the stock at the sink loses its limit over 3,600 ticks
    it("counts spoilage as a loss rate, on a window cycle that is not a whole number of ticks", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_380_CULTIVATION);
        const bound = loopStockBound(config, { "inserter:7": [{ start: 15, end: 23 }, { start: 60, end: 68 }], "inserter:8": [{ start: 15, end: 23 }, { start: 60, end: 68 }] }, 90.95)!;
        expect(bound.inserters.map(it => it.sink_stock)).toEqual([expect.objectContaining({ limit: 28, spoil_per_tick: 0.008, longest_gap: 37 }),
            expect.objectContaining({ limit: 28, spoil_per_tick: 0.008, longest_gap: 37 })]);
        // each window of a taker out of the loop is counted once over the window cycle: the windows take what it takes always on
        const always_on = loopStockBound(config, {}, 90.95)!;
        const taken = (it: typeof bound) => it.inserters[0].source_leftover.reduce((sum, window) => sum + window.taken, 0);
        expect(taken(bound)).toBeCloseTo(taken(always_on), 2);
    });

    it("is null for a build with no loop of machines", async () => {
        expect(loopStockBound(await loadConfigFromFile(ConfigPaths.ACCUMULATOR_640), {}, 480)).toBeNull();
    });
});
