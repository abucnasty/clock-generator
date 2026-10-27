import {createHash} from "crypto";
import path from "path";
import {beforeAll, describe, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {backpressureLossVerdictOf} from "./trial";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {carCases} from "../../tests/game/builds/car-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";

// each clock pinned beside the in-game recording of it
const controls = readControls("car-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_CAR);
    generated = generateClockAlternatives(config, {logger: quiet});
});

test("car: every inserter and drill a clock leaves always on says why", () => {
    expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
});

test("car: the clock with 3 output swings is selected, and the drill into the car is enabled the tick before the takers", () => {
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.id).toBe("swings-3");
    // 617 ore a tick against 64 a 72-tick period: a window of one tick, which drops what the drill holds
    expect(selected.result.clock_windows["drill:1"]).toEqual([{start: 27, end: 27}]);
    expect(selected.result.clock_windows["inserter:1"][0].start).toBe(28);
    for (const alternative of generated.alternatives) {
        // a clock that does not meet goal 1 with the drill's window is the one with the drill always enabled
        expect(alternative.result.clock_windows["drill:1"]?.length ?? 0, alternative.id).toBe(alternative.verdict === "stable" ? 1 : 0);
    }
});

for (const variant of carCases()) {
    test(`car clock: ${variant.name}`, () => {
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
        expect(native.expected).toBe(expected.expected);
        // the game holds the target in every baseline period, and is back at it in every judged period after the drill
        // stopped until the car ran dry, the output blocked and the drill stopped again
        expect(native.baseline.every(items => items === native.expected)).toBe(true);
        for (const loss of native.recovery) {
            expect(Math.min(...loss.during)).toBeLessThan(native.expected);
            expect(loss.recovered.length).toBeGreaterThanOrEqual(30);
            expect(loss.recovered.every(items => items === native.expected)).toBe(true);
        }
    });
}

// the car's Sidecar export (car.sidecar-export.json) as the web app pastes it, at the export's suggested target: the
// furnaces' ceiling, 80.78015625, floored to 80.780/s (U11)
describe("the car paste at 80.78/s", () => {
    let paste_config: Config;
    let paste: ClockAlternativesResult;
    beforeAll(async () => {
        paste_config = await loadConfigFromFile(path.join(__dirname, "fixtures", "car-paste-80.78.json"));
        paste = generateClockAlternatives(paste_config, {logger: quiet});
    });

    // 5 swings is 356.524 ticks: no subtick clock (a scale above 1000), so its blueprint counts 356 ticks and takes 416
    // plates of them
    test("lists the clock of 356.524 ticks as the clock rounded to 356 it is, at its own rate, and does not select it", () => {
        const five = paste.alternatives.find(alternative => alternative.id === "swings-5")!;
        expect(five.result.simulation_duration.ticks).toBeCloseTo(356.524, 3);
        expect(five.result.subtick).toBeUndefined();
        // 0.15% fast: more than the 0.1% a rounded clock may run, so it is not tried on its own period
        expect(five.label).toMatch(/\(clock rounded to 356 ticks, runs 0\.15% fast\)$/);
        expect(five.assessment.items_per_second).toBeCloseTo(416 * 60 / 356, 6);
        expect(five.rounded).toMatchObject({period_ticks: 356, tried_on_its_period: false});
        expect(five.ranking).toMatchObject({meets_target_rate: false, recovery_untried: false});
        expect(five.ranking.runs_fast).toBeUndefined();
        expect(paste.alternatives.filter(alternative => alternative.id.startsWith("swings-5"))).toHaveLength(1);
        expect(paste.alternatives[paste.selected_index].id).not.toBe("swings-5");
    });

    // 285 ticks of 285.19: 0.08% fast, but above the furnaces' 80.78015625/s, so not tried on its own period either
    test("does not let a rounded clock run above what the furnaces make", () => {
        const rounded = paste.alternatives.find(alternative => alternative.id === "planned-belt-slack")!;
        expect(rounded.rounded).toMatchObject({period_ticks: 285, within_machines: false, tried_on_its_period: false});
        expect(rounded.rounded!.runs_fast).toBeLessThan(0.001);
        expect(rounded.ranking.meets_target_rate).toBe(false);
    });

    test("says why the recovery of a clock of 356.524 ticks cannot be tried, and the selected clock meets the target rate", () => {
        const five = paste.alternatives.find(alternative => alternative.id === "swings-5")!;
        expect(backpressureLossVerdictOf(paste_config, five.result, quiet)).toEqual({
            backpressure_loss: null,
            backpressure_loss_not_tried: "A clock of 356.524 ticks does not repeat in whole ticks, so its output cannot be counted by the period",
        });
        const selected = paste.alternatives[paste.selected_index];
        expect(selected.assessment.items_per_second).toBeCloseTo(80.78, 6);
        expect(selected.assessment.backpressure_loss).not.toBeNull();
    });
});
