import {describe, expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {rotateRanges, SerializableClockWindows} from "./clock";
import {backpressureLossOf, simulateClockOnly} from "./trial";
import {OpenRange} from "../data-types";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {pickupClockConfig, pickupClockSpeedCases} from "../../tests/game/builds/pickup-clock-speed-coverage";
import {clockHash, readControls} from "../../tests/game/builds/clock-controls";
import {expectColdStartRunsOnSelection} from "../../tests/game/builds/pickup-clock-cold-start-runs";

const controls = readControls("pickup-clock-controls.json").cases;

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
interface StartupControl {
    period: number;
    terminal_swings: number;
    clock_windows: SerializableClockWindows;
    phases: {offset: number; items_per_period: number[]}[];
}
const startupControls = readControls<{backed_up_start: {cases: Record<string, StartupControl>}}>("pickup-clock-start-controls.json")
    .backed_up_start.cases;
const {moving_phase: movingPhases, recovery_phase: recoveryPhases} = readControls<{
    moving_phase: {cases: Record<string, {phases: Record<string, [number, number]>; bins: number[]}>};
    recovery_phase: {cases: Record<string, {phases: Record<string, [number, number]>}>};
}>("lane-phase-controls.json");

// The native controls witness the selected default, including its failures. A different default must be
// rechecked in the game; matching the requested rate in the simulator alone does not replace that evidence.
for (const family of ["electromagnetic", "same-item"] as const) describe(`native-checked ${family} defaults`, () => {
    for (const variant of pickupClockSpeedCases(family)) test(variant.name, async () => {
        const native = controls[variant.name]?.native;
        const pin = controls[variant.name]?.generation;
        expect(native, "every ordinary speed/layout/supply combination has a native control").toBeDefined();
        expect(pin, "and a pin of the selection its native summary was recorded on").toBeDefined();
        const config = await pickupClockConfig(variant);
        const result = generateClockAlternatives(config, {logger: quiet});
        expect(alwaysOnReasonProblemsOf(config, result), "every inserter and drill a clock leaves always on says why").toEqual([]);
        const selected = result.alternatives[result.selected_index];
        const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
        expect(clockHash(selected.result.subtick ?? selected.result), "same windows and exported clock as the pin (its identity: no text or metadata)")
            .toBe(pin!.clock_sha256);
        // the cold-start runs of this fixture name the selection as the clock they were recorded on: checked on this
        // generation, and not again by generating the fixture in pickup-clock-cold-start.generation.test.ts
        expectColdStartRunsOnSelection(variant.name, selected);
        expect({id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second,
            supply: selected.belt?.kind ?? null}).toEqual(pin!.selection);
        expect(result.why_not_stable?.cause).toBe(pin!.why_not_stable);
        expect(period).toBe(pin!.period);
        expect(selected.verdict).toBe(pin!.verdict);
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
            // and the game fails from it too (lane-phase-controls.json, normal_underground): the retained warm
            // run started at another phase.
            expect(meetsTarget).toBe(true);
            expect(selected.assessment.holds).toBe(false);
            expect(selected.result.stability_check.as_built?.failed_pickup_phases)
                .toEqual(movingPhases.cases[variant.name].phases);
            // and the result says so: it holds from the modeled start, and a belt in another lane phase can fall short
            expect(result.why_not_stable?.cause).toBe("moving lane phases");
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
            // which the result tells as the moving lane phases, not as a clock that does not recover
            expect(result.why_not_stable?.cause).toBe("moving lane phases");
        } else if (meetsTarget) {
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
            // a backed-up config gets a clock for a moving belt only as the fallback, where no other clock is stable
            // (the normal underground entrance and exit, whose backed-up belts refill slower than a stack a tick)
            expect(selected.belt?.kind).toBe(variant.backed && selected.id !== "planned-moving-belt" ? "backed_up" : "moving");
            expect(result.why_not_stable).toBeNull();
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
