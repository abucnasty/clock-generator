import { beforeAll, describe, expect, test } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { clockHash, readControls } from "../../tests/game/builds/clock-controls";

// The scrap silo sample: a recycler on scrap at +300% productivity destroys 2 scrap a second and places its twelve
// results into a rocket silo, one filter stack inserter for each result out of it. The results come too rarely for the
// takers' hands to come out whole in any period the silo holds, so each taker gets one window a period, worked out by
// arithmetic (result-windows.ts), and the simulator runs the windows for 20 periods. About half a minute: a result's
// output is not taken away for 4 periods in its loss trials, and the backlog has to drain at its window's margin.
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
let generated: ClockAlternativesResult;

beforeAll(async () => {
    generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.RECYCLING_SCRAP_SILO), { logger: quiet });
});

describe("scrap recycled into a rocket silo", () => {
    test("gets results in turn by arithmetic, bringing 2 scrap a second and recovering", () => {
        expect(generated.alternatives.map(it => [it.id, it.label, it.result.simulation_duration.ticks, it.verdict, it.assessment.items_per_second]))
            .toEqual([
                ["results-in-turn", "Results in turn: 12 hands brought in per cycle", 5760, "stable", 2],
            ]);
        expect(generated.skipped_searches).toEqual([]);
        for (const alternative of generated.alternatives) {
            expect(alternative.result.result_windows!.holds, alternative.id).toBe(true);
            expect(alternative.assessment.backpressure_loss?.survives, alternative.id).toBe(true);
        }
    });

    test("puts every result into the silo and takes each out as it comes, over the 20 periods the simulator runs", () => {
        for (const alternative of generated.alternatives) {
            const [taken] = alternative.result.stability_check.as_built!.results_taken!;
            expect(taken.waiting_ticks, alternative.id).toBe(0);
            expect(taken.takers.filter(it => it.short), alternative.id).toEqual([]);
            expect(taken.takers).toHaveLength(12);
        }
    });
});

// the clocks the game's four hours were recorded on (tests/game/builds/scrap-silo-clock-controls.json)
describe("the clocks the scrap silo's hours in the game ran", () => {
    const controls = readControls("scrap-silo-clock-controls.json");
    for (const [name, id] of [["scrap-silo-results-in-turn", "results-in-turn"]] as const) {
        test(`${name} is still made`, () => {
            const pin = controls.cases[name].generation!;
            const alternative = generated.alternatives.find(it => it.id === id)!;
            expect(clockHash(alternative.result.subtick ?? alternative.result), "the clock recorded in the game").toBe(pin.clock_sha256);
            expect(alternative.verdict).toBe(pin.verdict);
            expect(alternative.result.simulation_duration.ticks).toBe(pin.period);
        });
    }
});
