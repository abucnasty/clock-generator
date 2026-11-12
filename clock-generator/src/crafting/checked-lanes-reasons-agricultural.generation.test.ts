import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet, reasonsOf } from "./generate-blueprint-test-helpers";

describe("the reason of each clock with a cause on the shared lanes of agricultural science 250", () => {
    // the run shows no cause it can name on these lane losses (no record of their stops adds up): no reason
    it("is none on each of its three lane losses", async () => {
        const result = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250), { logger: quiet });
        expect(reasonsOf(result)).toEqual({ moved_output_swing: "none", takt_batches_observed_swings_2: "none", pitch_pickups: "none" });
    });
});
