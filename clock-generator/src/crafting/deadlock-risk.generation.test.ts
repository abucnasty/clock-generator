import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

// Utility science, the one sample with a deadlock risk (see deadlock-risk.test.ts): inserters 1 and 2 both bring low
// density structures to the one machine, and each brings another item too
describe("the clocks of a build with a deadlock risk", () => {
    let alternatives: ClockAlternative[];
    let selected: ClockAlternative;

    beforeAll(async () => {
        const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
        const generated = generateClockAlternatives(config, { logger: quiet });
        alternatives = generated.alternatives;
        selected = alternatives[generated.selected_index];
    });

    it("all name the risk, in an insight of the build", () => {
        for (const alternative of alternatives) {
            expect(alternative.deadlock_risks, alternative.id).toHaveLength(1);
            const insight = alternative.insights.find(it => it.id === "deadlock-risk");
            expect(insight?.scope, alternative.id).toBe("build");
            expect(insight?.what).toContain("Inserters 1 and 2 both bring low-density-structure to machine 1");
        }
    });

    it("are ranked by what they hold, not by whether they get back from a loss: the verdict is shown and does not decide", () => {
        for (const alternative of alternatives.filter(it => Number.isInteger(it.result.simulation_duration.ticks))) {
            expect(alternative.ranking.meets_target_rate, alternative.id).toBe(alternative.verdict !== "unstable");
        }
        const no_recovery = alternatives.filter(it => it.verdict === "no recovery");
        // from the staged start (empty machines) every clock that holds gets back from every loss on this build, so
        // none is listed as having no recovery; from the prepared build "planned" was
        expect(no_recovery).toHaveLength(0);
        expect(no_recovery.every(it => it.assessment.backpressure_loss?.survives === false)).toBe(true);
        expect(selected.id).toBe("planned-belt-slack");
    });
});
