import { describe, it, expect, beforeAll } from "vitest";
import { clockBeltLabel, generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

const backedUpBelts = (config: Config): Config => ({ ...config, overrides: { ...config.overrides, backed_up_belts: true } });

// GOALS.md: a clock that only works when its inserters pick up from a backed-up belt, and a clock that also
// works when the items on the belt are moving
describe("the belt a clock is made for", () => {

    describe("clockBeltLabel", () => {
        it("names a moving belt with the ticks of belt pickup slack", () => {
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [4] })).toBe("moving (+4 ticks)");
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [1] })).toBe("moving (+1 tick)");
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [2, 4] })).toBe("moving (+2–4 ticks)");
        });

        it("names a backed-up belt, and nothing when no clocked inserter picks up from a belt", () => {
            expect(clockBeltLabel({ kind: "backed_up" })).toBe("backed-up");
            expect(clockBeltLabel(null)).toBe("");
        });
    });

    // Three inserters take bioflux off a belt for their biochambers, and the nutrients the biochambers burn. Without
    // room for a hand of nutrients the windows of batched swings close on partly filled hands of bioflux: recorded on
    // the scaffold, 377 of 400 a period. With it the clock is the one that has belt pickup slack with belts that move,
    // which the game tests record at 400 in every period.
    describe("agricultural science, with backed-up belts", () => {
        let batched: ClockAlternative;

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250);
            const generated = generateClockAlternatives(backedUpBelts(config), { logger: quiet });
            batched = generated.alternatives.find(a => a.id === "planned-belt-slack")!;
        });

        it("makes batched swings with room for a hand of fuel, as a clock for a backed-up belt, and it holds the target rate", () => {
            expect(batched.label).toBe("Batched swings: 5 output swings per cycle");
            expect(batched.verdict).not.toBe("unstable");
            expect(batched.belt).toEqual({ kind: "backed_up" });
            expect(batched.ranking.matches_belt_choice).toBe(true);
            expect(batched.result.belt_pickup_slack_ticks).toEqual({});
            expect(batched.result.fuel_hand_room_ticks).toEqual({ "inserter:1": 4, "inserter:2": 4, "inserter:11": 4 });
            expect(batched.description).toContain("Inserters 1, 2 and 11 take fuel off the belt as well as an ingredient and stay enabled 4 more ticks");
        });
    });
});
