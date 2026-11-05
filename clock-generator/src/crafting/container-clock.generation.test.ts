import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {containerClockCases, containerClockConfig} from "../../tests/game/builds/container-clock-fixtures";
import {CONTAINER_GENERATED} from "../../tests/game/builds/container-clock-cases";

// each selection is pinned beside the in-game recording of its clock, and the pin is checked against the record
// (tests/game/builds/clock-controls.test.ts); here what the record does not hold: every always-on inserter and drill says why.
// Only the fixtures of container-clock-cases.ts are generated, the rest are checked by container-clock-mechanics.test.ts
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const variant of containerClockCases().filter(it => CONTAINER_GENERATED.has(it.name))) {
    test(`container clock default: ${variant.name}`, () => {
        const config = containerClockConfig(variant);
        const generated = generateClockAlternatives(config, {logger: quiet});
        expect(alwaysOnReasonProblemsOf(config, generated), "every inserter and drill a clock leaves always on says why").toEqual([]);
    });
}
