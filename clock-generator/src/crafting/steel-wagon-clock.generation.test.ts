import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {steelWagonCases} from "../../tests/game/builds/steel-wagon-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";

// each clock pinned beside the in-game recording of it
const controls = readControls("steel-wagon-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let generated: ClockAlternativesResult;

beforeAll(async () => {
    generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.STEEL_CARGO_WAGON), {logger: quiet});
}, 180_000);

test("steel wagon: the clock with belt slack is selected, and the drill into the wagon gets no window", () => {
    expect(generated.alternatives[generated.selected_index].id).toBe("planned-belt-slack-subtick");
    for (const alternative of generated.alternatives) {
        expect(Object.keys(alternative.result.clock_windows).filter(id => id.startsWith("drill:"))).toEqual([]);
    }
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

for (const variant of steelWagonCases()) {
    test(`steel wagon clock: ${variant.name}`, () => {
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
        // stopped until the wagon ran dry of steel, the output blocked and the drill stopped again
        expect(native.baseline.every(items => items === native.expected)).toBe(true);
        for (const loss of native.recovery) {
            expect(Math.min(...loss.during)).toBeLessThan(native.expected);
            expect(loss.recovered.length).toBeGreaterThanOrEqual(30);
            expect(loss.recovered.every(items => items === native.expected)).toBe(true);
        }
    });
}
