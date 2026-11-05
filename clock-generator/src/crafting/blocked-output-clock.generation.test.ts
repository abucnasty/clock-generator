import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {blockedOutputClockCases, blockedOutputClockConfig} from "../../tests/game/builds/blocked-output-clock-fixtures";
import {BLOCKED_OUTPUT_GENERATED} from "../../tests/game/builds/blocked-output-clock-cases";

// each selection is pinned beside the in-game recording of its clock, and the pin is checked against the record
// (tests/game/builds/clock-controls.test.ts); here what the record does not hold: every always-on inserter and drill says why.
// The other cases are checked without generating by blocked-output-clock-mechanics.test.ts
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const variant of blockedOutputClockCases().filter(it => BLOCKED_OUTPUT_GENERATED.has(it.name))) {
    test(`blocked output default: ${variant.name}`, () => {
        const config = blockedOutputClockConfig(variant);
        const generated = generateClockAlternatives(config, {logger: quiet});
        expect(alwaysOnReasonProblemsOf(config, generated), "every inserter and drill a clock leaves always on says why").toEqual([]);
    });
}
