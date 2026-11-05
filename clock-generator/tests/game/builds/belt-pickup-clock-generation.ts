import {describe, expect, test} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {alwaysOnReasonProblemsOf} from "../../../src/crafting/generate-blueprint-test-helpers";
import {pickupClockConfig, pickupClockSpeedCases} from "./pickup-clock-speed-coverage";
import {readControls, runHolds, RunControls} from "./clock-controls";
import {BELT_PICKUP_GENERATED} from "./belt-pickup-clock-cases";

const controls = readControls<RunControls>("pickup-clock-controls.json").cases;

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

// The native controls witness the selected default, including its failures. A different default must be
// rechecked in the game; matching the requested rate in the simulator alone does not replace that evidence.
// The pin of each (clock hash, period, verdict, selection) and the cold-start runs on the selection are checked against the
// record, without generating (clock-controls.test.ts); what the record does not hold is checked here: the lane-phase evidence
// of the selection and the cause given where it is not stable.

/** The generation tests of the belt pickup clocks that no other test generates (belt-pickup-clock-cases.ts), each beside the in-game recording of its clock */
export function beltPickupClockTests() {
    for (const family of ["electromagnetic", "same-item"] as const) describe(`native-checked ${family} defaults`, () => {
        for (const variant of pickupClockSpeedCases(family).filter(it => BELT_PICKUP_GENERATED.has(it.name))) test(variant.name, async () => {
            const native = controls[variant.name]?.native;
            const pin = controls[variant.name]?.generation;
            expect(native, "every ordinary speed/layout/supply combination has a native control").toBeDefined();
            expect(pin, "and a pin of the selection its native summary was recorded on").toBeDefined();
            const config = await pickupClockConfig(variant);
            const result = generateClockAlternatives(config, {logger: quiet});
            expect(alwaysOnReasonProblemsOf(config, result), "every inserter and drill a clock leaves always on says why").toEqual([]);
            const selected = result.alternatives[result.selected_index];
            const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
            if (pin!.as_built) expect(selected.result.stability_check.as_built, "the model's lane-phase evidence of the selection").toMatchObject(pin!.as_built);
            expect(result.why_not_stable?.cause).toBe(pin!.why_not_stable);
            expect(Math.round(config.target_output.items_per_second * period / 60 * 1e6) / 1e6).toBe(pin!.expected);
            if (runHolds(native)) {
                expect(selected.verdict).toBe("stable");
                expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
                expect(selected.belt?.kind).toBe(variant.backed ? "backed_up" : "moving");
                expect(result.why_not_stable).toBeNull();
            } else {
                // A fallback requiring backed-up supply is not a verified clock for moving input.
                expect(selected.verdict !== "stable" || selected.belt?.kind !== (variant.backed ? "backed_up" : "moving"),
                    "a measured shortfall must not be advertised as stable for this supply").toBe(true);
            }
        });
    });
}
