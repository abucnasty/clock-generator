import fs from "fs";
import path from "path";
import {describe, expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
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
const conservativeRejections = new Set([
    "electromagnetic-normal-underground-entrance-backed",
    "electromagnetic-normal-underground-exit-backed",
]);

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
        expect(selected.verdict).toBe(native.generationVerdict);
        expect(config.target_output.items_per_second * period / 60).toBe(native.expected);

        const meetsTarget = native.baseline.every(items => items === native.expected)
            && native.recovery.every(trial => trial.recovered.every(items => items === native.expected));
        if (conservativeRejections.has(variant.name)) {
            // Known disagreement retained for the next simulator fix: the native clock works, but the
            // simulated default is rejected. This regression records that gap rather than claiming parity.
            expect(meetsTarget).toBe(true);
            expect(selected.verdict).toBe("unstable");
            expect(selected.assessment.holds).toBe(false);
            expect(selected.assessment.items_per_second).toBeLessThan(config.target_output.items_per_second);
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
