import { describe, it, expect } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The windows of the inserters that bring eggs to the science biochamber are an optimisation: kept only when the clock
    // passes the as-built check with them as it did without. Variations of the agricultural science sample, 5 output swings.
    // This test is apart from the rest of the describe, in agricultural-science-feeders.test.ts: it takes over a minute,
    // which would hold up the others.
    describe("agricultural science: windows for the inserters feeding the output machine", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);

        it("selects the clock with the fewest wake-ups with hands of 12, though the windows of the feeders give it more windows", () => {
            // 354 windows with the feeders', 324 without: the 3-swing clock has 336 and was selected while the fewest
            // windows were, before the windows of the feeders were left out of the count. Wake-ups decide now, which the
            // windows of the feeders bring down, and the windows only between clocks with the same wake-ups.
            //
            // The 3-swing clock held the target rate in the simulator until it had the tick an inserter takes to wake
            // when the output inserter clears its machine (see IdleModeTransitionEvaluator). With that tick it makes
            // 247.5 of 250 a second and is out of the running: among the clocks that hold, the selected one has the
            // fewest wake-ups and the fewest windows both.
            const config: Config = { ...sample, inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 12 } : it) };
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const selected = alternatives[selected_index];
            const three_swings = alternatives.find(it => it.id === "swings-3")!;
            expect(selected.id).toBe("planned-belt-slack");
            expect(selected.inserter_window_count).toBe(354);
            expect(selected.ranking_window_count).toBe(324);
            expect(Object.keys(selected.result.clock_windows)).toContain("inserter:9");
            expect(three_swings.ranking_window_count).toBe(336);
            expect(three_swings.meets_target_rate).toBe(false);
            for (const other of alternatives.filter(it => it.meets_target_rate && it !== selected)) {
                expect(selected.wake_ups_per_minute!).toBeLessThan(other.wake_ups_per_minute!);
            }
        }, 240_000);
    });
});
