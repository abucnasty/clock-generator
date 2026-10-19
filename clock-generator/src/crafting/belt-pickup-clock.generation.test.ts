import fs from "fs";
import path from "path";
import {describe, expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {rotateRanges, SerializableClockWindows} from "./clock";
import {simulateClockOnly} from "./trial";
import {OpenRange} from "../data-types";
import {pickupClockConfig, pickupClockSpeedCases} from "../../tests/game/builds/pickup-clock-speed-coverage";

interface NativeClockControl {
    generationVerdict: string;
    period: number;
    expected: number;
    baseline: number[];
    recovery: {recovered: number[]}[];
}

const controls = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../../tests/game/builds/pickup-clock-parity-controls.json"), "utf8")) as Record<string, NativeClockControl>;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
interface StartupControl {
    period: number;
    terminal_swings: number;
    clock_windows: SerializableClockWindows;
    phases: {offset: number; items_per_period: number[]}[];
}
const startupControls = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../../tests/game/builds/pickup-clock-startup-controls.json"), "utf8")) as Record<string, StartupControl>;
const movingPhases = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../../tests/game/builds/pickup-clock-moving-phase-controls.json"), "utf8")) as
    {cases: Record<string, {phases: Record<string, [number, number]>; bins: number[]}>};

// The native controls witness the selected default, including its failures. A different default must be
// rechecked in the game; matching the requested rate in the simulator alone does not replace that evidence.
for (const family of ["electromagnetic", "same-item"] as const) describe(`native-checked ${family} defaults`, () => {
    for (const variant of pickupClockSpeedCases(family)) test(variant.name, async () => {
        const native = controls[variant.name];
        expect(native, "every ordinary speed/layout/supply combination has a native control").toBeDefined();
        const config = await pickupClockConfig(variant);
        const result = generateClockAlternatives(config, {logger: quiet});
        const selected = result.alternatives[result.selected_index];
        const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
        expect(period).toBe(native.period);
        expect(selected.verdict).toBe(movingPhases.cases[variant.name] ? "unstable" : native.generationVerdict);
        expect(config.target_output.items_per_second * period / 60).toBe(native.expected);

        const meetsTarget = native.baseline.every(items => items === native.expected)
            && native.recovery.every(trial => trial.recovered.every(items => items === native.expected));
        const startup = startupControls[variant.name];
        if (startup) {
            // The ordinary warm run passes, but a fully jammed cold start at offset 1287 alternates
            // 144/208 natively. Compare those measured starts, rather than treating rejection as a model miss.
            expect(meetsTarget).toBe(true);
            expect(selected.verdict).toBe("unstable");
            expect(selected.assessment.holds).toBe(false);
            expect(selected.assessment.items_per_second).toBeLessThan(config.target_output.items_per_second);
            expect(selected.result.clock_windows).toEqual(startup.clock_windows);
            for (const phase of startup.phases) {
                const windows = Object.fromEntries(Object.entries(startup.clock_windows).map(([id, ranges]) =>
                    [id, rotateRanges(ranges.map(range => OpenRange.from(range.start, range.end)), phase.offset, startup.period)
                        .map(range => ({start: range.start_inclusive, end: range.end_inclusive}))]));
                const stock = simulateClockOnly({...config, overrides: {...config.overrides,
                    terminal_swing_count: startup.terminal_swings}}, windows, startup.period,
                    phase.items_per_period.length, quiet, {cold_start: true, warmup_periods: 0});
                expect(stock.ticks).toBe(startup.period * phase.items_per_period.length);
                const items = new Array<number>(phase.items_per_period.length).fill(0);
                const output = stock.inserters.find(inserter => inserter.inserter_id === "inserter:1")!;
                output.held.forEach((held, tick) => {
                    items[Math.floor(tick / startup.period)] += Math.max(0, (output.held[tick - 1] ?? 0) - held);
                });
                expect(items, `native cold-start output at offset ${phase.offset}`).toEqual(phase.items_per_period);
            }
        } else if (movingPhases.cases[variant.name]) {
            // These warm native runs still pass. The stronger verifier finds another modeled cold
            // lane-phase start; this is not a claim that the retained game run failed.
            expect(meetsTarget).toBe(true);
            expect(selected.assessment.holds).toBe(false);
            expect(selected.result.stability_check.as_built?.failed_pickup_phases)
                .toEqual(movingPhases.cases[variant.name].phases);
        } else if (meetsTarget) {
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
            expect(selected.belt?.kind).toBe(variant.backed ? "backed_up" : "moving");
        } else {
            // A fallback requiring backed-up supply is not a verified clock for moving input.
            expect(selected.verdict !== "stable" || selected.belt?.kind !== (variant.backed ? "backed_up" : "moving"),
                "a measured shortfall must not be advertised as stable for this supply").toBe(true);
        }
    });
});
