import path from "path";
import { beforeAll, describe, expect, test } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { backpressureLossOf } from "./trial";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { RANDOM_MARGIN_SIGMAS } from "./random-margins";

// The exact-speed recycler cell of the ore voider benchmark (save F, the benchmark's waste inserters clocked): a recycler at
// crafting speed 16.875 (540 crafts a second) destroys 400 iron ore a second, brought in by four stack inserters from the
// ore supply; it places what it gives back (a quarter of its crafts, at random) into a car, which two stack inserters
// empty back into it. Planned by arithmetic on the expected amounts, with room in the windows for the spread.
const FIXTURE = path.join(__dirname, "fixtures", "ore-voider-F-recycler.json");
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
let config: Config;
let generated: ClockAlternativesResult;

beforeAll(async () => {
    config = await loadConfigFromFile(FIXTURE);
    generated = generateClockAlternatives(config, { logger: quiet });
});

describe("a recycler that voids iron ore at exact speed", () => {
    test("gets its batched clock and even hands, both planned on the same hands, and nothing searched", () => {
        expect(generated.alternatives.map(it => it.id)).toEqual(["planned-belt-slack", "even-hands"]);
        expect(generated.skipped_searches).toEqual([]);
        for (const alternative of generated.alternatives) {
            // 15 hands of each feeding inserter a 144-tick period: 960 ore, 400 a second
            expect(alternative.result.simulation_duration.ticks, alternative.id).toBe(144);
            expect(alternative.result.stability_check.expected_output_items, alternative.id).toBe(960);
            expect(alternative.assessment.holds, alternative.id).toBe(true);
            expect(alternative.assessment.items_per_second, alternative.id).toBe(400);
            expect(alternative.verdict, alternative.id).toBe("stable");
        }
    });

    test("selects even hands, which wakes no inserter", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("even-hands");
        expect(selected.assessment.wake_ups_per_minute).toBe(0);
    });

    test("gives the windows that take the returns out of the car three standard deviations of room or more", () => {
        for (const alternative of generated.alternatives) {
            const margins = alternative.result.random_margins!;
            expect(margins.windows.map(it => it.item), alternative.id).toEqual(["iron-ore"]);
            const [returns] = margins.windows;
            expect(returns.expected_items).toBe(320);
            expect(returns.sigma_items).toBeCloseTo(15.4919, 4);
            expect(returns.sigmas, alternative.id).toBeGreaterThanOrEqual(RANDOM_MARGIN_SIGMAS);
            // the recycler's own room is one standard deviation a period, three over 1216 ticks, which the car takes up
            expect(margins.crafting[0].sigmas).toBeCloseTo(1.0328, 4);
            expect(margins.crafting[0].ticks_to_cover).toBe(1216);
        }
        // even hands' windows take one hand each: two of each taker's ten get a swing more
        expect(generated.alternatives[1].result.random_margins!.windows[0].added_hands).toBe(2);
    });

    test("is back at 960 ore a period after the ore stops coming, on every clock", () => {
        for (const alternative of generated.alternatives) {
            const report = backpressureLossOf(config, alternative.result.clock_windows, 144, 960, quiet);
            expect(report.losses.map(it => [it.loss, it.recovers]), alternative.id).toEqual([[{ kind: "supply", item: "iron-ore" }, true]]);
        }
    });
});
