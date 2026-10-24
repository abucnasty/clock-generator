import { beforeAll, describe, expect, test } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";

// The scrap silo sample: a recycler on scrap at +300% productivity destroys 2 scrap a second and places its twelve
// results into a rocket silo, one filter stack inserter for each result out of it. The results come too rarely for the
// takers' hands to come out whole in any period the silo holds, so each taker gets one window a period, worked out by
// arithmetic (result-windows.ts), and the simulator runs the windows for 20 periods. About two minutes, nearly all of it
// the loss trials of the twelve results (the build takes up to 200 periods to stop with copper cable not taken away).
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
let generated: ClockAlternativesResult;

beforeAll(async () => {
    generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.RECYCLING_SCRAP_SILO), { logger: quiet });
});

describe("scrap recycled into a rocket silo", () => {
    test("gets results in turn and all results at once, both by arithmetic, both bringing 2 scrap a second and recovering", () => {
        expect(generated.alternatives.map(it => [it.id, it.label, it.result.simulation_duration.ticks, it.verdict, it.assessment.items_per_second]))
            .toEqual([
                ["results-in-turn", "Results in turn: 12 hands brought in per cycle", 5760, "stable", 2],
                ["all-results-at-once", "All results at once: 9 hands brought in per cycle", 4320, "stable", 2],
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

    test("selects results in turn, whose takers wait at the silo for fewer of its placings than all at once", () => {
        expect(generated.alternatives[generated.selected_index].id).toBe("results-in-turn");
        const [in_turn, at_once] = generated.alternatives.map(it => it.assessment.wake_ups_per_minute!);
        expect(in_turn).toBeLessThan(at_once / 3);
    });
});
