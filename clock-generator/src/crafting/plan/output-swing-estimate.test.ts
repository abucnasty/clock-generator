import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import { estimatedOutputSwings, outputSwingEstimate } from "./output-swing-estimate";

const sample = (key: keyof typeof ConfigPaths) => loadConfigFromFile(ConfigPaths[key]);

describe("the output swing estimate", () => {
    // ELECTROMAGNETIC_SCIENCE_330: the swing backoff starts at 5 output swings a cycle; 5 and 4 make 1,456 of 1,760 and
    // 656 of 704 items a window cycle in the planning run's clock, 3 holds
    it("finds where the batched windows by arithmetic fall behind, with no run of the build", async () => {
        const config = await sample("ELECTROMAGNETIC_SCIENCE_330");
        expect(outputSwingEstimate(config, 3).verdict).toBe("keeps up");
        expect(outputSwingEstimate(config, 4).verdict).toBe("falls behind");
        expect(estimatedOutputSwings(config, 5)).toEqual({
            swings: 3,
            above: [{ swings: 5, verdict: "falls behind" }, { swings: 4, verdict: "falls behind" }],
        });
    });

    it("says nothing where the arithmetic has no rule for the build", async () => {
        const estimate = outputSwingEstimate(await sample("STONE_BRICK_120_DRILL_DIRECT_INSERT"), 3);
        expect(estimate).toMatchObject({ verdict: "no rule", reason: expect.stringMatching(/drills/) });
        expect(estimatedOutputSwings(await sample("STONE_BRICK_120_DRILL_DIRECT_INSERT"), 3).swings).toBeNull();
    });
});
