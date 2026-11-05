import {createHash} from "crypto";
import {expect, test} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {steelWagonCases, steelWagonConfig} from "./steel-plate-26-wagon-chest-clock-fixtures";
import {readControls, RunControls} from "./clock-controls";
import {expectRunAgreesWithSelection} from "../helpers/fixture-mechanics";

// each clock pinned beside the in-game recording of it
const controls = readControls<RunControls>("steel-plate-26-wagon-chest-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/**
 * The generation test of the steel wagon clock that leaves items out of the period, against the in-game recording of its clock. It
 * generates a build of its own, which is no job of the record, so its pin is checked here; the pins of the clocks of the build as it
 * is are checked against the record (clock-controls.test.ts)
 */
export function steelWagonClockTests() {
    for (const variant of steelWagonCases().filter(it => it.ignored_lcm_ingredients !== undefined)) {
        test(`steel wagon clock: ${variant.name}`, async () => {
            const {generation, native} = controls.cases[variant.name];
            const expected = generation!;
            const alternatives = generateClockAlternatives(await steelWagonConfig(variant), {logger: quiet});
            const chosen = alternatives.alternatives.find(alternative => alternative.id === variant.alternative)!;
            const result = chosen.result;
            const exported = result.subtick ?? result;
            const clock = clockIdentity(exported);
            expect(createHash("sha256").update(JSON.stringify(clock)).digest("hex"), "same windows and exported clock as the native control (its identity: no text or metadata)")
                .toBe(expected.clock_sha256);
            expect(result.subtick?.clock.period_ticks ?? result.simulation_duration.ticks).toBe(expected.period);
            expect(chosen.verdict).toBe(expected.verdict);
            expect({id: chosen.id, holds: chosen.assessment.holds, rate: chosen.assessment.items_per_second,
                supply: chosen.belt?.kind ?? null}).toEqual(expected.selection);
            expect(native.period).toBe(expected.period);
            // the game holds the target over the baseline, and is back at it after the drill stopped until the wagon ran dry of
            // steel, the output blocked and the drill stopped again
            expectRunAgreesWithSelection(variant.name, native, {verdict: chosen.verdict, holds: chosen.assessment.holds});
        });
    }
}
