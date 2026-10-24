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

        it("counts a clock's windows without those of its feeders, where the clock with them has the fewest wake-ups of those that hold", () => {
            // With hands of 12 on the sample this was 354 windows with the feeders', 324 without: the 3-swing clock has
            // 336 and was selected while the fewest windows were, before the windows of the feeders were left out of the
            // count. Wake-ups decide now, which the windows of the feeders bring down, and the windows only between
            // clocks with the same wake-ups. Since the rules of issue 152 (a hand from a machine waits while the machine
            // it puts into is at its block) the sample with hands of 12 keeps no windows for its feeders, and the case is
            // made with egg biochambers at speed 80 and feeder hands of 8: 118 windows with the feeders', 108 without.
            //
            // Among the clocks that hold, the 5-swing one has the fewest wake-ups. Under it the build gets back to its rate
            // from every loss since a trial short only late in its 40 periods runs on (docs/stability.md), and it is
            // selected; before, the 2-swing clock was (GOALS.md, "Backpressure Loss").
            const config: Config = {
                ...sample,
                machines: sample.machines.map(it => it.id === 3 || it.id === 4 ? { ...it, crafting_speed: 80 } : it),
                inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 8 } : it),
            };
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const five_swings = alternatives.find(it => it.id === "planned-belt-slack")!;
            const three_swings = alternatives.find(it => it.id === "swings-3")!;
            expect(five_swings.verdict).not.toBe("unstable");
            expect(five_swings.inserter_window_count).toBe(118);
            expect(five_swings.ranking_window_count).toBe(108);
            expect(Object.keys(five_swings.result.clock_windows)).toContain("inserter:9");
            expect(three_swings.ranking_window_count).toBe(336);
            expect(three_swings.verdict).toBe("unstable");
            for (const other of alternatives.filter(it => it.verdict !== "unstable" && it !== five_swings)) {
                expect(five_swings.assessment.wake_ups_per_minute!).toBeLessThan(other.assessment.wake_ups_per_minute!);
            }
            expect(five_swings.assessment.backpressure_loss).toMatchObject({ survives: true, broken_by: [] });
            expect(alternatives[selected_index].id).toBe("planned-belt-slack");
            expect(alternatives[selected_index].verdict).toBe("stable");
        });
    });
});
