import { beforeAll, describe, expect, test } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";

// The per-inserter counters are reported beside the wake-ups of each clock alternative and decide nothing: the split of
// each inserter's wake-ups by list adds up to its wake-ups, and the clock-level figures agree with the alternative.
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

describe("military science: the counters of each clock beside its wake-ups", () => {
    let generated: ClockAlternativesResult;
    let copies: number;
    beforeAll(async () => {
        const config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE);
        copies = config.target_output.copies ?? 1;
        generated = await generateClockAlternatives(config, { logger: quiet });
    });

    test("the wake-ups of each inserter are the sum of its input and output wake-ups", () => {
        const counted = generated.alternatives.filter(it => it.result.stability_check.as_built?.counters !== undefined);
        expect(counted.length).toBeGreaterThan(0);
        for (const alternative of counted) {
            const { wake_ups, counters } = alternative.result.stability_check.as_built!;
            expect(counters!.inserters.length, alternative.id).toBe(wake_ups!.inserters.length);
            let input = 0;
            let output = 0;
            for (const count of counters!.inserters) {
                const wakes = wake_ups!.inserters.find(it => it.inserter_id === count.inserter_id)!;
                expect(count.input_wake_ups_per_minute + count.output_wake_ups_per_minute, `${alternative.id} ${count.inserter_id}`).toBeCloseTo(wakes.wake_ups_per_minute, 9);
                input += count.input_wake_ups_per_minute;
                output += count.output_wake_ups_per_minute;
            }
            expect(input + output, alternative.id).toBeCloseTo(wake_ups!.wake_ups_per_minute, 6);
        }
    });

    test("the clock-level figures agree with the alternative, and every wired inserter has a width", () => {
        for (const alternative of generated.alternatives) {
            const counters = alternative.result.stability_check.as_built?.counters;
            if (counters === undefined) {
                continue;
            }
            expect(counters.deciders, alternative.id).toBe(alternative.deciders);
            expect(counters.copies).toBe(copies);
            expect(counters.wired_inserters + counters.unwired_inserters).toBe(counters.inserters.length);
            const wired = counters.inserters.filter(it => it.network_width !== 0);
            expect(wired.length, alternative.id).toBe(counters.wired_inserters);
            for (const count of counters.inserters) {
                expect(count.network_width, count.inserter_id).not.toBeNull();
                expect(count.switch_ons_at_rest_per_minute + count.switch_ons_moving_per_minute).toBeCloseTo(count.switch_ons_per_minute, 9);
                expect(count.swings_per_minute).toBeLessThanOrEqual(count.grabs_per_minute + 1e-9);
                if (count.network_width === 0) {
                    expect(count.switch_ons_per_minute + count.switch_offs_per_minute).toBe(0);
                }
            }
        }
    });
});
