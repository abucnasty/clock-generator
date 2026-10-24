import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, LOOP_WINDOW_CHECK_TICKS, rankingWindowCount, anyFeederCarriesFuel, hasPlannedWindowsNotHands, drawWindowTicks, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { Entity, type Inserter } from "../entities";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { quiet } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The inserters that take out of the egg loop (9 and 10, into the science biochamber) get windows where the machine
    // they put into was under its output block in the clock's long run, as long as it takes to draw their hands under
    // its insertion limit, kept only when the clock passes the as-built check with them as it did without
    // (trialWithLoopWindows). The inserters of the loop itself (5 and 8) stay always enabled. The test that ranks the
    // alternatives with and without them takes minutes, so it is in a file of its own:
    // agricultural-science-loop-windows-ranking.generation.test.ts.
    describe("agricultural science: windows for the inserters that take out of the egg loop", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const five_swings = (config: Config): Config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: 5 } });
        const out_of_the_loop = ["inserter:10", "inserter:9"];
        const of_the_loop = ["inserter:5", "inserter:8"];
        let looped: BlueprintGenerationResult;

        beforeAll(() => {
            looped = generateClockForConfig(five_swings(sample), { verify_as_built: true, logger: quiet });
        });

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
            expect(result.stability_check.as_built?.holds).toBe(true);
        });

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
        });

        // The planning run lets the loop run free and makes 432 of the 400 a period; the windows go by the clock-only
        // check alone, which holds. Until they did, they were never tried on the sample.
        it("gives 9 and 10 windows on the 5-swing clock of the sample, where its planning run does not hold, and leaves 5 and 8 always on", () => {
            expect(looped.stability_check.actual_output_items).toBe(432);
            expect(looped.stability_check.as_built?.holds).toBe(true);
            expect(looped.loop_windows?.inserter_ids.slice().sort()).toEqual(out_of_the_loop);
            for (const id of out_of_the_loop) {
                expect(Object.keys(looped.clock_windows)).toContain(id);
            }
            for (const id of of_the_loop) {
                expect(Object.keys(looped.clock_windows)).not.toContain(id);
                expect(looped.always_on_reasons?.[id]).toEqual({ kind: "loop" });
            }
        });

        // The science biochamber's output is taken in 5 windows of 37 ticks (ticks 0 to 36 of every 96), and is under its
        // block of 28 from tick 25 of each, where the output inserter has taken it there (and at 17 to 19 now and then,
        // between two of its hands), to tick 62 or so, where the machine has made 28 again
        it("enables 9 and 10 for 20 ticks from where the science biochamber is under its output block, and 2 on each side", () => {
            const windows = looped.clock_windows["inserter:9"];
            expect(looped.clock_windows["inserter:10"]).toEqual(windows);
            expect(windows).toEqual([0, 96, 192, 288, 384].map(at => ({ start: at + 23, end: at + 46 })));
        });

        // 9 and 10 bring 32 eggs in each stretch, the science biochamber draws 160 a period, a third of an egg a tick, and
        // takes eggs while it holds fewer than 28: the second hand fits once it has drawn 5, in 15 ticks; and 5 for a hand
        it("makes the windows as long as the science biochamber needs to draw the hands of a stretch under its insertion limit", () => {
            const registry = createEntityRegistryFromConfig(sample);
            const inserter = registry.getAll().filter(Entity.isInserter).find(it => it.entity_id.id === "inserter:9")!;
            expect(drawWindowTicks(inserter, 28, 32, 1 / 3)).toBe(20);
            expect(drawWindowTicks(inserter, 28, 16, 1 / 3)).toBe(5);
        });

        it("keeps them always enabled where the clock-only check does not hold: 3 output swings per cycle", () => {
            const result = generateClockForConfig({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: 3 } }, { verify_as_built: true, logger: quiet });
            expect(result.stability_check.as_built?.holds).toBe(false);
            expect(result.loop_windows).toBeUndefined();
            for (const id of out_of_the_loop) {
                expect(Object.keys(result.clock_windows)).not.toContain(id);
            }
        });

        it("does not clock them when the as-built check is off: nothing would have run them", () => {
            const result = generateClockForConfig(five_swings(sample), { verify_as_built: false, logger: quiet });
            for (const id of out_of_the_loop) {
                expect(Object.keys(result.clock_windows)).not.toContain(id);
            }
        });

        it("does not clock them when the windows out of the loop are turned off", () => {
            const result = generateClockForConfig(five_swings(sample), { verify_as_built: true, loop_windows: false, logger: quiet });
            expect(result.loop_windows).toBeUndefined();
            for (const id of out_of_the_loop) {
                expect(Object.keys(result.clock_windows)).not.toContain(id);
            }
        });

        it("verifies the clock with the windows out of the loop over a longer run than the standard check: at least 72,000 ticks", () => {
            expect(LOOP_WINDOW_CHECK_TICKS).toBeGreaterThanOrEqual(72_000);
        });
    });

    describe("the pieces of the rule for the inserters out of a loop", () => {
        const inserter = (id: number, source: string, sink: string, filtered: string[] = []) => ({
            entity_id: { id: `inserter:${id}` },
            source: { entity_id: { id: source, type: source.split(":")[0] } },
            sink: { entity_id: { id: sink, type: sink.split(":")[0] } },
            filtered_items: new Set(filtered),
        }) as unknown as Inserter;

        it("counts the windows of the inserters out of a loop as they are without their windows when it ranks", () => {
            const windows = { "inserter:1": [{ start: 0, end: 1 }], "inserter:9": [1, 2, 3, 4, 5].map(it => ({ start: it, end: it })) } as never;
            expect(rankingWindowCount(6, windows, undefined)).toBe(6);
            expect(rankingWindowCount(6, windows, { inserter_ids: ["inserter:9"], window_count_without_loop_windows: 0 })).toBe(1);
            expect(rankingWindowCount(6, windows, { inserter_ids: ["inserter:9"], window_count_without_loop_windows: 2 })).toBe(3);
        });

        it("leaves every inserter out of the loop into a machine alone when any of them can carry its fuel", () => {
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
