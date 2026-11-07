import { expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import { AS_BUILT_START_PHASES, completedAsBuiltCheck, FREE_RUNNING_CHECK_TICKS, runAsBuiltCheck } from "./trial";

// Clocks the per-branch clock composed on the processing unit sample (24 ticks; inserter: windows "start-end"), whose takers of one
// product compete: one that holds from every start, two that hold up to their long run and fail at a start phase
const CLOCKS: [string, Record<string, string>][] = [
    ["holds from every start", { "16": "0-0", "17": "0-0", "23": "0-0", "24": "0-0", "5": "5-5 13-13 21-21", "6": "6-6 14-14 22-22", "13": "5-5 13-13 21-21", "14": "5-5 13-13 21-21", "15": "5-5 13-13 21-21", "18": "6-6 14-14 22-22", "19": "6-6 14-14 22-22", "20": "6-6 14-14 22-22", "2": "20-23 0-5", "3": "4-4 12-12 20-20", "4": "4-4 12-12 20-20", "7": "4-4 12-12 20-20", "8": "4-4 12-12 20-20", "9": "20-23 0-5", "1": "21-23 0-13", "11": "21-23 0-6", "12": "21-23 0-6", "10": "21-23 0-13", "21": "21-23 0-6", "22": "21-23 0-6" }],
    ["fails at the start phase of tick 10", { "16": "0-0", "17": "0-0", "23": "0-0", "24": "0-0", "5": "4-4 12-12 20-20", "6": "4-4 12-12 20-20", "13": "4-4 12-12 20-20", "14": "4-4 12-12 20-20", "15": "4-4 12-12 20-20", "18": "4-4 12-12 20-20", "19": "4-4 12-12 20-20", "20": "4-4 12-12 20-20", "2": "20-23 0-13", "3": "4-4 12-12 20-20", "4": "4-4 12-12 20-20", "7": "4-4 12-12 20-20", "8": "4-4 12-12 20-20", "9": "20-23 0-13", "1": "12-23 0-5", "11": "12-23 0-5", "12": "12-23 0-5", "10": "12-23 0-5", "21": "12-23 0-5", "22": "12-23 0-5" }],
    ["fails at the start phase of tick 2", { "23": "0-0", "24": "0-0", "12": "12-21", "16": "0-0", "17": "0-0", "21": "12-21", "5": "5-5 13-13 21-21", "6": "6-6 14-14 22-22", "2": "20-23 0-5", "9": "4-13", "11": "12-21", "13": "4-4 12-12 20-20", "14": "4-4 12-12 20-20", "15": "4-4 12-12 20-20", "18": "4-4 12-12 20-20", "19": "4-4 12-12 20-20", "20": "4-4 12-12 20-20", "22": "12-21", "1": "12-23 0-4", "10": "12-23 0-4" }],
];

const windowsOf = (clock: Record<string, string>) => new Map(Object.entries(clock).map(([id, ranges]) => [`inserter:${id}`,
    ranges.split(" ").map(range => { const [start, end] = range.split("-").map(Number); return OpenRange.from(start, end); })]));

it.each(CLOCKS)("a clock-only check stopped after its long run and finished gives the check run through: %s", async (_, clock) => {
    const loaded = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
    const config = { ...loaded, overrides: { ...loaded.overrides, derive_clock_windows: false, terminal_swing_count: 1, lcm: 1 } };
    const windows = windowsOf(clock);
    const through = runAsBuiltCheck(config, windows, 24, quiet);
    const to_long_run = runAsBuiltCheck(config, windows, 24, quiet, AS_BUILT_START_PHASES, undefined, FREE_RUNNING_CHECK_TICKS, undefined, false,
        "loop-windows", {}, "long-run");
    // up to the long run it holds, with its wakeups counted and no start phase or other taker order run
    expect(to_long_run.check).toMatchObject({ holds: true, start_phases_checked: 1 });
    expect(to_long_run.check.taker_orders_checked).toBeUndefined();
    expect(to_long_run.check.wake_ups).toEqual(through.check.wake_ups);
    const finished = completedAsBuiltCheck(config, windows, 24, quiet, to_long_run);
    expect(finished.check).toEqual(through.check);
    expect(finished.check.taker_orders_checked).toBeGreaterThan(1);
    // the check it finished is left as it was
    expect(to_long_run.check.start_phases_checked).toBe(1);
}, 120_000);

it("a clock-only check that fails before its long run is the same stopped there or run through", async () => {
    const loaded = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
    const config = { ...loaded, overrides: { ...loaded.overrides, derive_clock_windows: false, terminal_swing_count: 1, lcm: 1 } };
    const windows = windowsOf({ ...CLOCKS[0][1], "2": "0-0", "9": "0-0" });
    const through = runAsBuiltCheck(config, windows, 24, quiet);
    const to_long_run = runAsBuiltCheck(config, windows, 24, quiet, AS_BUILT_START_PHASES, undefined, FREE_RUNNING_CHECK_TICKS, undefined, false,
        "loop-windows", {}, "long-run");
    expect(through.check).toMatchObject({ holds: false, failed_start_offset: 0 });
    expect(to_long_run.check).toEqual(through.check);
    expect(completedAsBuiltCheck(config, windows, 24, quiet, to_long_run)).toBe(to_long_run);
}, 120_000);
