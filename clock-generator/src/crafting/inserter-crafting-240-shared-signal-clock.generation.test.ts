import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {backpressureLossOf, ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {lossId} from "./backpressure-loss";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {inserterCraftingClockCases} from "../../tests/game/builds/inserter-crafting-240-shared-signal-clock-fixtures";
import {readControls, runHolds, RunControls} from "../../tests/game/builds/clock-controls";

// the generated clock pinned beside the in-game recording of it on the build's three copies
const controls = readControls<RunControls>("inserter-crafting-240-shared-signal-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;
// the same config with its belts backed up (`overrides.backed_up_belts`): the one copy of the sample's scaffold, whose belts end closed
let backed_up: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
    generated = generateClockAlternatives(config, {logger: quiet});
    backed_up = generateClockAlternatives({...config, overrides: {...config.overrides, backed_up_belts: true}}, {logger: quiet});
}, 300_000);

// the clock recorded on the three copies (swings-6) is no longer the selected one; the next test finds it still made
test("inserter crafting clock: the selected clock is swings-2, and the one recorded on the three copies is another it makes", () => {
    expect(generated.alternatives[generated.selected_index].id).toBe("swings-2");
});

// with the belts backed up the selected clock is swings-6 (72 ticks), the one recorded in the game on the one copy of the sample's scaffold
test("inserter crafting clock: with the belts backed up the selected clock is swings-6, stable, and it survives the loss of supply", () => {
    const selected = backed_up.alternatives[backed_up.selected_index];
    expect(selected.id).toBe("swings-6");
    expect(selected.verdict).toBe("stable");
    expect(selected.assessment.holds).toBe(true);
    expect(selected.assessment.backpressure_loss?.survives).toBe(true);
    expect(selected.belt?.kind).toBe("backed_up");
    // the game's cuts (the ore, the circuits, the output) are the losses the simulator tries, and it recovers from each
    const report = backpressureLossOf({...config, overrides: {...config.overrides, backed_up_belts: true}}, selected.result.clock_windows,
        selected.result.simulation_duration.ticks, selected.result.stability_check.expected_output_items, quiet);
    expect(report.undisturbed.recovers).toBe(true);
    expect(report.losses.map(outcome => [lossId(outcome.loss), outcome.recovers])).toEqual(
        [["supply:iron-ore", true], ["supply:electronic-circuit", true], ["output:inserter", true]]);
});

for (const variant of inserterCraftingClockCases()) {
    test(`inserter crafting clock: ${variant.name}`, () => {
        const {generation, native} = controls.cases[variant.name];
        // the hand-made clock is not generated: its control is the game's run, 80 a second a copy, held and recovered
        expect(runHolds(native), native.result).toBe(true);
        if (variant.kind === "hand-made clock") {
            expect(generation).toBeUndefined();
            expect([native.period, native.target]).toEqual([216, 240]);
            return;
        }
        // the pin of the clock the three copies were recorded on, and its earlier clock, are checked against the record
        // (clock-controls.test.ts); the config with its belts backed up is no job of the record yet, so its pin is checked here
        if (!variant.backed_up_one_copy) return;
        const chosen = backed_up.alternatives.find(alternative => alternative.id === variant.alternative)!;
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
