import {createHash} from "crypto";
import {expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {SteelWagonCase, steelWagonCases, steelWagonConfig} from "./steel-wagon-clock-fixtures";
import {readControls} from "./clock-controls";

// each clock pinned beside the in-game recording of it
const controls = readControls("steel-wagon-clock-controls.json");
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
            expect(native.expected).toBe(expected.expected);
            // the game holds the target in every baseline period, and is back at it in every judged period after the drill
            // stopped until the wagon ran dry of steel, the output blocked and the drill stopped again
            expect(native.baseline.every(items => items === native.expected)).toBe(true);
            for (const loss of native.recovery) {
                expect(Math.min(...loss.during)).toBeLessThan(native.expected);
                expect(loss.recovered.length).toBeGreaterThanOrEqual(30);
                expect(loss.recovered.every(items => items === native.expected)).toBe(true);
            }
        });
    }
}
