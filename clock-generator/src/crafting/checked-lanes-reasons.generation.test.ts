import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet, reasonsOf } from "./generate-blueprint-test-helpers";

// The reason beside the status of each clock with a cause on the shared lanes: the code of belt gaps where at least one
// missed swing shows the gap that the copy before leaves, with the totals over the copies of the cause part; no reason on
// a lane loss where none shows it. Agricultural science has a file of its own, as it takes the longest to generate.
describe("the reason of each clock with a cause on the shared lanes", () => {
    it.each<[keyof typeof ConfigPaths, Record<string, unknown>]>([
        ["CHEMICAL_SCIENCE_240_SHARED_FOUNDRY", {
            takt_batches_observed: { code: "belt_gaps", data: { missed: 456, with_gap: 228 } },
            phase_shifted_batch: { code: "belt_gaps", data: { missed: 452, with_gap: 224 } },
        }],
        // no missed swing shows the gap: no reason
        ["FLYING_ROBOT_FRAME_80", { takt_batches_observed: "none", time_study_windows: "none", pitch_pickups: "none" }],
    ])("of %s", async (sample, reasons) => {
        const result = generateClockAlternatives(await loadConfigFromFile(ConfigPaths[sample]), { logger: quiet });
        expect(reasonsOf(result)).toEqual(reasons);
    });
});
