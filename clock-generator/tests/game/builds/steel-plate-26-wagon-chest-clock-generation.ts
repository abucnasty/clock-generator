import {createHash} from "crypto";
import {expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {SteelWagonCase, steelWagonCases, steelWagonConfig} from "./steel-plate-26-wagon-chest-clock-fixtures";
import {readControls, RunControls} from "./clock-controls";
import {expectRunAgreesWithSelection} from "../helpers/fixture-mechanics";

// each clock pinned beside the in-game recording of it
const controls = readControls<RunControls>("steel-plate-26-wagon-chest-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/**
 * The generation tests of the steel wagon clocks that `which` picks, each against the in-game recording of its clock.
 * A case that leaves items out of the period generates its own build; the others take `generated`, the build as it is.
 */
export function steelWagonClockTests(which: (variant: SteelWagonCase) => boolean, generated?: () => ClockAlternativesResult) {
    for (const variant of steelWagonCases().filter(which)) {
        test(`steel wagon clock: ${variant.name}`, async () => {
            const {generation, native} = controls.cases[variant.name];
            const expected = generation!;
            if (variant.ignored_lcm_ingredients === undefined && generated === undefined) throw new Error("a case that takes the build as it is needs it generated");
            const alternatives = variant.ignored_lcm_ingredients === undefined ? generated!()
                : generateClockAlternatives(await steelWagonConfig(variant), {logger: quiet});
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
