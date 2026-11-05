import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {backpressureLossOf, ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {lossId} from "./backpressure-loss";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {electromagneticDrainedEndClockCases} from "../../tests/game/builds/electromagnetic-science-330-drained-end-clock-fixtures";
import {readControls, RunControls, runHolds} from "../../tests/game/builds/clock-controls";

// the electromagnetic science build (ELECTROMAGNETIC_SCIENCE_330): the generated clock pinned beside the in-game recording of it on the
// owner's drained-end scaffold of one copy (#458), with the losses the simulator tries
const controls = readControls<RunControls>("electromagnetic-science-330-drained-end-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330);
    generated = generateClockAlternatives(config, {logger: quiet});
}, 300_000);

test("electromagnetic science drained end clock: every inserter a clock leaves always on says why", () => {
    expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
});

test("electromagnetic science drained end clock: the selected clock is swings-2 of 704 ticks, stable on moving belts, and the simulator gets back from all three losses", () => {
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.id).toBe("swings-2");
    expect(selected.verdict).toBe("stable");
    expect(selected.belt?.kind).toBe("moving");
    expect(selected.result.simulation_duration.ticks).toBe(704);
    // the simulator tries the loss of each supply and the output not taken away, and recovers from each (the game's recording has no disturbance)
    const report = backpressureLossOf(config, selected.result.clock_windows, selected.result.simulation_duration.ticks,
        selected.result.stability_check.expected_output_items, quiet);
    expect(report.undisturbed.recovers).toBe(true);
    expect(report.losses.map(outcome => [lossId(outcome.loss), outcome.recovers])).toEqual([["supply:supercapacitor", true], ["supply:accumulator", true], ["output:electromagnetic-science-pack", true]]);
    expect(report.survives).toBe(true);
});

for (const variant of electromagneticDrainedEndClockCases()) {
    test(`electromagnetic science drained end clock: ${variant.name}`, () => {
        const {generation, native} = controls.cases[variant.name];
        // the game's run: 30 a second a copy, held over the baseline
        expect(runHolds(native), native.result).toBe(true);
        const chosen = generated.alternatives.find(alternative => alternative.id === "swings-2")!;
        const exported = chosen.result.subtick ?? chosen.result;
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
            "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(generation!.clock_sha256);
        expect(chosen.result.subtick?.clock.period_ticks ?? chosen.result.simulation_duration.ticks).toBe(generation!.period);
        expect(chosen.verdict).toBe(generation!.verdict);
        expect({id: chosen.id, holds: chosen.assessment.holds, rate: chosen.assessment.items_per_second,
            supply: chosen.belt?.kind ?? null}).toEqual(generation!.selection);
        expect(native.period).toBe(generation!.period);
    });
}
