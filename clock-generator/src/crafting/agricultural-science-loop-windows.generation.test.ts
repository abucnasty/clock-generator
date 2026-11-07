import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, drawWindowTicks, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { Entity } from "../entities";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { quiet } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The inserters that take out of the egg loop (9 and 10, into the science biochamber) get windows where the machine
    // they put into was under its output block in the clock's long run, as long as it takes to draw their hands under
    // its insertion limit, kept only when the clock passes the as-built check with them as it did without
    // (trialWithLoopWindows). The inserters of the loop itself (5 and 8) take turns after them (inLoopInserterWindows),
    // kept only where the check passes with them as without and with each set of the loop's windows moved a tick. The
    // test that ranks the alternatives with and without them takes minutes, so it is in a file of its own:
    // agricultural-science-loop-windows-ranking.generation.test.ts.
    describe("agricultural science: windows for the inserters of the egg loop and those that take out of it", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250);
        const five_swings = (config: Config): Config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: 5 } });
        const out_of_the_loop = ["inserter:10", "inserter:9"];
        const of_the_loop = ["inserter:5", "inserter:8"];
        let looped: BlueprintGenerationResult;

        beforeAll(() => {
            looped = generateClockForConfig(five_swings(sample), { verify_as_built: true, logger: quiet });
        });

        it("generates a build with a dedicated fuel inserter in bounded time (under 150 seconds), and stable", () => {
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
            // 60 s before the enable windows were shaped against ghost wakeups; 64.7 s and 101.8 s on CI since, 35.6 s on a quiet machine (#695)
            expect(Date.now() - started).toBeLessThan(150_000);
            expect(result.stability_check.as_built?.holds).toBe(true);
        }, 200_000);

        it("plans the nutrient inserters 30.652 hands needed per 480 ticks on every clock, 61.304 per 960 on the 2-swing clock", () => {
            for (const [swings, window_cycle_ticks] of [[5, 480], [1, 480], [2, 960]] as const) {
                const result = generateClockForConfig({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: swings } }, { logger: quiet });
                const plan = result.output_cycle_plan;
                const planned = Array.from(plan.entity_transfer_map.values()).find(it => it.entity.entity_id.id === "inserter:3")!;
                expect(result.simulation_duration.ticks).toBe(window_cycle_ticks);
                expect(planned.needed_transfer_count!.toDecimal() * window_cycle_ticks / plan.total_duration.ticks).toBeCloseTo(30.652 * window_cycle_ticks / 480, 6);
                // the output inserter has none
                const output = Array.from(plan.entity_transfer_map.values()).find(it => it.entity.entity_id.id === "inserter:12")!;
                expect(output.needed_transfer_count).toBeUndefined();
            }
        });

        // The planning run lets the loop run free and makes 416 of the 400 a window cycle; the windows go by the clock-only
        // check alone, which holds. Under the new dispatch the turns of 5 and 8 no longer pass the check, so only 9 and 10
        // get windows and the loop's own inserters stay always enabled.
        it("gives 9 and 10 windows on the 5-swing clock of the sample, where its planning run does not hold, and 5 and 8 none", () => {
            expect(looped.stability_check.actual_output_items).toBe(416);
            expect(looped.stability_check.as_built?.holds).toBe(true);
            expect(looped.loop_windows?.inserter_ids.slice().sort()).toEqual(out_of_the_loop.slice().sort());
            expect(looped.loop_windows?.in_loop_ids).toBeUndefined();
            for (const id of out_of_the_loop) {
                expect(Object.keys(looped.clock_windows)).toContain(id);
                expect(looped.always_on_reasons?.[id]).toBeUndefined();
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

        // 9 and 10 bring 32 eggs in each stretch, the science biochamber draws 160 a window cycle, a third of an egg a tick, and
        // takes eggs while it holds fewer than 28: the second hand fits once it has drawn 5, in 15 ticks; and 5 for a hand
        it("makes the windows as long as the science biochamber needs to draw the hands of a stretch under its insertion limit", () => {
            const registry = createEntityRegistryFromConfig(sample);
            const inserter = registry.getAll().filter(Entity.isInserter).find(it => it.entity_id.id === "inserter:9")!;
            expect(drawWindowTicks(inserter, 28, 32, 1 / 3)).toBe(20);
            expect(drawWindowTicks(inserter, 28, 16, 1 / 3)).toBe(5);
        });

        it("keeps them always enabled where the clock-only check does not hold: 3 output swings each output cycle", () => {
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

        it("does not clock them when the windows of the loop are turned off", () => {
            const result = generateClockForConfig(five_swings(sample), { verify_as_built: true, loop_windows: false, logger: quiet });
            expect(result.loop_windows).toBeUndefined();
            for (const id of [...out_of_the_loop, ...of_the_loop]) {
                expect(Object.keys(result.clock_windows)).not.toContain(id);
            }
        });

        // the clock a loss trial that fails with the loop's own windows is made again as
        it("clocks only 9 and 10 when only the windows out of the loop are asked for", () => {
            const result = generateClockForConfig(five_swings(sample), { verify_as_built: true, loop_windows: "out-of-loop", logger: quiet });
            expect(result.loop_windows?.inserter_ids.slice().sort()).toEqual(out_of_the_loop);
            expect(result.loop_windows?.in_loop_ids).toBeUndefined();
            for (const id of of_the_loop) {
                expect(Object.keys(result.clock_windows)).not.toContain(id);
                expect(result.always_on_reasons?.[id]).toEqual({ kind: "loop" });
            }
        });
    });
});
