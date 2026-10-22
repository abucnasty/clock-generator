import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {carCases} from "../../tests/game/builds/car-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";

// each clock pinned beside the in-game recording of it
const controls = readControls("car-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let generated: ClockAlternativesResult;

beforeAll(async () => {
    generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_CAR), {logger: quiet});
}, 120_000);

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
