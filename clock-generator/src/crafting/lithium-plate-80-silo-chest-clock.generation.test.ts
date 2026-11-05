import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {lithiumSiloCases} from "../../tests/game/builds/lithium-plate-80-silo-chest-clock-fixtures";
import {readControls, runHolds, RunControls} from "../../tests/game/builds/clock-controls";

// each clock pinned beside the in-game recording of it
const controls = readControls<RunControls>("lithium-plate-80-silo-chest-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.LITHIUM_PLATE_80_SILO_CHEST);
    generated = generateClockAlternatives(config, {logger: quiet});
});

test("lithium silo: every inserter and drill a clock leaves always on says why", () => {
    expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
});

test("lithium silo: the even-hands clock is selected; the clock with 3 output swings, recorded in the game, is another it makes", () => {
    expect(generated.alternatives[generated.selected_index].id).toBe("even-hands");
});

for (const variant of lithiumSiloCases()) {
    test(`lithium silo clock: ${variant.name}`, () => {
        const {generation, native} = controls.cases[variant.name];
        const expected = generation!;
        const chosen = generated.alternatives.find(alternative => alternative.id === variant.alternative)!;
        const result = chosen.result;
        const exported = result.subtick ?? result;
        const clock = clockIdentity(exported);
        expect(createHash("sha256").update(JSON.stringify(clock)).digest("hex"), "same windows and exported clock as the native control (its identity: no text or metadata)")
            .toBe(expected.clock_sha256);
        expect(result.subtick?.clock.period_ticks ?? result.simulation_duration.ticks).toBe(expected.period);
        expect(chosen.verdict).toBe(expected.verdict);
        expect({id: chosen.id, holds: chosen.assessment.holds, rate: chosen.assessment.items_per_second,
            supply: chosen.belt?.kind ?? null}).toEqual(expected.selection);
        expect(native.period).toBe(expected.period);
        // the game holds the target over the baseline and is back at it after each disturbance, but for the known limit, which
        // never makes the target over a minute
        const holds = variant.known_limit === undefined;
        // the config marks the two drops that side-load onto the shared belt, and every clock of the build says so
        expect(chosen.insights.filter(insight => insight.id === "side-loaded-drop").map(insight => insight.what)).toEqual([
            "Inserter 15 drops onto a 3 tile belt buffer that side-loads onto another belt. "
            + "Inserter 16 drops onto a 3 tile belt buffer that side-loads onto another belt."]);
        expect(runHolds(native), native.result).toBe(holds);
        if (!holds) expect(native.baseline?.meets ?? false, "the known limit misses the target").toBe(false);
    });
}
