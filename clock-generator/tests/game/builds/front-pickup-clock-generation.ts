import {expect, test} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {alwaysOnReasonProblemsOf} from "../../../src/crafting/generate-blueprint-test-helpers";
import {FRONT_GENERATED} from "./front-clock-cases";
import {frontClockConfig, frontEntranceClockCases, frontExitClockCases} from "./front-clock-fixtures";
import {readControls, RunControls} from "./clock-controls";

// each selection pinned beside the in-game recording of its clock: the pin is checked against the record (clock-controls.test.ts),
// and here what the record does not hold: every always-on inserter says why, and the cause given where the selection is not stable
const controls = readControls<RunControls>("front-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/** The generation tests of the front pickup clocks that no other test generates (front-clock-cases.ts), each beside the in-game recording of its clock */
export function frontPickupClockTests() {
    const cases = [...frontEntranceClockCases("different-items"), ...frontEntranceClockCases("same-item"),
        ...frontExitClockCases(true), ...frontExitClockCases(false)].filter(variant => FRONT_GENERATED.has(variant.name));
    for (const variant of cases) {
        test(`front pickup default: ${variant.name}`, async () => {
            const expected = controls.cases[variant.name].generation!;
            const config = await frontClockConfig(variant);
            const generated = generateClockAlternatives(config, {logger: quiet});
            expect(alwaysOnReasonProblemsOf(config, generated), "every inserter and drill a clock leaves always on says why").toEqual([]);
            expect(generated.why_not_stable?.cause).toBe(expected.why_not_stable);
        });
    }
}
