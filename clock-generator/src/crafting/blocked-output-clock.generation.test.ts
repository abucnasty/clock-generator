import {createHash} from "crypto";
import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {blockedOutputClockCases, blockedOutputClockConfig} from "../../tests/game/builds/blocked-output-clock-fixtures";
import {BLOCKED_OUTPUT_GENERATED} from "../../tests/game/builds/blocked-output-clock-cases";
import {readControls, RunControls} from "../../tests/game/builds/clock-controls";
import {expectRunAgreesWithSelection} from "../../tests/game/helpers/fixture-mechanics";

// each selection pinned beside the in-game recording of its clock, for the cases of blocked-output-clock-cases.ts; the other
// cases are checked without generating by blocked-output-clock-mechanics.test.ts
const controls = readControls<RunControls>("blocked-output-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const variant of blockedOutputClockCases().filter(it => BLOCKED_OUTPUT_GENERATED.has(it.name))) {
    test(`blocked output default: ${variant.name}`, () => {
        const {generation, native, previous} = controls.cases[variant.name];
        const expected = generation!;
        const config = blockedOutputClockConfig(variant);
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
        expect(native.period).toBe(expected.period);
        if (previous) {
            // the clock selected before the wake-ups were counted with the arm at home is still made, with the same windows
            const earlier = generated.alternatives.find(alternative => alternative.id === previous.id);
            expect(earlier, `${previous.id} is still made`).toBeDefined();
            const earlier_exported = earlier!.result.subtick ?? earlier!.result;
            expect(createHash("sha256").update(JSON.stringify(clockIdentity(earlier_exported))).digest("hex")).toBe(previous.clock_sha256);
        }
        // The simulator holds the output inserter from the tick its belt stops taking the product; the game first fills the belt
        // behind the drop, so its output falls some time into the block. Neither changes what follows: the run says whether
        // the clock holds its target and is back at it after the release.
        expectRunAgreesWithSelection(variant.name, native, {verdict: selected.verdict, holds: selected.assessment.holds});
    });
}
