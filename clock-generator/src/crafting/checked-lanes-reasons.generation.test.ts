import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet, reasonsOf, swingSumsOf } from "./generate-blueprint-test-helpers";

// The reason beside the status of each clock with a cause on the shared lanes: the code of belt gaps where at least one
// missed swing shows the gap that the copy before leaves, with the totals over the copies of the cause part; unknown on a
// lane loss where none shows the gap or a full output. Agricultural science 250 (out of the suite as it takes over 200 s to
// generate) is not here.
describe("the reason of each clock with a cause on the shared lanes", () => {
    it.each<[keyof typeof ConfigPaths, Record<string, unknown>]>([
        ["CHEMICAL_SCIENCE_240_SHARED_FOUNDRY", {
            takt_batches_observed: { code: "belt_gaps", data: { missed: 456, with_gap: 228 } },
            phase_shifted_batch: { code: "belt_gaps", data: { missed: 452, with_gap: 224 } },
        }],
        // no missed swing shows the gap or a full output: unknown, with the missed swings
        ["FLYING_ROBOT_FRAME_80", { takt_batches_observed: { code: "unknown", data: { missed: 426 } }, time_study_windows: { code: "unknown", data: { missed: 429 } },
            pitch_pickups: { code: "unknown", data: { missed: 426 } } }],
    ])("of %s", async (sample, reasons) => {
        const result = generateClockAlternatives(await loadConfigFromFile(ConfigPaths[sample]), { logger: quiet });
        expect(reasonsOf(result)).toEqual(reasons);
        // the swings of each cause, swing by swing, add up to the counts it carries
        expect(swingSumsOf(result)).toEqual(Object.fromEntries(Object.keys(reasons).map(id => [id, []])));
    });
});
