import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { ACTIVATION_ORDER, InserterDispatch } from "../simulation/dispatch";
import { generateClockForConfig } from "./generate-clock";
import { rotateRanges } from "./clock";
import { BuildRun, RunOptions, runBuild } from "./plan/plan-run";
import { SimulationContext, createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { unplannedInserterClocks } from "./sequence/unplanned-inserter-clock";
import { buildAsBuiltConfig } from "./trial";

const logger = { log() {}, warn() {}, error() {}, debug() {} };

/** What `make` returns with every context it makes under `dispatch` */
function underDispatch<T>(dispatch: InserterDispatch, make: () => T): T {
    const fromConfig = SimulationContext.fromConfig.bind(SimulationContext);
    const spy = vi.spyOn(SimulationContext, "fromConfig").mockImplementation(config => {
        const context = fromConfig(config);
        context.inserter_dispatch = dispatch;
        return context;
    });
    try {
        return make();
    } finally {
        spy.mockRestore();
    }
}

const period = 128, warmup = 10;

/**
 * Gleba rocket fuel's exported clock as built, its counter started at a real shared-counter start (raw shift 510), with
 * fuel clocks of their own whose modulus does not divide the warm-up: their phase at the recording's start is not the
 * main clock's.
 */
async function shiftedRocketFuel(): Promise<Config> {
    const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
    const generated = underDispatch("configured-order", () => generateClockForConfig(config, { logger, belt_pickup_slack: "always" }));
    const clocks = unplannedInserterClocks(createEntityRegistryFromConfig(config), period);
    for (const [id, serialized] of Object.entries(generated.unplanned_inserter_clocks ?? {})) {
        const clock = clocks.get(id)!;
        clocks.set(id, { ...clock, modulus: serialized.modulus,
            window: OpenRange.from(serialized.window.start, serialized.window.end) });
    }
    expect([...clocks.values()].some(clock => clock.own_clock && period * warmup % clock.modulus !== 0)).toBe(true);
    const windows = new Map(Object.entries(generated.clock_windows)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
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
    return built;
}

/** The build recorded after a warm-up of `warmup` periods, and the same ticks of one run from the cold start */
function segmentedAndContinuous(built: Config, dispatch: InserterDispatch) {
    const options: RunOptions = { logger, cold_start: true, period_ticks: period, machine_stock: true, factorio_states: false };
    return underDispatch(dispatch, () => {
        const continuous = runBuild(built, { ...options, warmup_periods: 0, simulate_periods: warmup + 1 }).machine_stock!;
        const segmented: BuildRun = runBuild(built, { ...options, warmup_periods: warmup });
        const tail = (value: unknown): unknown => Array.isArray(value) ? value.slice(warmup * period)
            : value !== null && typeof value === "object"
                ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, tail(nested)])) : value;
        return {
            segmented,
            recorded: segmented.machine_stock!,
            continuous: { machines: continuous.machines.map(tail), inserters: continuous.inserters.map(tail) },
        };
    });
}

describe("the clocks of the game at the start of the recorded run", () => {
    it("run on through the warm-up under the new dispatch: the recording is the tail of one uninterrupted run", async () => {
        const { segmented, recorded, continuous } = segmentedAndContinuous(await shiftedRocketFuel(), ACTIVATION_ORDER);
        expect(segmented.clock_tick_at_start).toBe(warmup * period);
        expect(recorded.machines).toEqual(continuous.machines);
        expect(recorded.inserters).toEqual(continuous.inserters);
    });

    it("start again with the recorded run under the configured order, as before", async () => {
        const { segmented, recorded, continuous } = segmentedAndContinuous(await shiftedRocketFuel(), "configured-order");
        expect(segmented.clock_tick_at_start).toBeUndefined();
        expect(recorded.machines).not.toEqual(continuous.machines);
        expect(recorded.inserters).not.toEqual(continuous.inserters);
    });
});
