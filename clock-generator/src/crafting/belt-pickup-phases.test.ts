import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {Config} from "../config";
import {OpenRange} from "../data-types";
import {runAsBuiltCheck, runClockOnBuild} from "./trial";
import {SerializableClockWindows} from "./clock";

interface NativeControl {
    config: Config;
    period: number;
    terminal_swings: number;
    expected: number;
    baseline: number[];
    recovery: {recovered: number[]}[];
    clock_windows: SerializableClockWindows;
    windows: {phase_units_256: [number[], number[]]}[];
}
const native = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../../tests/game/builds/over-hood-lane-phase-control.json"), "utf8")) as NativeControl;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

function outputWithPhases(window: NativeControl["windows"][number]): number[] {
    const phases = window.phase_units_256.map(values => {
        expect(values).toHaveLength(1);
        return values[0] / 8;
    }) as [number, number];
    const windows = new Map(Object.entries(native.clock_windows).map(([id, ranges]) =>
        [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const run = runClockOnBuild({...native.config, overrides: {...native.config.overrides,
        terminal_swing_count: native.terminal_swings}}, windows, native.period, quiet, {
        cold_start: true, warmup_periods: 10, simulate_periods: 10, machine_stock: true, factorio_states: false,
        moving_pickup_phases: new Map([["inserter:2", phases]]),
    });
    expect(run.machine_stock!.ticks).toBe(native.period * 10);
    const held = run.machine_stock!.inserters.find(inserter => inserter.inserter_id === "inserter:1")!.held;
    const output = new Array<number>(10).fill(0);
    held.forEach((count, tick) => {
        output[Math.floor(tick / native.period)] += Math.max(0, (held[tick - 1] ?? 0) - count);
    });
    return output;
}

test("aligned moving lanes reproduce the native over-the-hood clock baseline", () => {
    expect(outputWithPhases(native.windows[0])).toEqual(native.baseline.slice(0, 10));
});

test("independent moving lanes reproduce the native recovery shortfall", () => {
    const output = outputWithPhases(native.windows[1]);
    // Only lane phase is supplied, not the post-interruption machine inventory or hand state. Compare
    // the steady five-period cycle without claiming the same rotation or the interruption transient.
    const cycle = native.recovery[0].recovered.slice(0, 5).sort((a, b) => a - b);
    expect(cycle.some(count => count < native.expected)).toBe(true);
    expect(output.slice(0, 5).sort((a, b) => a - b)).toEqual(cycle);
    expect(output.slice(5).sort((a, b) => a - b)).toEqual(cycle);
});

test("clock verification rejects the native false-stable clock without a pickup timing penalty", () => {
    const config = {...native.config, overrides: {...native.config.overrides,
        terminal_swing_count: native.terminal_swings}};
    const windows = new Map(Object.entries(native.clock_windows).map(([id, ranges]) =>
        [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const {check} = runAsBuiltCheck(config, windows, native.period, quiet, 1, undefined, 0);
    expect(check.holds).toBe(false);
    expect(check.pickup_phase_starts_checked).toBeGreaterThan(0);
    expect(check.failed_pickup_phases?.["inserter:2"]).toBeDefined();
    const [first, second] = check.failed_pickup_phases!["inserter:2"];
    expect(first).not.toBe(second);
});
