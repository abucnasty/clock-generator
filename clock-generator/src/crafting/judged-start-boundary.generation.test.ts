import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import type { StockDetail } from "./machine-stock";
import { buildAsBuiltConfig, runAsBuiltCheck } from "./trial";
import { runBuild } from "./plan/unclocked-run";

const window_cycle_ticks = 324;
const target_ids = ["inserter:1", "inserter:4", "inserter:11", "inserter:13", "inserter:18", "inserter:19"];
const recorded_start = 3564;

let config: Config;
beforeAll(async () => {
    const fixture = await loadConfigFromFile(path.join(__dirname, "fixtures", "utility-science-320-metered-takers.json"));
    config = { ...fixture, overrides: { ...fixture.overrides, terminal_swing_count: 6, lcm: 1, derive_clock_windows: false } };
});

function windowsOf(offset: number): Map<string, OpenRange[]> {
    const starts = new Map([[5, 0], [6, 36], [9, 72], [14, offset], [16, offset + 36], [17, offset + 72]]);
    return new Map(config.inserters.map(({ id }, index) => {
        const inserter_id = id ?? index + 1;
        const start = starts.get(inserter_id);
        const windows = start === undefined ? [OpenRange.from(0, window_cycle_ticks - 1)]
            : [start, start + 108, start + 216].map(tick => OpenRange.from(tick, tick + 3));
        return [`inserter:${inserter_id}`, windows];
    }));
}

test.each([3, 5, 6, 7, 18])("counts an entire recorded repeat at taker offset %i", offset => {
    const windows = windowsOf(offset);
    const counters = new Map<number, number[]>();
    const physical = runBuild(buildAsBuiltConfig(config, windows, window_cycle_ticks), {
        logger: quiet, cold_start: true, output_belt: true, window_cycle_ticks,
        simulate_window_cycles: 32, factorio_states: false, detect_repeat: true, record_histories: false,
        on_context(context) {
            const by_id = new Map(context.inserters.map(inserter => [inserter.entity_id.id, inserter.inserter_state]));
            context.after_inserters.push({ tick() {
                const tick = context.tick_provider.getCurrentTick();
                if (tick < recorded_start || (tick !== recorded_start + 1 && (tick - recorded_start) % window_cycle_ticks !== 0)) return;
                counters.set(tick, target_ids.map(id => by_id.get(id)!.items_dropped));
            } });
        },
    });
    expect([...physical.output_inserter_ids].sort()).toEqual([...target_ids].sort());
    expect(physical.state_repeat).toEqual({ bin_ticks: window_cycle_ticks, window_cycles_per_bin: 1, from_bin: 0, cycle_bins: 16 });
    expect(physical.recorded_duration.ticks).toBe(16 * window_cycle_ticks);
    const dropBetween = (from: number, to: number) => counters.get(to)!.map((count, index) => count - counters.get(from)![index]);
    expect(dropBetween(recorded_start, recorded_start + 1)).toEqual(offset === 18 ? [0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 4]);
    const bins = Array.from({ length: 16 }, (_, index) => {
        const start = recorded_start + index * window_cycle_ticks;
        return dropBetween(start, start + window_cycle_ticks).reduce((sum, quantity) => sum + quantity, 0);
    });
    expect(bins).toEqual(Array(16).fill(576));

    const checkStock = (detail: StockDetail) => {
        const seen: string[] = [];
        const logger = { ...quiet, log: (line: string) => { seen.push(line); } };
        const run = runAsBuiltCheck(config, windows, window_cycle_ticks, logger, 1, undefined, undefined, undefined, false, detail, {}, "long-run");
        expect(run.result.stability_check).toMatchObject({ holds: true, actual_output_items: 576, expected_output_items: 576 });
        expect(run.check.first_check_failed).toBeUndefined();
        const total = bins.reduce((sum, quantity) => sum + quantity, 0);
        expect(run.check, seen.find(line => line.startsWith("Free running build over "))).toMatchObject({
            holds: true, actual_output_items: total / bins.length,
        });
        if (detail === "loop-windows") {
            expect(run.check).toMatchObject({ long_run_proven: true, first_judged_tick: 0, long_run_cycle_window_cycles: bins.length });
            expect(run.stock?.ticks).toBe(physical.recorded_duration.ticks);
        } else {
            expect(run.stock).toBeUndefined();
        }
    };
    checkStock("loop-windows");
    if (offset === 3) checkStock("hands");
});

test("counts the first recorded drop in a sample of two window cycles", () => {
    const seen: string[] = [];
    const logger = { ...quiet, log: (line: string) => { seen.push(line); } };
    const run = runAsBuiltCheck(config, windowsOf(3), window_cycle_ticks, logger, 1, undefined, 2 * window_cycle_ticks,
        undefined, false, "loop-windows", {}, "long-run");
    expect(run.result.stability_check).toMatchObject({ holds: true, actual_output_items: 576, expected_output_items: 576 });
    expect(run.check, seen.filter(line => line.startsWith("Free running build")).join("\n")).toMatchObject({
        holds: true, actual_output_items: 576, long_run_proven: false,
    });
    expect(Math.abs(run.check.first_judged_tick ?? NaN)).toBe(0);
    expect(run.stock?.ticks).toBe(2 * window_cycle_ticks);
});
