import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { pitchPickupsClock } from "./candidates/pitch-pickups";
import { quiet } from "./generate-blueprint-test-helpers";
import { generateClockWithSwingBackoff } from "./generate-clock";
import type { BlueprintGenerationResult } from "./generate-blueprint";

// Advanced circuits at 230 a second: a window cycle of 12672/23 ticks, a subtick clock. Pitch Pickups builds on the Takt
// Batches windows, which hold neither with nor without the room for one more hand; its own finished windows hold
// without it. On a window cycle of part ticks the room is decided on those: its belt inserters (3 and 6) keep their
// planned windows, 29 to 48 the first.
describe("Pitch Pickups on a subtick clock", () => {
    let result: BlueprintGenerationResult;

    beforeAll(async () => {
        // as the alternative makes it: the room asked for always, backing off the swing count until a clock holds
        result = generateClockWithSwingBackoff(await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_230), { logger: quiet, lane_hand_room: "always" }, pitchPickupsClock);
    });

    it("holds its rate", () => {
        expect(Number.isInteger(result.simulation_duration.ticks)).toBe(false);
        expect(result.stability_check.holds).toBe(true);
    });

    it("gives its belt inserters no room for one more hand, as their windows hold without it", () => {
        for (const id of ["inserter:3", "inserter:6"]) {
            expect(result.clock_windows[id]?.find(window => window.start === 29)).toEqual({ start: 29, end: 48 });
            // no window carried over the end of the window cycle by the room
            expect(result.clock_windows[id]?.[0].start).toBe(29);
        }
    });
});
