import { describe, it, expect } from "vitest";
import { generateClockForConfig, OUTPUT_FEEDER_CHECK_TICKS, rankingWindowCount, feedersOfOutputMachines, anyFeederCarriesFuel, hasPlannedWindowsNotHands } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import type { Inserter } from "../entities";
import { quiet } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The windows of the inserters that bring eggs to the science biochamber are an optimisation: kept only when the clock
    // passes the as-built check with them as it did without. Variations of the agricultural science sample, 5 output swings.
    // The test that ranks the alternatives with and without them takes over a minute, so it is in a file of its own:
    // agricultural-science-feeders-ranking.test.ts.
    describe("agricultural science: windows for the inserters feeding the output machine", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const five_swings = (config: Config): Config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: 5 } });
        const feeders = ["inserter:9", "inserter:10"];

        it("generates a build with a dedicated fuel inserter in bounded time (under a minute), and stable", () => {
            // inserter 11 brings bioflux only and a new one nutrients, which the science biochamber burns
            const config: Config = {
                ...sample,
                inserters: [
                    ...sample.inserters.map(it => it.id === 11 ? { ...it, filters: ["bioflux"] } : it),
                    { id: 13, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 5 }, stack_size: 16, filters: ["nutrients"] },
                ],
            };
            const started = Date.now();
            const result = generateClockForConfig(five_swings(config), { verify_as_built: true, logger: quiet });
            expect(Date.now() - started).toBeLessThan(60_000);
            expect(result.stability_check.is_stable).toBe(true);
        }, 120_000);

        it("plans the nutrient inserters 30.652 hands needed per 480 ticks on every clock, 61.304 per 960 on the 2-swing clock", () => {
            for (const [swings, period] of [[5, 480], [1, 480], [2, 960]] as const) {
                const result = generateClockForConfig({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: swings } }, { logger: quiet });
                const plan = result.crafting_cycle_plan;
                const planned = Array.from(plan.entity_transfer_map.values()).find(it => it.entity.entity_id.id === "inserter:3")!;
                expect(result.simulation_duration.ticks).toBe(period);
                expect(planned.needed_transfer_count!.toDecimal() * period / plan.total_duration.ticks).toBeCloseTo(30.652 * period / 480, 6);
                // the output inserter has none
                const output = Array.from(plan.entity_transfer_map.values()).find(it => it.entity.entity_id.id === "inserter:12")!;
                expect(output.needed_transfer_count).toBeUndefined();
            }
        }, 120_000);

        it("keeps the feeders always enabled where the clock with their windows does not pass, as without the rule", () => {
            // egg biochambers at speed 80 and hands of 12 into the science biochamber: with the windows the long run comes up short
            const config: Config = {
                ...sample,
                machines: sample.machines.map(it => it.id === 3 || it.id === 4 ? { ...it, crafting_speed: 80 } : it),
                inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 12 } : it),
            };
            const result = generateClockForConfig(five_swings(config), { verify_as_built: true, logger: quiet });
            expect(result.stability_check.is_stable).toBe(true);
            for (const id of feeders) {
                expect(Object.keys(result.clock_windows)).not.toContain(id);
            }
        }, 120_000);

        it("does not clock the feeders when the as-built check is off: nothing would have run them", () => {
            const result = generateClockForConfig(five_swings(sample), { verify_as_built: false, logger: quiet });
            for (const id of feeders) {
                expect(Object.keys(result.clock_windows)).not.toContain(id);
            }
        }, 120_000);

        it("clocks them when the as-built check is on and passes with them", () => {
            const result = generateClockForConfig(five_swings(sample), { verify_as_built: true, logger: quiet });
            expect(result.stability_check.as_built?.is_stable).toBe(true);
            for (const id of feeders) {
                expect(Object.keys(result.clock_windows)).toContain(id);
            }
        }, 120_000);

        it("verifies the clock with feeder windows over a longer run than the standard check: at least 72,000 ticks", () => {
            expect(OUTPUT_FEEDER_CHECK_TICKS).toBeGreaterThanOrEqual(72_000);
        });

        // Until the simulator had the tick an inserter takes to wake when the output inserter clears its machine (see
        // IdleModeTransitionEvaluator), this variant passed the standard check with feeder windows and came up a hand
        // short in two periods of 200 of the longer run, so that they were dropped. With that tick it holds through the
        // longer run. No variant tried since drops them (speeds 68 to 76, hands of 10 to 14, 4 to 6 swings): the ones
        // that hold keep them, the others hold with nothing.
        it("keeps feeder windows through the longer run with egg biochambers at speed 72 and hands of 12", () => {
            const config: Config = {
                ...sample,
                machines: sample.machines.map(it => it.id === 3 || it.id === 4 ? { ...it, crafting_speed: 72 } : it),
                inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 12 } : it),
            };
            const result = generateClockForConfig(five_swings(config), { verify_as_built: true, logger: quiet });
            expect(result.stability_check.is_stable).toBe(true);
            expect(result.output_feeders?.inserter_ids).toEqual(feeders);
            for (const id of feeders) {
                expect(Object.keys(result.clock_windows)).toContain(id);
            }
        }, 120_000);

        it("takes feeder windows on the prefer-planned path of the derive flow too", () => {
            const config: Config = { ...sample, overrides: { ...sample.overrides, derive_clock_windows: true } };
            const result = generateClockForConfig(five_swings(config), { logger: quiet });
            expect(result.derived_clock_windows?.kept_planned_windows).toBe(true);
            expect(result.output_feeders?.inserter_ids).toEqual(feeders);
            for (const id of feeders) {
                expect(Object.keys(result.clock_windows)).toContain(id);
            }
        }, 180_000);
    });

    describe("the pieces of the output feeder rule", () => {
        const inserter = (id: number, source: string, sink: string, filtered: string[] = []) => ({
            entity_id: { id: `inserter:${id}` },
            source: { entity_id: { id: source, type: source.split(":")[0] } },
            sink: { entity_id: { id: sink, type: sink.split(":")[0] } },
            filtered_items: new Set(filtered),
        }) as unknown as Inserter;

        it("counts the windows of the feeders as they are without their windows when it ranks", () => {
            const windows = { "inserter:1": [{ start: 0, end: 1 }], "inserter:9": [1, 2, 3, 4, 5].map(it => ({ start: it, end: it })) } as never;
            expect(rankingWindowCount(6, windows, undefined)).toBe(6);
            expect(rankingWindowCount(6, windows, { inserter_ids: ["inserter:9"], window_count_without_feeder_windows: 0 })).toBe(1);
            expect(rankingWindowCount(6, windows, { inserter_ids: ["inserter:9"], window_count_without_feeder_windows: 2 })).toBe(3);
        });

        it("limits the feeders to the inserters from a machine into an output machine", () => {
            const into_output = inserter(1, "machine:3", "machine:5");
            const into_other = inserter(2, "machine:3", "machine:4");
            const from_belt = inserter(3, "belt:1", "machine:5");
            const to_belt = inserter(4, "machine:5", "belt:2");
            expect(feedersOfOutputMachines([into_output, into_other, from_belt, to_belt], new Set(["machine:5"]))).toEqual([into_output]);
            expect(feedersOfOutputMachines([into_output, into_other], new Set(["machine:4", "machine:5"]))).toEqual([into_output, into_other]);
        });

        it("leaves every feeder of a sink alone when any of them can carry its fuel", () => {
            const eggs = inserter(1, "machine:3", "machine:5", ["pentapod-egg"]);
            const nutrients = inserter(2, "machine:3", "machine:5", ["nutrients", "pentapod-egg"]);
            expect(anyFeederCarriesFuel([eggs], "nutrients")).toBe(false);
            expect(anyFeederCarriesFuel([eggs, nutrients], "nutrients")).toBe(true);
            expect(anyFeederCarriesFuel([nutrients], undefined)).toBe(false);
        });

        it("skips an inserter whose windows are the plan's only in a build with always-enabled inserters", () => {
            expect(hasPlannedWindowsNotHands(new Set(["inserter:9"]), "inserter:3")).toBe(true);
            expect(hasPlannedWindowsNotHands(new Set(["inserter:9"]), "inserter:9")).toBe(false);
            expect(hasPlannedWindowsNotHands(new Set(), "inserter:3")).toBe(false);
        });
    });
});
