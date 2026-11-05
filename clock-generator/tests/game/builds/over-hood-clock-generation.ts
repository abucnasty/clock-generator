import {expect, test} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {alwaysOnReasonProblemsOf} from "../../../src/crafting/generate-blueprint-test-helpers";
import {overHoodClockCases, overHoodClockConfig} from "./over-hood-clock-fixtures";
import {OVER_HOOD_GENERATED} from "./over-hood-clock-cases";

// each selection is pinned beside the in-game recording of its clock, and the pin is checked against the record (clock-controls.test.ts);
// here what the record does not hold: every always-on inserter and drill says why
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/** The generation tests of the over-the-hood clocks that no other test generates (over-hood-clock-cases.ts), each beside the in-game recording of its clock */
export function overHoodClockTests() {
    for (const family of ["different-items", "same-item"] as const) for (const variant of overHoodClockCases(family).filter(it => OVER_HOOD_GENERATED.has(it.name))) {
        test(`phase-checked default: ${variant.name}`, () => {
            const config = overHoodClockConfig(variant);
            const generated = generateClockAlternatives(config, {logger: quiet});
            expect(alwaysOnReasonProblemsOf(config, generated), "every inserter and drill a clock leaves always on says why").toEqual([]);
        });
    }
}
