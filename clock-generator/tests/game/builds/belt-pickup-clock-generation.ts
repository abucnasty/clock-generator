import {describe, expect, test} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {alwaysOnReasonProblemsOf} from "../../../src/crafting/generate-blueprint-test-helpers";
import {pickupClockConfig, pickupClockSpeedCases} from "./pickup-clock-speed-coverage";
import {clockHash, readControls, runHolds, RunControls} from "./clock-controls";
import {expectRunAgreesWithSelection} from "../helpers/fixture-mechanics";
import {expectColdStartRunsOnSelection} from "./pickup-clock-cold-start-runs";
import {BELT_PICKUP_GENERATED} from "./belt-pickup-clock-cases";

const controls = readControls<RunControls>("pickup-clock-controls.json").cases;

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

// The native controls witness the selected default, including its failures. A different default must be
// rechecked in the game; matching the requested rate in the simulator alone does not replace that evidence.

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
            expect(clockHash(selected.result.subtick ?? selected.result), "same windows and exported clock as the pin (its identity: no text or metadata)")
                .toBe(pin!.clock_sha256);
            // the cold-start runs of this fixture name the selection as the clock they were recorded on: checked on this
            // generation, and not again by generating the fixture in pickup-clock-cold-start.generation.test.ts
            expectColdStartRunsOnSelection(variant.name, selected);
            expect({id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second,
                supply: selected.belt?.kind ?? null}).toEqual(pin!.selection);
            if (pin!.as_built) expect(selected.result.stability_check.as_built, "the model's lane-phase evidence of the selection").toMatchObject(pin!.as_built);
            expect(result.why_not_stable?.cause).toBe(pin!.why_not_stable);
            expect(period).toBe(pin!.period);
            expect(selected.verdict).toBe(pin!.verdict);
            expect(period).toBe(native.period);
            expect(selected.verdict).toBe(native.generationVerdict);
            expect(Math.round(config.target_output.items_per_second * period / 60 * 1e6) / 1e6).toBe(pin!.expected);
            expectRunAgreesWithSelection(variant.name, native, {verdict: selected.verdict, holds: selected.assessment.holds},
                selected.belt?.kind === (variant.backed ? "backed_up" : "moving"));
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
