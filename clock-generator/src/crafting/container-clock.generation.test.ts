import {createHash} from "crypto";
import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {containerClockCases, containerClockConfig} from "../../tests/game/builds/container-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";

// each selection pinned beside the in-game recording of its clock
const controls = readControls("container-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const variant of containerClockCases()) {
    test(`container clock default: ${variant.name}`, () => {
        const {generation, native} = controls.cases[variant.name];
        const expected = generation!;
        const config = containerClockConfig(variant);
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
            supply: selected.belt?.kind ?? null}).toEqual(expected.selection);
        expect(native.expected).toBe(expected.expected);
        // the game holds the target in every baseline period, and after each disturbance (a cut that empties the
        // container, an output block, a second cut) is back at it in every judged period
        expect(native.baseline.every(items => items === native.expected)).toBe(selected.assessment.holds);
        for (const loss of native.recovery) {
            expect(loss.during).toContain(0);
            expect(loss.recovered.length).toBeGreaterThanOrEqual(30);
            expect(loss.recovered.every(items => items === native.expected)).toBe(selected.verdict === "stable");
        }
    });
}
