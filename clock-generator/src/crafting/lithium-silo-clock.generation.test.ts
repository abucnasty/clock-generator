import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {lithiumSiloCases} from "../../tests/game/builds/lithium-silo-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";

// each clock pinned beside the in-game recording of it
const controls = readControls("lithium-silo-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let generated: ClockAlternativesResult;

beforeAll(async () => {
    generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_LITHIUM_SILO), {logger: quiet});
}, 120_000);

test("lithium silo: the clock with 3 output swings is selected", () => {
    expect(generated.alternatives[generated.selected_index].id).toBe("swings-3");
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
        expect(native.expected).toBe(expected.expected);
        // the game holds the target in every baseline period and is back at it in every judged period after each
        // disturbance, but for the known limit, where it is short in every one
        const holds = variant.known_limit === undefined;
        expect(native.baseline.every(items => items === native.expected)).toBe(holds);
        expect(native.baseline.some(items => items === native.expected)).toBe(holds);
        for (const loss of native.recovery) {
            expect(loss.during).toContain(0);
            expect(loss.recovered.length).toBeGreaterThanOrEqual(9);
            expect(loss.recovered.every(items => items === native.expected)).toBe(holds);
        }
    });
}
