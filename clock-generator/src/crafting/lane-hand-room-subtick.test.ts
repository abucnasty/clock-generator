import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { clockOfPlan, unclockedRun, type PlannedClock, type UnclockedRun } from "./plan/unclocked-run";
import { laneHandRoomTicks } from "./clock";
import { quiet } from "./generate-blueprint-test-helpers";

// Iron bacteria cultivation at 380 a second with 6 output swings each output cycle, its selected clock: a window cycle
// of 1728/19 ticks, a subtick clock. Its two belt inserters (9 and 10) have room for one more hand of 4 ticks, but the
// planned windows hold without it: on a window cycle of part ticks the room is added only where the clock does not hold
// without it, so its windows stay as planned.
describe("the room for one more hand on a subtick clock", () => {
    let plan: UnclockedRun;
    let clock: PlannedClock;

    beforeAll(async () => {
        const sample = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_380_CULTIVATION);
        plan = unclockedRun({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: 6 } }, { logger: quiet });
        clock = clockOfPlan(plan, {});
    });

    it("is there to give: the window cycle is fractional and the belt inserters have room", () => {
        expect(Number.isInteger(plan.run.duration.ticks)).toBe(false);
        expect(laneHandRoomTicks(plan.run.simulation_context.entity_registry)).toEqual(new Map([["inserter:9", 4], ["inserter:10", 4]]));
    });

    it("is left out where the windows hold without it", () => {
        expect(clock.lane_hand_room.size).toBe(0);
        expect(clock.windows.get("inserter:9")).toEqual(plan.unslacked_windows.get("inserter:9"));
    });

    it("is left out there too when a maker asks for it always", () => {
        const always = clockOfPlan(plan, { lane_hand_room: "always" });
        expect(always.lane_hand_room.size).toBe(0);
        expect(always.windows).toEqual(clock.windows);
    });
});
