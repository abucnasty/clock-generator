import {expect, test} from "vitest";
import {Config} from "../config";
import {OpenRange} from "../data-types";
import {backpressureLossOf, runAsBuiltCheck, runClockOnBuild} from "./trial";
import {SerializableClockWindows} from "./clock";
import {readControls} from "../../tests/game/builds/clock-controls";

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
const {over_hood_turbo_trace: native, over_hood_express_trace: express} =
    readControls<{over_hood_turbo_trace: NativeControl; over_hood_express_trace: NativeControl}>("lane-phase-controls.json");
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

test("express recovery reproduces the native seven-period shortfall with independently phased lanes", () => {
    const config = {...express.config, overrides: {...express.config.overrides,
        terminal_swing_count: express.terminal_swings}};
    const windows = new Map(Object.entries(express.clock_windows).map(([id, ranges]) =>
        [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const recovery = {loss: {kind: "supply", item: "iron-plate"} as const, period_ticks: express.period,
        expected_output_items: express.expected, places: [0], shares: [1]};
    expect(runClockOnBuild(config, windows, express.period, quiet, {
        factorio_states: false, backpressure_loss: recovery,
    }).backpressure_loss!.recovers).toBe(true);
    // Native observer ticks and model clock ticks have different origins. Both starts below have the
    // observed half-stack phase difference, without supplying the post-loss machine or hand state.
    const observed = express.windows[1].phase_units_256.map(values => values[0]);
    expect(Math.abs(observed[0] - observed[1])).toBe(32);
    const loss = runClockOnBuild(config, windows, express.period, quiet, {
        factorio_states: false, moving_pickup_phases: new Map([["inserter:2", [3, 7]]]),
        backpressure_loss: recovery,
    }).backpressure_loss!;
    expect(loss.recovers).toBe(false);
    expect(loss.trials).toHaveLength(1);
    const cycle = express.recovery[0].recovered.slice(0, 7);
    expect(cycle.filter(count => count === express.expected)).toHaveLength(6);
    const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
    expect(rotations).toContainEqual(loss.trials[0].ends_in);
});

test("recovery verification rejects the express clock that passed canonical recovery", () => {
    const config = {...express.config, overrides: {...express.config.overrides,
        terminal_swing_count: express.terminal_swings}};
    const report = backpressureLossOf(config, express.clock_windows, express.period, express.expected, quiet,
        {places: [0], shares: [1]});
    expect(report.undisturbed.pickup_phase_starts_checked).toBeGreaterThan(0);
    const iron = report.losses.find(outcome => outcome.loss.kind === "supply" && outcome.loss.item === "iron-plate")!;
    expect(iron.recovers).toBe(false);
    expect(iron.pickup_phase_starts_checked).toBeGreaterThan(0);
    expect(iron.failed_pickup_phases?.["inserter:2"]).toBeDefined();
    expect(report.survives).toBe(false);
});
