import { describe, it, expect } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The windows of the inserters of the egg loop are an optimisation: kept only when the clock passes the as-built
    // check with them as it did without. Variations of the agricultural science sample, 5 output swings. This test is
    // apart from the rest of the describe, in agricultural-science-loop-windows.generation.test.ts: it takes three
    // minutes, the longest of the suite, which would hold up the others.
    describe("agricultural science: windows for the inserters of the egg loop", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);

        it("counts a clock's windows without those of its feeders; the 5-swing clock does not get back from the nutrients loss and the 2-swing one is selected", () => {
            // With hands of 12 on the sample this was 354 windows with the feeders', 324 without: the 3-swing clock has
            // 336 and was selected while the fewest windows were, before the windows of the feeders were left out of the
            // count. Wake-ups decide now, which the windows of the feeders bring down, and the windows only between
            // clocks with the same wake-ups. Since the rules of issue 152 (a hand from a machine waits while the machine
            // it puts into is at its block) the sample with hands of 12 keeps no windows for its feeders, and the case is
            // made with egg biochambers at speed 80 and feeder hands of 8: 118 windows with the feeders', 108 without.
            //
            // The batched 5-swing clock (480 ticks) reads 108 windows with and without the feeders'. The simulator serves
            // the takers of one machine in the order the game serves them and judges a clock under every order
            // (docs/simulator.md, docs/stability.md): the 5-swing clock holds but does not get back after the nutrients
            // stop arriving, and the 3-swing clock does not hold. The clocks of 1 and 2 swings get back from every loss and
            // the 2-swing clock is selected (GOALS.md, "Backpressure Loss").
            const config: Config = {
                ...sample,
                machines: sample.machines.map(it => it.id === 3 || it.id === 4 ? { ...it, crafting_speed: 80 } : it),
                inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 8 } : it),
            };
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const five_swings = alternatives.find(it => it.id === "planned-belt-slack")!;
            const three_swings = alternatives.find(it => it.id === "swings-3")!;
            expect(five_swings.verdict).toBe("no recovery");
            expect(five_swings.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["nutrients stops arriving"] });
            expect(five_swings.inserter_window_count).toBe(108);
            expect(five_swings.ranking_window_count).toBe(108);
            expect(five_swings.result.simulation_duration.ticks).toBe(480);
            expect(three_swings.ranking_window_count).toBe(336);
            expect(three_swings.verdict).toBe("unstable");
            expect(alternatives.filter(it => it.verdict === "stable").map(it => it.id).sort()).toEqual(["swings-1", "swings-2"]);
            const selected = alternatives[selected_index];
            expect(selected.id).toBe("swings-2");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.backpressure_loss).toMatchObject({ survives: true, broken_by: [] });
        });
    });
});
