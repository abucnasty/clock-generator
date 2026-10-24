import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {GENERATED_ALTERNATIVE, ownClockCases} from "../../tests/game/builds/own-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";

// the generated clock pinned beside the in-game recording of it on the build's three copies
const controls = readControls("own-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_INSERTER_CRAFTING);
    generated = generateClockAlternatives(config, {logger: quiet});
});

test("own clock: every inserter and drill a clock leaves always on says why", () => {
    expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
});

test("own clock: the selected clock is the one recorded on the three copies", () => {
    expect(generated.alternatives[generated.selected_index].id).toBe(GENERATED_ALTERNATIVE);
});

for (const variant of ownClockCases()) {
    test(`own clock: ${variant.name}`, () => {
        const {generation, native} = controls.cases[variant.name];
        // the hand-made clock is not generated: its control is the game's numbers, 80 a second a copy in every period
        expect(native.baseline).toHaveLength(63);
        expect(native.baseline.every(items => items === native.expected)).toBe(true);
        for (const loss of native.recovery) {
            expect(Math.min(...loss.during)).toBeLessThan(native.expected);
        }
        if (variant.kind === "owner's clock") {
            expect(generation).toBeUndefined();
            expect([native.period, native.expected]).toEqual([216, 864]);
            return;
        }
        const chosen = generated.alternatives.find(alternative => alternative.id === variant.alternative)!;
        const exported = chosen.result.subtick ?? chosen.result;
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
            "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(generation!.clock_sha256);
        expect(chosen.result.subtick?.clock.period_ticks ?? chosen.result.simulation_duration.ticks).toBe(generation!.period);
        expect(chosen.verdict).toBe(generation!.verdict);
        expect({id: chosen.id, holds: chosen.assessment.holds, rate: chosen.assessment.items_per_second,
            supply: chosen.belt?.kind ?? null}).toEqual(generation!.selection);
        expect(native.expected).toBe(generation!.expected);
    });
}
