import fs from "fs";
import path from "path";
import {describe, expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {rotateRanges, SerializableClockWindows} from "./clock";
import {backpressureLossOf, simulateClockOnly} from "./trial";
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
    "../../tests/game/builds/pickup-clock-a8-controls.json"), "utf8")) as Record<string, NativeClockControl>;

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
const recoveryPhases = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../../tests/game/builds/pickup-clock-recovery-phase-controls.json"), "utf8")) as
    {cases: Record<string, {phases: Record<string, [number, number]>}>};

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
            // The fixed windows stay as a check of the simulator against the game's measured cold starts (a
            // fully jammed start at offset 1287 alternates 144/208 natively), independent of the selection:
            // the generator now selects the clock planned with the belts moving here (#275), which the branches
            // below judge on its own recording.
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
        }
        if (movingPhases.cases[variant.name]) {
            // These warm native runs still pass. The verifier finds a cold lane-phase start the clock fails from,
            // and the game fails from it too (normal-underground-lane-phase-controls.json): the retained warm
            // run started at another phase.
            expect(meetsTarget).toBe(true);
            expect(selected.assessment.holds).toBe(false);
            expect(selected.result.stability_check.as_built?.failed_pickup_phases)
                .toEqual(movingPhases.cases[variant.name].phases);
        } else if (recoveryPhases.cases[variant.name]) {
            // The capture holds and recovers, and the generator's loss trials find a lane-phase start the clock does not
            // get back from after a loss, which the capture cannot set up: a cautious verdict, not a measured failure.
            expect(meetsTarget).toBe(true);
            expect(selected.assessment.holds).toBe(true);
            expect(selected.belt?.kind).toBe("moving");
            const swings = {...config, overrides: {...config.overrides, terminal_swing_count: selected.result.used_terminal_swing_count}};
            const failed = backpressureLossOf(swings, selected.result.clock_windows, period, native.expected, quiet).losses
                .filter(loss => !loss.recovers);
            expect(failed.length).toBeGreaterThan(0);
            expect(failed.map(loss => loss.failed_pickup_phases)).toEqual(failed.map(() => recoveryPhases.cases[variant.name].phases));
        } else if (meetsTarget) {
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
            // a backed-up config gets a clock for a moving belt only as the fallback, where no other clock is stable
            // (the normal underground entrance and exit, whose backed-up belts refill slower than a stack a tick)
            expect(selected.belt?.kind).toBe(variant.backed && selected.id !== "planned-moving-belt" ? "backed_up" : "moving");
        } else {
            // A fallback requiring backed-up supply is not a verified clock for moving input.
            expect(selected.verdict !== "stable" || selected.belt?.kind !== (variant.backed ? "backed_up" : "moving"),
                "a measured shortfall must not be advertised as stable for this supply").toBe(true);
            // And where the clock was recorded under its own supply, a baseline miss has to be the generator's own
            // finding: a clock rejected for recovery alone can hide a baseline it wrongly believes holds.
            if (selected.belt?.kind === (variant.backed ? "backed_up" : "moving")
                && native.baseline.some(items => items !== native.expected)) {
                expect(selected.assessment.holds, "the native baseline misses the expected output: the generator has to see that itself").toBe(false);
            }
        }
    });
});
