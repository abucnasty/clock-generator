import { beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../config";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";
import { runOnSharedLanes } from "./shared-lane-model";
import { judgeSharedLanes, sharedLaneRunsOf } from "./shared-lane-verdict";

// The flying robot frame 80 sample states the output belt of its scaffold (two lines of six copies each). The run of the 12 copies
// puts every copy's frames on those lines, and the clock the generator selects for the build holds on them.
describe("the flying robot frame 80 sample with its output belt stated", () => {
    let sample: Config;
    let selected: ClockAlternative;

    beforeAll(async () => {
        sample = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME_80);
        const { alternatives, selected_index } = generateClockAlternatives(sample, { logger: quiet });
        selected = alternatives[selected_index];
    });

    it("selects the moved output swing clock of 288 ticks, stable", () => {
        expect(selected.id).toBe("moved_output_swing");
        expect(selected.verdict).toBe("stable");
        expect(selected.result.simulation_duration.ticks).toBe(288);
    });

    it("runs the output belt with the hands of all 12 copies, and the selected clock loses no swing on it", () => {
        const ticks = selected.result.simulation_duration.ticks;
        const windows = new Map(Object.entries(selected.result.clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
        const { readings } = sharedLaneRunsOf(sample);
        const run = runOnSharedLanes(readings[0].under, windows, ticks, readings[0].layouts[0], 12, quiet);
        expect(run.output_belt).toBeDefined();
        expect([...run.output_belt!.hands.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        for (const hands of run.output_belt!.hands.values()) expect(hands.length).toBeGreaterThan(0);

        const judged = judgeSharedLanes(sample, selected.result.clock_windows, ticks, quiet);
        expect(judged.simulated).toBe(true);
        expect(judged.losses).toEqual([]);
    });
});
