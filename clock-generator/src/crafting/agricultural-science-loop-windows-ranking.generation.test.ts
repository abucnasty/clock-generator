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

        it("counts a clock's windows without those of its feeders; under every taker order no clock of this variation holds and the 2-swing one is selected", () => {
            // With hands of 12 on the sample this was 354 windows with the feeders', 324 without: the 3-swing clock has
            // 336 and was selected while the fewest windows were, before the windows of the feeders were left out of the
            // count. Wake-ups decide now, which the windows of the feeders bring down, and the windows only between
            // clocks with the same wake-ups. Since the rules of issue 152 (a hand from a machine waits while the machine
            // it puts into is at its block) the sample with hands of 12 keeps no windows for its feeders, and the case is
            // made with egg biochambers at speed 80 and feeder hands of 8: 118 windows with the feeders', 108 without.
            //
            // Under the fixed order the planned-belt-slack clock is a 3,360-tick one (unstable) and the 5-swing clock
            // (swings-5, 480 ticks) reads 108 windows with and without the feeders'. The 5-swing clock no longer holds. The simulator serves the takers of one
            // machine in a fixed order and judges a clock under every order (docs/simulator.md, docs/stability.md):
            // under "ascending" (the loop's taker first) the 5-swing clock makes 399 of 400, so it is unstable, and no
            // clock of this variation holds under every order. The game was not run on this variation, and it serves
            // takers that both hold part of a hand in a varying order that the simulator does not model yet (0.24.0), so
            // the verdict may be stricter than the game's. The 2-swing clock is selected with "no recovery" (nutrients
            // stop arriving), where the 5-swing one was before the fixed order (GOALS.md, "Backpressure Loss").
            const config: Config = {
                ...sample,
                machines: sample.machines.map(it => it.id === 3 || it.id === 4 ? { ...it, crafting_speed: 80 } : it),
                inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 8 } : it),
            };
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const five_swings = alternatives.find(it => it.id === "swings-5")!;
            const three_swings = alternatives.find(it => it.id === "swings-3")!;
            expect(five_swings.verdict).toBe("unstable");
            expect(five_swings.inserter_window_count).toBe(108);
            expect(five_swings.ranking_window_count).toBe(108);
            expect(five_swings.result.simulation_duration.ticks).toBe(480);
            expect(three_swings.ranking_window_count).toBe(336);
            expect(three_swings.verdict).toBe("unstable");
            expect(alternatives.filter(it => it.verdict === "stable")).toEqual([]);
            const selected = alternatives[selected_index];
            expect(selected.id).toBe("swings-2");
            expect(selected.verdict).toBe("no recovery");
            expect(selected.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["nutrients stops arriving"] });
        });
    });
});
