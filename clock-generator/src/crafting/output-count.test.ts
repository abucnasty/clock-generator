import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { generateClockForConfig } from "./generate-blueprint";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };

/**
 * The stone bricks furnace with its drill and output inserter on fixed clock windows: 3 hands of 16 bricks every 72
 * ticks, with the output window starting at `output_window_start`.
 */
const runAsBuilt = async (output_window_start: number) => {
    const config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT_2_1);
    const period = 72;
    const window = (start: number, end: number) => end < period
        ? [{ start, end }]
        : [{ start, end: period - 1 }, { start: 0, end: end - period }];
    const clocked: Config = {
        ...config,
        inserters: config.inserters.map(inserter => ({
            ...inserter,
            overrides: { enable_control: { mode: "CLOCKED" as const, ranges: window(output_window_start, output_window_start + 33), period_duration_ticks: period } },
        })),
        drills: {
            ...config.drills!,
            configs: config.drills!.configs.map(drill => ({
                ...drill,
                overrides: { enable_control: { mode: "CLOCKED" as const, ranges: [{ start: 1, end: 5 }], period_duration_ticks: period } },
            })),
        },
    };
    return generateClockForConfig(clocked, { logger: quiet, verify_as_built: false, fuel_consumption_view: false, modulo_blueprint: false, belt_pickup_slack: "never" });
};

describe("the output counted in the recorded run", () => {
    // The third hand of a window that starts at tick 38 is dropped at about tick 67 of the 72 tick clock, and the
    // inserter is back after the run ends at the same point two clocks on. Its transfer is recorded when the inserter is back, so the transfers of the run hold 2
    // hands, but all 3 were dropped in it.
    it.each([2, 20, 38, 50, 62])("is what the output inserter drops, wherever in the period its window starts (tick %i)", async (start) => {
        const result = await runAsBuilt(start);
        // the run that is recorded is the planned 144 ticks: two of the 72 tick clocks
        expect(result.simulation_duration.ticks).toBe(144);
        expect(result.stability_check.expected_output_items).toBe(96);
        expect(result.stability_check.actual_output_items).toBe(96);
        expect(result.stability_check.is_stable).toBe(true);
    });
});
