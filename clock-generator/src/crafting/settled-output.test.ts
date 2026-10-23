import { describe, expect, it } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { quiet } from "./generate-blueprint-test-helpers";

// The first check of a clock measures one period after a warm-up; a clock that fails it is listed by the mean of its
// long run instead, and a clock that holds, or fails later, by what the check found
describe("the output a clock that fails its first check is listed by", () => {
    it("is the mean items a period of its long run, and the rate and the check say so", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const generated = generateClockAlternatives(config, { logger: quiet });
        const failed = generated.alternatives.filter(it => it.result.stability_check.as_built?.output_basis !== undefined);
        expect(failed.length).toBeGreaterThan(0);
        for (const alternative of failed) {
            const as_built = alternative.result.stability_check.as_built!;
            expect(alternative.verdict).toBe("unstable");
            expect(as_built.holds).toBe(false);
            expect(as_built.first_check_failed).toBe(true);
            expect(["long-run mean", "one period"]).toContain(as_built.output_basis);
            const copies = config.target_output.copies ?? 1;
            expect(alternative.assessment.items_per_second)
                .toBeCloseTo(as_built.actual_output_items * 60 * copies / alternative.result.simulation_duration.ticks, 6);
        }
        for (const alternative of generated.alternatives.filter(it => it.assessment.holds)) {
            expect(alternative.result.stability_check.as_built?.output_basis).toBeUndefined();
        }
    }, 120_000);
});
