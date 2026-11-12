import { describe, expect, it } from "vitest";
import { generateClockForConfig, planClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { TestConfigPaths } from "../../tests/configs/paths";
import { clockOfPlan, unclockedRun } from "./plan/unclocked-run";
import { quiet } from "./generate-blueprint-test-helpers";

/** The config with its output swings set, so that every clock of it is made at that count */
const withSwings = (config: Config, count: number): Config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: count } });

// An inserter that takes its machine's fuel and an ingredient off one belt, with the fuel on the lane nearest to it, takes
// a hand of fuel whenever the fuel slot has room, and the planned hand of the ingredient a hand cycle later. A clock that
// does not hold without room for that hand is made again with it at the end of each window, on top of the room for one
// more hand: 6 ticks of a hand cycle of 11 (delayedHandRoomTicks).
describe("a clock of a build that takes fuel off the near lane of a belt", () => {
    // agricultural science, one copy, the nutrients on the near lane of inserters 1, 2 and 11: Takt Batches at 2 output
    // swings with the room for one more hand moves 799.38 of 800 a window cycle as built, and 800 with the room
    it("that does not hold is made again with room for the delayed hand, and the clock made again holds", async () => {
        const config = withSwings(await loadConfigFromFile(TestConfigPaths.AGRICULTURAL_SCIENCE_50_FUEL_ON_NEAR_LANE), 2);
        const without = generateClockForConfig({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } },
            { logger: quiet, verify_as_built: true, lane_hand_room: "always" });
        expect(without.stability_check.as_built?.holds).toBe(false);
        const primary = planClockAlternatives(config, { logger: quiet }).primary!.alternatives[0];
        expect(primary.result.fuel_hand_room_ticks).toEqual({ "inserter:1": 6, "inserter:2": 6, "inserter:11": 6 });
        expect(primary.assessment.holds).toBe(true);
        expect(primary.result.stability_check.as_built?.actual_output_items).toBe(800);
    }, 300_000);

    // the sample's config before its five copies has the bioflux on inserter 11's near lane and the nutrients on that of inserters 1 and 2
    it("gives the room to the inserters with the fuel on their near lane only, on top of the room for one more hand", async () => {
        const plan = unclockedRun(await loadConfigFromFile(TestConfigPaths.AGRICULTURAL_SCIENCE_250_BIOFLUX_ON_NEAR_LANE), { logger: quiet });
        const without = clockOfPlan(plan, { lane_hand_room: "always" });
        const with_room = clockOfPlan(plan, { lane_hand_room: "always", fuel_hand_room: true });
        expect(Object.fromEntries(with_room.fuel_hand_room)).toEqual({ "inserter:1": 6, "inserter:2": 6 });
        expect(Object.fromEntries(with_room.lane_hand_room)).toEqual(Object.fromEntries(without.lane_hand_room));
        expect(with_room.windows.get("inserter:11")).toEqual(without.windows.get("inserter:11"));
        for (const id of ["inserter:1", "inserter:2"]) {
            const planned = plan.unslacked_windows.get(id)!;
            expect(without.windows.get(id)!.map(range => range.end_inclusive)).toEqual(planned.map(range => range.end_inclusive + 4));
            expect(with_room.windows.get(id)!.map(range => range.end_inclusive)).toEqual(planned.map(range => range.end_inclusive + 4 + 6));
        }
    }, 120_000);

    // iron bacteria cultivation: inserters 9 and 10 take bioflux off their near lane and the nutrients they burn off the far one
    it("is the same clock where every such inserter has the ingredient on its near lane", async () => {
        const config = { ...withSwings(await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_380_CULTIVATION), 6) };
        const options = { logger: quiet, verify_as_built: true, lane_hand_room: "always" as const };
        const without = generateClockForConfig(config, options);
        const with_room = generateClockForConfig(config, { ...options, fuel_hand_room: true });
        expect(with_room.fuel_hand_room_ticks).toEqual({});
        expect(with_room.clock_windows).toEqual(without.clock_windows);
    }, 300_000);
});
