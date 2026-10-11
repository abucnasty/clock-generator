import { describe, it, expect } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The windows of the inserters that bring eggs to the science biochamber are an optimisation: kept only when the clock
    // passes the as-built check with them as it did without. Variations of the agricultural science sample, 5 output swings.
    // This test is apart from the rest of the describe, in agricultural-science-feeders.generation.test.ts: it takes three
    // minutes, the longest of the suite, which would hold up the others.
    describe("agricultural science: windows for the inserters feeding the output machine", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);

        it("counts a clock's windows without those of its feeders with hands of 12, where the clock with them has the fewest wake-ups of those that hold", () => {
            // 354 windows with the feeders', 324 without: the 3-swing clock has 336 and was selected while the fewest
            // windows were, before the windows of the feeders were left out of the count. Wake-ups decide now, which the
            // windows of the feeders bring down, and the windows only between clocks with the same wake-ups.
            //
            // The 3-swing clock held the target rate in the simulator until it had the tick an inserter takes to wake
            // when the output inserter clears its machine (see IdleModeTransitionEvaluator). With that tick it makes
            // 247.5 of 250 a second and is out of the running: among the clocks that hold, the 5-swing one has the
            // fewest wake-ups and the fewest windows both.
            //
            // It was the one selected until a clock had to get back from a backpressure loss as well (GOALS.md): under
            // it the build does not get back to its rate once the nutrients have run out, and the 2-swing clock is selected.
            const config: Config = { ...sample, inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 12 } : it) };
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const five_swings = alternatives.find(it => it.id === "planned-belt-slack")!;
            const three_swings = alternatives.find(it => it.id === "swings-3")!;
            expect(five_swings.verdict).not.toBe("unstable");
            expect(five_swings.inserter_window_count).toBe(354);
            expect(five_swings.ranking_window_count).toBe(324);
            expect(Object.keys(five_swings.result.clock_windows)).toContain("inserter:9");
            expect(three_swings.ranking_window_count).toBe(336);
            expect(three_swings.verdict).toBe("unstable");
            for (const other of alternatives.filter(it => it.verdict !== "unstable" && it !== five_swings)) {
                expect(five_swings.assessment.wake_ups_per_minute!).toBeLessThan(other.assessment.wake_ups_per_minute!);
            }
            expect(five_swings.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["nutrients stops arriving"] });
            expect(alternatives[selected_index].id).toBe("swings-2");
            expect(alternatives[selected_index].verdict).toBe("stable");
        });
    });
});
