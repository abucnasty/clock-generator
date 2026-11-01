import {expect, it} from "vitest";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {OpenRange} from "../data-types";
import {quiet} from "./generate-blueprint-test-helpers";
import {recordSimulationTimeline} from "./record-timeline";
import {FREE_RUNNING_CHECK_TICKS, runAsBuiltCheck} from "./trial";

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
    expect(run.check.clock_tick_at_first_judged).toBe(1200);
    const reused = runAsBuiltCheck(config, ranges, 24, quiet, undefined, undefined, FREE_RUNNING_CHECK_TICKS,
        {run, long_run_ticks: FREE_RUNNING_CHECK_TICKS});
    expect(reused.check.clock_tick_at_first_judged).toBe(1200);
    const request = {config, mode: "clock" as const, period_ticks: 24, terminal_swing_count: 1, windows};
    const judged = recordSimulationTimeline({...request, settle_ticks: run.check.clock_tick_at_first_judged});
    expect(judged.ticks_before_recording).toBe(1200);
    // Match every hand throughout the period with the stock the long run actually judged.
    for (const hand of run.stock!.inserters) {
        const signal = judged.entities.find(entity => entity.id === hand.inserter_id)!.signals.find(signal => signal.id === "hand")!;
        const values = Array.from({length: 25}, (_, tick) => {
            let index = 0;
            while (index + 1 < signal.ticks.length && signal.ticks[index + 1] <= tick) index++;
            return signal.values[index];
        });
        const from = run.check.first_judged_tick! - 1;
        expect(values, hand.inserter_id).toEqual(hand.held.slice(from, from + 25));
    }
    expect(recordSimulationTimeline({...request, settle_ticks: 1201}).ticks_before_recording).toBe(1201);
});
