import { describe, expect, it } from "vitest";
import type { Config } from "../config";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { generateClockForConfig } from "./generate-clock";
import { rotateRanges } from "./clock";
import { BuildRun, RunOptions, runBuild } from "./plan/unclocked-run";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { unplannedInserterClocks } from "./sequence/unplanned-inserter-clock";
import { runThroughTicks } from "./sequence/interceptors/inserter-enable-control-factory";
import { TickProvider } from "../simulation/current-tick-provider";
import { buildAsBuiltConfig } from "./trial";

const logger = { log() {}, warn() {}, error() {}, debug() {} };

const window_cycle_ticks = 128, warmup = 10;

/**
 * Gleba rocket fuel's exported clock as built, its counter started at a real shared-counter start (raw shift 510), with
 * fuel clocks of their own whose modulus does not divide the warm-up: their phase at the recording's start is not the
 * main clock's.
 */
async function shiftedRocketFuel(): Promise<Config> {
    const config = await loadConfigFromFile(ConfigPaths.ROCKET_FUEL_60);
    const generated = generateClockForConfig(config, { logger });
    const clocks = unplannedInserterClocks(createEntityRegistryFromConfig(config), window_cycle_ticks);
    for (const [id, serialized] of Object.entries(generated.unplanned_inserter_clocks ?? {})) {
        const clock = clocks.get(id)!;
        clocks.set(id, { ...clock, modulus: serialized.modulus,
            window: OpenRange.from(serialized.window.start, serialized.window.end) });
    }
    expect([...clocks.values()].some(clock => clock.own_clock && window_cycle_ticks * warmup % clock.modulus !== 0)).toBe(true);
    const windows = new Map(Object.entries(generated.clock_windows)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const raw_shift = 510;
    const built = buildAsBuiltConfig(config, windows, window_cycle_ticks, clocks, "built", raw_shift);
    for (const inserter of built.inserters) {
        const clock = clocks.get(`inserter:${inserter.id}`);
        const control = inserter.overrides?.enable_control;
        if (clock?.own_clock && control?.mode === "CLOCKED") {
            control.ranges = rotateRanges([clock.window], raw_shift, clock.modulus)
                .map(range => ({ start: range.start_inclusive, end: range.end_inclusive }));
        }
    }
    return built;
}

/** The build recorded after a warm-up of `warmup` window cycles, and the same ticks of one run from the cold start */
function segmentedAndContinuous(built: Config) {
    const options: RunOptions = { logger, cold_start: true, window_cycle_ticks, machine_stock: true, factorio_states: false };
    const continuous = runBuild(built, { ...options, warmup_window_cycles: 0, simulate_window_cycles: warmup + 1 }).machine_stock!;
    const segmented: BuildRun = runBuild(built, { ...options, warmup_window_cycles: warmup });
    const tail = (value: unknown): unknown => Array.isArray(value) ? value.slice(warmup * window_cycle_ticks)
        : value !== null && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, tail(nested)])) : value;
    return {
        segmented,
        recorded: segmented.machine_stock!,
        continuous: { machines: continuous.machines.map(tail), inserters: continuous.inserters.map(tail) },
    };
}

describe("the clocks of the game at the start of the recorded run", () => {
    it("run on through the warm-up: the recording is the tail of one uninterrupted run", async () => {
        const { segmented, recorded, continuous } = segmentedAndContinuous(await shiftedRocketFuel());
        expect(segmented.clock_tick_at_start).toBe(warmup * window_cycle_ticks);
        expect(recorded.machines).toEqual(continuous.machines);
        expect(recorded.inserters).toEqual(continuous.inserters);
    });
});

describe("the clocks of the game that run through", () => {
    it("are those of a whole-tick period; a p/q clock starts again with the recorded run until it is judged over whole counters", () => {
        const ticks = TickProvider.mutable(0);
        expect(runThroughTicks(ticks, 128)).toBe(ticks);
        // 10 window cycles of 12672/23 ticks run 5510 ticks: the recording would start 10/23 of a tick into a window cycle
        expect(runThroughTicks(ticks, 12672 / 23)).toBeUndefined();
        expect(runThroughTicks(undefined, 128)).toBeUndefined();
    });
});
