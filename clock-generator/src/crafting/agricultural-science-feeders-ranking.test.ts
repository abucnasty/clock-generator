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

        it("selects the same alternative with hands of 12 as without the windows of the feeders: they are not ranked by", () => {
            // 354 windows with the feeders', 324 without: the 3-swing clock has 336 and used to be selected
            const config: Config = { ...sample, inserters: sample.inserters.map(it => it.id === 9 || it.id === 10 ? { ...it, stack_size: 12 } : it) };
            const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
            const selected = alternatives[selected_index];
            expect(selected.id).toBe("planned-belt-slack");
            expect(selected.inserter_window_count).toBe(354);
            expect(selected.ranking_window_count).toBe(324);
            expect(Object.keys(selected.result.clock_windows)).toContain("inserter:9");
            expect(alternatives.find(it => it.id === "swings-3")!.ranking_window_count).toBe(336);
        }, 240_000);
    });
});
