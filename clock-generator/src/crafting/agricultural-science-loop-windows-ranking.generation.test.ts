import { describe, it, expect } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { TestConfigPaths } from "../../tests/configs/paths";
import { ConfigPaths } from "../config/config-paths";
import { planClockAlternatives, runClockAlternativeTask } from "./alternatives";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The windows of the inserters of the egg loop are an optimisation: kept only when the clock passes the as-built
    // check with them as it did without. Variations of the agricultural science sample, 5 output swings. This test is
    // apart from the rest of the describe, in agricultural-science-loop-windows.generation.test.ts: it takes three
    // minutes, the longest of the suite, which would hold up the others.
    describe("agricultural science: windows for the inserters of the egg loop", async () => {
        // the sample's config before it stated its build of five copies: on the five-copy config the 5-swing clock holds without
        // windows on the loop, so the windows of the loop do not show there
        const sample = await loadConfigFromFile(TestConfigPaths.AGRICULTURAL_SCIENCE_250_BIOFLUX_ON_NEAR_LANE);

        it("counts a clock's windows without those of its feeders; the 5-swing clock does not go back to its rate by itself after a supply stop or an output blockage and Coordinated Sources is selected", () => {
            // With hands of 12 on the sample this was 354 windows with the feeders', 324 without: the 3-swing clock has
            // 336 and was selected while the fewest windows were, before the windows of the feeders were left out of the
            // count. Wake-ups decide now, which the windows of the feeders bring down, and the windows only between
            // clocks with the same wake-ups. Since the rules of issue 152 (a hand from a machine waits while the machine
            // it puts into is at its block) the sample with hands of 12 keeps no windows for its feeders, and the case is
            // made with egg biochambers at speed 80 and feeder hands of 8: 118 windows with the feeders', 108 without.
            //
            // The batched 5-swing clock (480 ticks) reads 100 windows with and without the feeders'. The simulator serves
            // the takers of one machine in the order the game serves them and judges a clock under every order
            // (docs/simulator.md, docs/stability.md): the 5-swing clock holds but does not get back after the bioflux
            // stops arriving, and the 3-swing clock does not hold. The clocks of 1 and 2 swings get back from every loss
            // (GOALS.md, "Backpressure Loss"), and so does Coordinated Sources, which wakes 4,276.538 times a minute where
            // the 2-swing clock wakes 4,403.000: it is selected. All of these are verdicts of the simulator.
            const config: Config = {
                ...sample,
                machines: sample.machines.map(it => it.id === 3 || it.id === 4 ? { ...it, crafting_speed: 80 } : it),
                inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 8 } : it),
            };
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const five_swings = alternatives.find(it => it.maker === "planned-belt-slack")!;
            const three_swings = alternatives.find(it => it.maker === "swings-3")!;
            expect(five_swings.verdict).toBe("no recovery");
            // its windows shaped against ghost wakeups (#641) wake fewer and do not get back from the bioflux loss; the
            // planned windows broke on the nutrients loss, the first tried
            expect(five_swings.assessment.disturbance_trial).toMatchObject({ survives: false, broken_by: ["bioflux stops arriving"] });
            // 108 windows before 8 were dropped against ghost wakeups (#641)
            expect(five_swings.inserter_window_count).toBe(100);
            expect(five_swings.ranking_window_count).toBe(100);
            expect(five_swings.result.simulation_duration.ticks).toBe(480);
            expect(three_swings.ranking_window_count).toBe(336);
            expect(three_swings.verdict).toBe("unstable");
            expect(alternatives.filter(it => it.verdict === "stable").map(it => it.maker).sort()).toEqual(["per-branch", "swings-1", "swings-2"]);
            const selected = alternatives[selected_index];
            expect(selected.maker).toBe("per-branch");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.disturbance_trial).toMatchObject({ survives: true, broken_by: [] });
        });
    });

    // #516: the sample of five copies, its clock tried from the starts of the start-dependence check too; the Time-Study
    // Windows alone are made after the primary clock, as the page makes each alternative
    describe("agricultural science, five copies: a clock with windows on all four egg inserters", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250);
        const config: Config = { ...sample, overrides: { ...sample.overrides, check_start_dependence: true } };

        // On the clock of one output swing (an output window every 19.2 ticks) the science biochamber is under its block
        // nearly all the time, so 9 and 10 get a window a hand, 20 ticks of every 96, placed where the clock holds with them;
        // 5 and 8 take turns after each output window, 11 ticks of every 19.2, which leaves an egg biochamber 9 ticks
        // without a window of its feeder: it holds a craft's egg to spare and more (loopStockShortOf). The clock holds from
        // every start and gets back from every loss on every copy.
        it("offers Time-Study Windows with windows on 5, 8, 9 and 10, stable from every start and every loss, with a craft to spare", () => {
            const { context } = planClockAlternatives(config, { logger: quiet });
            const windowed = runClockAlternativeTask(config, context, "derived", { logger: quiet })!.alternatives[0];
            expect(windowed.maker).toBe("derived");
            expect(windowed.result.loop_windows?.inserter_ids.slice().sort()).toEqual(["inserter:10", "inserter:5", "inserter:8", "inserter:9"]);
            expect(windowed.result.loop_windows?.in_loop_ids?.slice().sort()).toEqual(["inserter:5", "inserter:8"]);
            expect(windowed.verdict).toBe("stable");
            expect(windowed.assessment.start_dependence?.verdict).toBe("stable");
            expect(windowed.assessment.disturbance_trial).toMatchObject({ survives: true, broken_by: [] });
            expect(windowed.assessment.shared_lane_losses ?? []).toEqual([]);
            expect(windowed.assessment.loop_stock_bound!.sink_stock_margin_crafts).toBeGreaterThanOrEqual(0);
            for (const id of ["inserter:5", "inserter:8", "inserter:9", "inserter:10"]) {
                expect(windowed.result.clock_windows[id]?.length ?? 0).toBeGreaterThan(0);
            }
        }, 1_200_000);
    });
});
