import {readFileSync} from "node:fs";
import path from "node:path";
import {expect, it, vi} from "vitest";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {OpenRange} from "../data-types";
import {clockFromWindows, type SerializableClockWindows} from "./generate-blueprint";
import {quiet} from "./generate-blueprint-test-helpers";
import {recordSimulationTimeline, type RecordTimelineRequest} from "./record-timeline";
import type {StockRecording} from "./machine-stock";
import {FREE_RUNNING_CHECK_TICKS, runAsBuiltCheck} from "./trial";

/** How many inserters' hands in the replay's first `ticks` ticks differ from what the long run held from its first judged tick */
function handsDifferingFromStock(replay: ReturnType<typeof recordSimulationTimeline>, stock: StockRecording, first_judged_tick: number, ticks: number): number {
    return stock.inserters.filter(hand => {
        const signal = replay.entities.find(entity => entity.id === hand.inserter_id)!.signals.find(signal => signal.id === "hand")!;
        const values = Array.from({length: ticks}, (_, tick) => {
            let index = 0;
            while (index + 1 < signal.ticks.length && signal.ticks[index + 1] <= tick) index++;
            return signal.values[index];
        });
        return JSON.stringify(values) !== JSON.stringify(hand.held.slice(first_judged_tick - 1, first_judged_tick - 1 + ticks));
    }).length;
}

it("replays the judged clock state after the measured warm-up, keeping stock indices relative", async () => {
    const loaded = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
    const config = {...loaded, overrides: {...loaded.overrides, terminal_swing_count: 1, lcm: 1}};
    // Explicit native-pinned 24-tick plan, independent of candidate generation/ranking.
    const windows = Object.fromEntries([
        [16, 0, 0], [17, 0, 0], [23, 0, 0], [24, 0, 0], [2, 4, 13], [9, 4, 13],
        [1, 5, 21], [11, 5, 14], [12, 5, 14], [10, 5, 21], [21, 5, 14], [22, 5, 14],
    ].map(([id, start, end]) => [`inserter:${id}`, [{start, end}]]));
    const ranges = new Map(Object.entries(windows).map(([id, rs]) =>
        [id, rs.map(r => OpenRange.from(r.start, r.end))]));
    const run = runAsBuiltCheck(config, ranges, 24, quiet);
    expect(run.check).toMatchObject({holds: true, actual_output_items: 32, first_judged_tick: 960});
    // the long run's warm-up of 10 periods (240 ticks) comes before its stock's first index
    expect(run.check.clock_tick_at_first_judged).toBe(1200);
    const reused = runAsBuiltCheck(config, ranges, 24, quiet, undefined, undefined, FREE_RUNNING_CHECK_TICKS,
        {run, long_run_ticks: FREE_RUNNING_CHECK_TICKS});
    expect(reused.check.clock_tick_at_first_judged).toBe(1200);
    const request = {config, mode: "clock" as const, period_ticks: 24, terminal_swing_count: 1, windows};
    const judged = recordSimulationTimeline({...request, settle_ticks: run.check.clock_tick_at_first_judged});
    expect(judged.ticks_before_recording).toBe(1200);
    // Match every hand throughout the period with the stock the long run actually judged.
    expect(handsDifferingFromStock(judged, run.stock!, run.check.first_judged_tick!, 25)).toBe(0);
    // the replay of whole periods up to the stock's first judged index (a request without the clock tick) starts 240 ticks early
    const by_periods = recordSimulationTimeline({...request, settle_periods: run.check.first_judged_tick! / 24});
    expect(by_periods.ticks_before_recording).toBe(960);
    expect(handsDifferingFromStock(by_periods, run.stock!, run.check.first_judged_tick!, 25)).toBeGreaterThan(0);
    expect(recordSimulationTimeline({...request, settle_ticks: 1201}).ticks_before_recording).toBe(1201);
});

// A clock of p/q ticks starts again with the recorded run (#568), in the long run and in a replay alike: no one tick from
// the cold start stands for the state the long run judged, so the check names none, and a replay asks for whole periods.
it("names no judged clock tick for a clock of p/q ticks, whose replay by whole periods shows the judged state", async () => {
    const controls = JSON.parse(readFileSync(path.join(__dirname, "fixtures/metallurgic-subtick-controls.json"), "utf8")) as {
        lcm: number; terminal_swing_count: number; period: number; clock_windows: Record<string, {start: number; end: number}[]>;
    };
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
    const config = {...sample, overrides: {...sample.overrides, lcm: controls.lcm, terminal_swing_count: controls.terminal_swing_count}};
    const windows = new Map(Object.entries(controls.clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const run = runAsBuiltCheck(config, windows, controls.period, quiet);
    expect(run.check).toMatchObject({holds: true, first_judged_tick: 3200, long_run_proven: true});
    expect(run.check).not.toHaveProperty("clock_tick_at_first_judged");
    const request: RecordTimelineRequest = {config, mode: "clock", period_ticks: controls.period,
        terminal_swing_count: controls.terminal_swing_count, windows: controls.clock_windows};
    const by_periods = recordSimulationTimeline({...request, settle_periods: Math.floor(3200 / controls.period)});
    expect(handsDifferingFromStock(by_periods, run.stock!, 3200, 200)).toBe(0);
    // the tick the warm-up (2134 ticks) and the judged index add up to: the replay's clock does not stand where the long run's did
    expect(handsDifferingFromStock(recordSimulationTimeline({...request, settle_ticks: 2134 + 3200}), run.stock!, 3200, 200)).toBeGreaterThan(0);
});

// One copy of the advanced circuit build of issue 98 under evenly spaced windows (wake-after-output-block.test.ts): the
// check fails from a shifted start, so what its unshifted long run judged names no replay of the failure.
it.each([false, true])("does not replay the successful unshifted recording for a failed phase (exhaustive=%s)", async exhaustive => {
    const PERIOD = 528;
    const windows = (text: string) => text.split(" ").map(range => {
        const [start, end] = range.split("-").map(Number);
        return {start, end};
    });
    const evenly = (first: number, length: number, every: number) =>
        Array.from({length: PERIOD / every}, (_, index) => ({start: first + index * every, end: first + index * every + length - 1}));
    const copper_cable = windows("26-47 74-95 122-143 170-191 218-239 266-287 314-335 362-383 410-431 458-479 506-519 522-527");
    const plastic = windows("29-42 77-82 173-186 221-234 269-282 317-330 365-370 461-474 509-522");
    const evenly_spaced: SerializableClockWindows = {
        "inserter:1": evenly(6, 4, 33), "inserter:8": evenly(6, 4, 33),
        "inserter:3": copper_cable, "inserter:7": copper_cable,
        "inserter:4": plastic, "inserter:6": plastic,
        "inserter:5": evenly(71, 4, 132),
        "inserter:2": evenly(10, 8, 24), "inserter:9": evenly(10, 8, 24),
    };
    const sample = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT);
    const config = {...sample, overrides: {...sample.overrides, terminal_swing_count: 2}};
    vi.stubEnv("CLOCK_PROOF_PHASES", exhaustive ? "1" : "0");
    try {
        const check = clockFromWindows(config, evenly_spaced, PERIOD, quiet).stability_check.as_built!;
        expect(check.holds).toBe(false);
        expect(check.actual_output_items).toBeLessThan(704);
        expect(check.failed_start_offset).toBeGreaterThan(0);
        expect(check.first_judged_tick).toBeUndefined();
        expect(check.clock_tick_at_first_judged).toBeUndefined();
        expect(check.long_run_proven).toBeUndefined();
        expect(check.long_run_cycle_periods).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
});
