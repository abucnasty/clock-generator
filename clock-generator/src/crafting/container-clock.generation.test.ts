import {createHash} from "crypto";
import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {containerClockCases, containerClockConfig} from "../../tests/game/builds/container-clock-fixtures";
import {readControls, RunControls} from "../../tests/game/builds/clock-controls";
import {expectRunAgreesWithSelection} from "../../tests/game/helpers/fixture-mechanics";
import {CONTAINER_GENERATED} from "../../tests/game/builds/container-clock-cases";

// each selection pinned beside the in-game recording of its clock; only the fixtures of container-clock-cases.ts are
// generated, the rest are checked by container-clock-mechanics.test.ts
const controls = readControls<RunControls>("container-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const variant of containerClockCases().filter(it => CONTAINER_GENERATED.has(it.name))) {
    test(`container clock default: ${variant.name}`, () => {
        const {generation, native, previous} = controls.cases[variant.name];
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
        expect(native.period).toBe(expected.period);
        if (previous) {
            // the clock selected before the wake-ups were counted with the arm at home is still made, with the same windows
            const earlier = generated.alternatives.find(alternative => alternative.id === previous.id);
            expect(earlier, `${previous.id} is still made`).toBeDefined();
            const earlier_exported = earlier!.result.subtick ?? earlier!.result;
            expect(createHash("sha256").update(JSON.stringify(clockIdentity(earlier_exported))).digest("hex")).toBe(previous.clock_sha256);
        }
        expectRunAgreesWithSelection(variant.name, native, {verdict: selected.verdict, holds: selected.assessment.holds});
    });
}
