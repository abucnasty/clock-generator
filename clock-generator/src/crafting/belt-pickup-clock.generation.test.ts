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
    "../../tests/game/builds/pickup-clock-a2-controls.json"), "utf8")) as Record<string, NativeClockControl>;

// Builds whose retained warm recording holds its baseline and got back to target after every loss, while the
// generator says "no recovery" from its sampled cold lane-phase starts. A3 (moving lane phases) is to model
// those starts. A measured shortfall still never passes as stable.
const GAME_RECOVERS_BEYOND_MODEL = new Set([
    // The entrance's native cold starts match the model's dip and its warm runs hold 176: the "no recovery"
    // verdict promises less than the game delivers, erring on the safe side.
    "electromagnetic-normal-underground-entrance-moving",
    // The exit's warm recording recovers too, but a native cold start at its natural phase (native [7,7])
    // cycles at 143 a period under these same windows (a3-native-rounds.md, round 3): the "holds" half of the
    // verdict is wrong until the model's late resume after waiting for machine space is fixed (roadmap M1,
    // release-blocking). Do not read this build's assertions as a verified default.
    "electromagnetic-normal-underground-exit-moving",
]);

// Builds whose recording starts with a deterministic over-production transient: from the coverage
// protocol's post-calibration belt state the first periods pick up an extra stack, then every period to the
// end and every recovery is exact. Two 204-period runs without the calibration phase are clean, and the
// rerun reproduces the phase-2 capture exactly (periods 9 and 11 at 188/180; see
// work/belt-pickup-parity/a2-native-01/turbo-straight-300 and a2-item2-turbo-straight.md). Roadmap C1
// (startup timing predicted, not replayed) owns the start state. Only over-target misses followed by exact
// periods to the end, with exact recoveries, are accepted; a shortfall on any build still fails.
const START_TRANSIENT_OVER_PRODUCERS = new Set([
    "electromagnetic-turbo-straight-belt-moving",
]);

function startTransientOverProductionOnly(native: NativeClockControl): boolean {
    const miss_indices = native.baseline.flatMap((items, index) => items !== native.expected ? [index] : []);
    if (miss_indices.length === 0) {
        return false;
    }
    const last_miss = miss_indices[miss_indices.length - 1];
    return miss_indices.every(index => native.baseline[index] > native.expected)
        && last_miss < native.baseline.length - 1
        && native.recovery.every(trial => trial.recovered.every(items => items === native.expected));
}
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
            // The fixed windows stay as a check of the simulator against the game's measured cold starts (a
            // fully jammed start at offset 1287 alternates 144/208 natively), independent of the selection:
            // since the belt window trim the generator selects fractional here, which the branches below judge
            // on its own parity recording.
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
            // These warm native runs still pass. The stronger verifier finds another modeled cold
            // lane-phase start; this is not a claim that the retained game run failed.
            expect(meetsTarget).toBe(true);
            expect(selected.assessment.holds).toBe(false);
            expect(selected.result.stability_check.as_built?.failed_pickup_phases)
                .toEqual(movingPhases.cases[variant.name].phases);
        } else if (meetsTarget) {
            if (GAME_RECOVERS_BEYOND_MODEL.has(variant.name)) {
                // A recovery-only rejection: the baseline holds, and the measured recoveries all land.
                expect(selected.verdict).toBe("no recovery");
                expect(selected.assessment.holds).toBe(true);
            } else {
                expect(selected.verdict).toBe("stable");
                expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
                expect(selected.belt?.kind).toBe(variant.backed ? "backed_up" : "moving");
            }
        } else if (START_TRANSIENT_OVER_PRODUCERS.has(variant.name) && startTransientOverProductionOnly(native)) {
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
            expect(selected.belt?.kind).toBe(variant.backed ? "backed_up" : "moving");
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
