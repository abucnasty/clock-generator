import { describe, expect, it } from "vitest";
import { CLOCK_STARTS, startVerdictOf } from "./start-dependence";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { quiet } from "./generate-blueprint-test-helpers";

describe("a build generated with and without the check", () => {
    it("tries every clock from every start when the config asks, the cold start deciding its own entry", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const config = { ...sample, overrides: { ...sample.overrides, check_start_dependence: true } };
        const generated = generateClockAlternatives(config, { logger: quiet });
        expect(generated.start_dependence_checked).toBe(true);
        expect(generated.start_dependence_note).toContain(`${CLOCK_STARTS.length} starts`);
        for (const alternative of generated.alternatives) {
            const dependence = alternative.assessment.start_dependence!;
            expect(dependence.starts.map(it => it.id), alternative.id).toEqual(CLOCK_STARTS.map(it => it.id));
            expect(dependence.starts[0].reaches_target, alternative.id).toBe(alternative.assessment.holds);
            // a clock that stands 300 ticks into a period of 72 is a clock like the others, not a build that makes nothing
            if (alternative.assessment.holds) {
                expect(dependence.starts.every(start => (start.output_items_per_period ?? 0) > 0), alternative.id).toBe(true);
            }
            expect(dependence.verdict, alternative.id).toBe(startVerdictOf(dependence.starts));
            // a clock that fails from every start is not start-dependent, and one the cold start fails on a check that
            // is not about the start fails every start
            if (!alternative.assessment.holds && dependence.starts[0].long_run_keeps_up === true) {
                expect(dependence.verdict, alternative.id).toBe("unstable");
            }
            if (dependence.verdict !== "stable") {
                expect(alternative.verdict, alternative.id).toBe("unstable");
            }
            if (dependence.verdict === "start-dependent") {
                expect(alternative.insights.find(it => it.id === "start-dependence")?.what, alternative.id).toMatch(/^start-dependent: reaches .* from /);
            }
        }
    });
});
