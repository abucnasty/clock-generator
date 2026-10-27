import {createHash} from "crypto";
import {expect, test} from "vitest";
import {FixtureBeltSpeed} from "../helpers/belt-speed-fixtures";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {alwaysOnReasonProblemsOf, BACKED_UP_GENERATION_GAP} from "../../../src/crafting/generate-blueprint-test-helpers";
import {frontClockConfig, frontEntranceClockCases, frontExitClockCases} from "./front-clock-fixtures";
import {readControls} from "./clock-controls";

// each selection pinned beside the in-game recording of its clock
const controls = readControls("front-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/** The generation tests of the front pickup clocks on one belt tier, each beside the in-game recording of its clock */
export function frontPickupClockTestsAt(tier: FixtureBeltSpeed["name"]) {
    const cases = [...frontEntranceClockCases("different-items"), ...frontEntranceClockCases("same-item"),
        ...frontExitClockCases(true), ...frontExitClockCases(false)].filter(variant => variant.speed.name === tier);
    for (const variant of cases) {
        test(`front pickup default: ${variant.name}`, async () => {
            const {generation, native} = controls.cases[variant.name];
            const expected = generation!;
            const config = await frontClockConfig(variant);
            const generated = generateClockAlternatives(config, {logger: quiet});
            expect(alwaysOnReasonProblemsOf(config, generated), "every inserter and drill a clock leaves always on says why").toEqual([]);
            const selected = generated.alternatives[generated.selected_index];
            if (BACKED_UP_GENERATION_GAP.has(variant.name)) {
                // no clock for the backed-up belts holds here and none is made for a moving belt: the recording of the
                // native control was made on that clock, which is no longer made (issue 456)
                expect(generated.alternatives.some(it => it.id === "planned-moving-belt")).toBe(false);
                expect(selected.verdict).not.toBe("stable");
                expect(selected.belt?.kind).toBe("backed_up");
                return;
            }
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
            expect(native.expected).toBe(expected.expected);
            expect(generated.why_not_stable?.cause).toBe(expected.why_not_stable);
            // The front exit's inserter stands on the exit's output tile: its belt is backed up in the game whatever the
            // config says. Only a recording made under the selection's own supply speaks to its holds verdict.
            const recorded_supply = variant.endpoint === "exit" || variant.backed ? "backed_up" : "moving";
            if (recorded_supply === expected.selection.supply && native.baseline.some(items => items !== native.expected)) {
                expect(selected.assessment.holds, "the native baseline misses the expected output: the generator has to see that itself").toBe(false);
            }
            // A moving config on the front exit gets a clock for moving belts, judged from moving lane phases this exit
            // cannot have; on the backed-up exit the game holds and recovers it at every tier, whatever that verdict says.
            const moving_config_on_backed_exit = variant.endpoint === "exit" && !variant.backed;
            if (selected.verdict === "stable" || moving_config_on_backed_exit) {
                expect(native.baseline.every(items => items === native.expected)).toBe(true);
                // backed-up recovery windows start later than moving ones and are shorter
                const heldPeriods = recorded_supply === "backed_up" ? 5 : 8;
                for (const loss of native.recovery) {
                    expect(loss.recovered.length).toBeGreaterThanOrEqual(heldPeriods);
                    expect(loss.recovered.slice(-heldPeriods).every(items => items === native.expected)).toBe(true);
                }
            }
        });
    }
}
