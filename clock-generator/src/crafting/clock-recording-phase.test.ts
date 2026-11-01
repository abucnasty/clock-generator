import { expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { generateClockForConfig } from "./generate-clock";
import { rotateRanges } from "./clock";
import { runBuild } from "./plan/plan-run";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { unplannedInserterClocks } from "./sequence/unplanned-inserter-clock";
import { buildAsBuiltConfig } from "./trial";

const logger = { log() {}, warn() {}, error() {}, debug() {} };

it("a recording boundary preserves live hands, fuel and independent game-clock phases", async () => {
    const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
    const period = 128, warmup = 10;
    const generated = generateClockForConfig(config, { logger, belt_pickup_slack: "always" });
    const clocks = unplannedInserterClocks(createEntityRegistryFromConfig(config), period);
    for (const [id, serialized] of Object.entries(generated.unplanned_inserter_clocks ?? {})) {
        const clock = clocks.get(id)!;
        clocks.set(id, { ...clock, modulus: serialized.modulus,
            window: OpenRange.from(serialized.window.start, serialized.window.end) });
    }
    expect([...clocks.values()].some(clock => clock.own_clock && period * warmup % clock.modulus !== 0)).toBe(true);
    const windows = new Map(Object.entries(generated.clock_windows)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    // One real shared-counter start; its fuel phase differs from its main128 phase.
    const raw_shift = 510;
    const built = buildAsBuiltConfig(config, windows, period, clocks, "built", raw_shift);
    for (const inserter of built.inserters) {
        const clock = clocks.get(`inserter:${inserter.id}`);
        const control = inserter.overrides?.enable_control;
        if (clock?.own_clock && control?.mode === "CLOCKED") {
            control.ranges = rotateRanges([clock.window], raw_shift, clock.modulus)
                .map(range => ({ start: range.start_inclusive, end: range.end_inclusive }));
        }
    }
    const options = { logger, cold_start: true, period_ticks: period, machine_stock: true, factorio_states: false };
    const continuous = runBuild(built, { ...options, warmup_periods: 0, simulate_periods: warmup + 1 }).machine_stock!;
    const segmented = runBuild(built, { ...options, warmup_periods: warmup });
    expect(segmented.clock_tick_at_start).toBe(warmup * period);
    const recorded = segmented.machine_stock!;
    const tail = (value: unknown): unknown => Array.isArray(value) ? value.slice(warmup * period)
        : value !== null && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, tail(nested)])) : value;
    expect(recorded.machines).toEqual(continuous.machines.map(tail));
    expect(recorded.inserters).toEqual(continuous.inserters.map(tail));
});
