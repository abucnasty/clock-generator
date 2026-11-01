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
    lcm: number; terminal_swing_count: number; period: number;
    physical_repeat: { period_ticks: number; scale: number };
    clock_windows: Record<string, { start: number; end: number }[]>;
};

it("rejects one missing hand even when its size is below the scaled per-period tolerance", () => {
    // The existing iron-bacteria fractional-clock shape:19logical periods,576items each, one16item hand lost.
    const repeat = { period_ticks: 1728, scale: 19 };
    expect(judgeCounterSpan(19 * 576, 576, repeat, 1)).toMatchObject({ holds: true, output_items_per_period: 576 });
    const missing = judgeCounterSpan(19 * 576 - 16, 576, repeat, 1);
    expect(16).toBeLessThan(repeat.scale);
    expect(missing.holds).toBe(false);
    expect(missing.output_items_per_period).toBeLessThan(576);
});

it("judges the unchanged fractional export on complete physical counter spans", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm,
        terminal_swing_count: controls.terminal_swing_count } };
    const result = trial.clockFromWindows(config, controls.clock_windows, controls.period, logger);
    const identity = createHash("sha256").update(JSON.stringify(clockIdentity(result.subtick ?? result))).digest("hex");
    expect(identity).toBe(controls.provenance.clock_sha256);
    expect(result.subtick?.clock).toEqual(controls.physical_repeat);
    expect(result.stability_check.as_built?.holds).toBe(true);
    expect(result.clock_only_run?.observation_span).toEqual({ ticks: 640, periods: 3, output_items: 480 });
    expect(result.stability_check.as_built?.start_phases_checked).toBe(640);
    expect(result.stability_check.as_built?.actual_output_items).toBe(160);
    expect(result.stability_check.as_built?.long_run_proven).toBe(true);
});

it("checks every physical counter start and reports the bounded proof limit honestly", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm,
        terminal_swing_count: controls.terminal_swing_count } };
    const windows = new Map(Object.entries(controls.clock_windows)
        .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const proof = trial.exhaustiveStartPhases(config, windows, controls.period, logger);
    expect(proof).toMatchObject({ holds: true, phases_checked: 640 });
    // Some exact state keys do not repeat before the existing cap; those full640tick observations remain samples.
    expect(proof!.proven).toBe(proof!.unresolved_phases === 0);
});

it("still rejects output missing over a complete physical counter span", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm,
        terminal_swing_count: controls.terminal_swing_count } };
    const windows = { ...controls.clock_windows, "inserter:3": controls.clock_windows["inserter:3"].slice(0, 2) };
    const result = trial.clockFromWindows(config, windows, controls.period, logger);
    expect(result.stability_check.as_built?.holds).toBe(false);
    expect(result.stability_check.as_built?.actual_output_items).toBeLessThan(160);
});
