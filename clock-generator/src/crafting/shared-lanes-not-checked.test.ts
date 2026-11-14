import { describe, expect, it } from "vitest";
import { sharedLaneLossesOf } from "./alternatives";
import { SecondaryPlanningInvariantError } from "./round-robin-polling-primitive-policy";
import type { SharedLaneJudgement } from "./shared-lane-verdict";
import { ClockAssessment, clockVerdictOf } from "./trial";

describe("the shared-lane losses of a clock whose check cannot run", () => {
    const logger = { log() { }, warn() { }, error() { }, debug() { } };
    const passes: SharedLaneJudgement = { losses: [], fast_check_passes: true, simulated: true, longer_run: false, lanes: ["1/1"] };

    it("are one loss that says the lanes could not be checked and why, so the clock is not stable", () => {
        const losses = sharedLaneLossesOf(() => { throw new Error("Lane 1 of belt 9 is not in the config"); }, "Takt Batches", logger);
        expect(losses).toEqual([{ kind: "not_checked", reason: "Lane 1 of belt 9 is not in the config",
            text: "The lanes its copies share could not be checked: Lane 1 of belt 9 is not in the config." }]);
        const assessment: ClockAssessment = { holds: true, disturbance_trial: null, items_per_second: 80, wake_ups_per_minute: 200,
            start_dependence: null, shared_lane_losses: [...losses] };
        expect(clockVerdictOf(assessment)).toBe("unstable");
    });

    it("are the check's own where it runs", () => {
        expect(sharedLaneLossesOf(() => passes, "Takt Batches", logger)).toEqual([]);
    });

    it("throw an internal error of the generator on", () => {
        expect(() => sharedLaneLossesOf(() => { throw new SecondaryPlanningInvariantError("broken"); }, "Takt Batches", logger))
            .toThrow(SecondaryPlanningInvariantError);
    });
});
