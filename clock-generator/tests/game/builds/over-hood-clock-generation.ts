import {createHash} from "crypto";
import {expect, test} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {alwaysOnReasonProblemsOf} from "../../../src/crafting/generate-blueprint-test-helpers";
import {overHoodClockCases, overHoodClockConfig} from "./over-hood-clock-fixtures";
import {readControls, RunControls} from "./clock-controls";
import {expectRunAgreesWithSelection} from "../helpers/fixture-mechanics";
import {OVER_HOOD_GENERATED} from "./over-hood-clock-cases";

// each selection pinned beside the in-game recording of its clock
const controls = readControls<RunControls>("over-hood-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/** The generation tests of the over-the-hood clocks that no other test generates (over-hood-clock-cases.ts), each beside the in-game recording of its clock */
export function overHoodClockTests() {
    for (const family of ["different-items", "same-item"] as const) for (const variant of overHoodClockCases(family).filter(it => OVER_HOOD_GENERATED.has(it.name))) {
        test(`phase-checked default: ${variant.name}`, () => {
            const {generation, native, previous} = controls.cases[variant.name];
            const expected = generation!;
            const config = overHoodClockConfig(variant);
            const generated = generateClockAlternatives(config, {logger: quiet});
            expect(alwaysOnReasonProblemsOf(config, generated), "every inserter and drill a clock leaves always on says why").toEqual([]);
            const selected = generated.alternatives[generated.selected_index];
            const result = selected.result;
            const period = result.subtick?.clock.period_ticks ?? result.simulation_duration.ticks;
            const exported = result.subtick ?? result;
            const clock = clockIdentity(exported);
            expect(createHash("sha256").update(JSON.stringify(clock)).digest("hex"), "same windows and exported clock as the native control (its identity: no text or metadata)")
                .toBe(expected.clock_sha256);
            expect(period).toBe(expected.period);
            expect(selected.verdict).toBe(expected.verdict);
            expect({id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second,
                supply: selected.belt?.kind}).toEqual(expected.selection);
            expect(native.period).toBe(expected.period);
            // The run judges the generator's own holds verdict for every recorded clock, not only the stable ones: a clock
            // rejected for recovery alone can hide a baseline it wrongly believes holds. Only a run made under the selection's
            // own supply speaks to its baseline.
            const recorded_supply = variant.backed ? "backed_up" : "moving";
            expectRunAgreesWithSelection(variant.name, native, {verdict: selected.verdict, holds: selected.assessment.holds},
                recorded_supply === expected.selection.supply);
            if (previous) {
                // the clock selected before the observed windows were searched past a stable clock is still made, with the same windows
                const earlier = generated.alternatives.find(alternative => alternative.id === previous.id);
                expect(earlier, `${previous.id} is still made`).toBeDefined();
                const earlier_exported = earlier!.result.subtick ?? earlier!.result;
                expect(createHash("sha256").update(JSON.stringify(clockIdentity(earlier_exported))).digest("hex")).toBe(previous.clock_sha256);
            }
        });
    }
}
