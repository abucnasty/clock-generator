import {beforeAll, expect, test} from "vitest";
import {backpressureLossOf, ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {lossId} from "./backpressure-loss";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {GENERATED_ALTERNATIVE, logisticDirectInsertClockCases} from "../../tests/game/builds/logistic-science-240-direct-insert-clock-fixtures";
import {readControls, RunControls, runHolds} from "../../tests/game/builds/clock-controls";

// the logistic science build with direct insertion (LOGISTIC_SCIENCE_240_DIRECT_INSERT): the generated clock pinned beside the in-game
// recording of it on the sample's scaffold of one copy, with the losses the simulator tried and the game's cuts
const controls = readControls<RunControls>("logistic-science-240-direct-insert-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240_DIRECT_INSERT);
    generated = generateClockAlternatives(config, {logger: quiet});
}, 300_000);

test("logistic science direct insert clock: the selected clock is fractional swings of 96 ticks, stable on moving belts, and the simulator gets back from both losses", () => {
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.id).toBe(GENERATED_ALTERNATIVE);
    expect(selected.verdict).toBe("stable");
    expect(selected.belt?.kind).toBe("moving");
    expect(selected.result.simulation_duration.ticks).toBe(96);
    // the game's cuts are the losses the simulator tries, and it recovers from each (the molten iron is no loss: no belt or chest carries it)
    const report = backpressureLossOf(config, selected.result.clock_windows, selected.result.simulation_duration.ticks,
        selected.result.stability_check.expected_output_items, quiet);
    expect(report.undisturbed.recovers).toBe(true);
    expect(report.losses.map(outcome => [lossId(outcome.loss), outcome.recovers])).toEqual([["supply:inserter", true], ["output:logistic-science-pack", true]]);
    expect(report.survives).toBe(true);
});

for (const variant of logisticDirectInsertClockCases()) {
    test(`logistic science direct insert clock: ${variant.name}`, () => {
        // the game's run: 40 a second a copy, held and recovered from both cuts; the pin of its clock is checked against the record (clock-controls.test.ts)
        const {native} = controls.cases[variant.name];
        expect(runHolds(native), native.result).toBe(true);
    });
}
