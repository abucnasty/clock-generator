import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";
import {steelWagonClockTests} from "../../tests/game/builds/steel-wagon-clock-generation";

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.STEEL_CARGO_WAGON);
    generated = generateClockAlternatives(config, {logger: quiet});
});

test("steel wagon: every inserter and drill a clock leaves always on says why", () => {
    expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
});

test("steel wagon: the clock with belt slack is selected, and the drill into the wagon is enabled before the ore is taken", () => {
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.id).toBe("planned-belt-slack-subtick");
    // a period of 886.15 ticks: a window of two whole positions is enabled 1 or 2 ticks a period, 1.08 on average
    expect(selected.result.clock_windows["drill:1"]).toEqual([{start: 346, end: 347}]);
    expect(Math.min(...selected.result.clock_windows["inserter:5"].map(range => range.start))).toBeLessThanOrEqual(348);
    expect(selected.result.chest_drills?.[0].enabled_ticks).toBeCloseTo(1.078, 3);
});

test("steel wagon: no description shows a float as a fraction (the period is a whole number of crafting cycles)", () => {
    // the period of 11520/13 ticks over a cycle of 480/13 was once divided as doubles, 24.000000000000004, and inserter 4's
    // 5/8 swings a cycle came out as "6000000000000001/400000000000000" swings a period
    for (const alternative of generated.alternatives) {
        const blueprints = [alternative.result.blueprint, alternative.result.modulo_blueprint, alternative.result.subtick?.blueprint];
        for (const blueprint of blueprints.filter(it => it !== undefined)) {
            for (const text of [blueprint.description, ...blueprint.entities.map(entity => entity.player_description)]) {
                expect(text ?? "", `${alternative.id}: ${text}`).not.toMatch(/\d{8,}\/\d+/);
            }
        }
    }
});

// the clocks that take this build as it is; the one that leaves iron ore out of the period generates a build of its own, in
// steel-wagon-clock-out-of-period.generation.test.ts
steelWagonClockTests(variant => variant.ignored_lcm_ingredients === undefined, () => generated);
