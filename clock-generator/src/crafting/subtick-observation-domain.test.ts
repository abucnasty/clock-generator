import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { clockIdentity } from "./clock-identity";
import { judgeCounterSpan } from "./long-run";
import * as trial from "./trial";

const logger = { log() {}, warn() {}, error() {}, debug() {} };
const controls = JSON.parse(readFileSync(path.join(__dirname, "fixtures/metallurgic-subtick-controls.json"), "utf8")) as {
    provenance: { clock_sha256: string };
    lcm: number; terminal_swing_count: number; window_cycle_ticks: number;
    physical_repeat: { window_cycle_ticks: number; scale: number };
    clock_windows: Record<string, { start: number; end: number }[]>;
};

it("rejects one missing hand even when its size is below the scaled per-period tolerance", () => {
    // The existing iron-bacteria fractional-clock shape:19logical window cycles,576items each, one16item hand lost.
    const repeat = { window_cycle_ticks: 1728, scale: 19 };
    expect(judgeCounterSpan(19 * 576, 576, repeat, 1)).toMatchObject({ holds: true, output_items_per_window_cycle: 576 });
    const missing = judgeCounterSpan(19 * 576 - 16, 576, repeat, 1);
    expect(16).toBeLessThan(repeat.scale);
    expect(missing.holds).toBe(false);
    expect(missing.output_items_per_window_cycle).toBeLessThan(576);
});

it("judges the unchanged fractional export on complete physical counter spans", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm,
        terminal_swing_count: controls.terminal_swing_count } };
    const result = trial.clockFromWindows(config, controls.clock_windows, controls.window_cycle_ticks, logger);
    const identity = createHash("sha256").update(JSON.stringify(clockIdentity(result.subtick ?? result))).digest("hex");
    expect(identity).toBe(controls.provenance.clock_sha256);
    expect(result.subtick?.clock).toEqual(controls.physical_repeat);
    expect(result.stability_check.as_built?.holds).toBe(true);
    expect(result.clock_only_run?.observation_span).toEqual({ ticks: 640, window_cycles: 3, output_items: 480 });
    // the 12 sampled starts of `startShiftsOf`; exhaustiveStartPhases checks all 640 (below)
    expect(result.stability_check.as_built?.start_phases_checked).toBe(12);
    expect(result.stability_check.as_built?.actual_output_items).toBe(160);
    expect(result.stability_check.as_built?.long_run_proven).toBe(true);
});

// All 640 starts run, 422 of them to the proof cap: about 25 s on a desktop and over 60 s on a GitHub runner. No smaller
// metallurgic clock (lcm 1-4, 1-4 swings) holds from its first start, so none can stand in for it.
it("checks every physical counter start and reports the bounded proof limit honestly", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm,
        terminal_swing_count: controls.terminal_swing_count } };
    const windows = new Map(Object.entries(controls.clock_windows)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const proof = trial.exhaustiveStartPhases(config, windows, controls.window_cycle_ticks, logger);
    expect(proof).toMatchObject({ holds: true, phases_checked: 640 });
    // Some exact state keys do not repeat before the existing cap; those full640tick observations remain samples.
    expect(proof!.proven).toBe(proof!.unresolved_phases === 0);
}, 180_000);

it("still rejects output missing over a complete physical counter span", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm,
        terminal_swing_count: controls.terminal_swing_count } };
    const windows = { ...controls.clock_windows, "inserter:3": controls.clock_windows["inserter:3"].slice(0, 2) };
    const result = trial.clockFromWindows(config, windows, controls.window_cycle_ticks, logger);
    expect(result.stability_check.as_built?.holds).toBe(false);
    expect(result.stability_check.as_built?.actual_output_items).toBeLessThan(160);
});

it("observes a counter from where the warm-up left its clocks, not from a counter restarted at the recording", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm,
        terminal_swing_count: controls.terminal_swing_count } };
    const windows = new Map(Object.entries(controls.clock_windows)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    // the warm-up of 10 window cycles of 640/3 ticks leaves the counter 213 1/3 ticks in; restarted at 0 for the recording,
    // the clock jumps under a build the warm-up left elsewhere, and from the start 27 ticks in that costs a hand
    const counter = (counter_runs_through: boolean) => trial.runClockOnBuild(config, windows, controls.window_cycle_ticks, logger, {
        main_clock_shift: 27, simulate_window_cycles: 3, observation_ticks: 640, counter_runs_through, factorio_states: false,
    }).stability_check.actual_output_items;
    expect(counter(true)).toBe(480);
    expect(counter(false)).toBe(464);
});

it("samples a counter's starts at the old whole-tick positions, each at another sub-tick fraction", () => {
    // no whole counter: 11 shifts 13 ticks apart, as ever
    expect(trial.startShiftsOf(160, null, 12)).toEqual([13, 26, 39, 52, 65, 78, 91, 104, 117, 130, 143]);
    // 640/3 ticks: 17 ticks apart, the thirds spread over them, every one of the 3 fractions met
    const shifts = trial.startShiftsOf(640 / 3, { window_cycle_ticks: 640, scale: 3 }, 12);
    expect(shifts.map(shift => Math.round(shift * 3))).toEqual([51, 102, 153, 205, 256, 307, 358, 410, 461, 512, 563]);
    expect(new Set(shifts.map(shift => Math.round(shift * 3) % 3))).toEqual(new Set([0, 1, 2]));
    expect(shifts.every(shift => shift < 640 / 3)).toBe(true);
    // 12672/23 ticks (550 21/23): 45 ticks apart, 11 of the 23 fractions
    const adv = trial.startShiftsOf(12_672 / 23, { window_cycle_ticks: 12_672, scale: 23 }, 12);
    expect(adv).toHaveLength(11);
    expect(new Set(adv.map(shift => Math.round(shift * 23) % 23)).size).toBe(11);
    expect(adv.map(Math.floor)).toEqual([45, 90, 135, 180, 225, 270, 315, 360, 405, 450, 495]);
});
