import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

/** The config with the lanes it names (by "belt/lane") stated as dead ends, and their belts stating that their items move east */
function deadEnded(config: Config, lanes: string[], flow_direction?: 4): Config {
    const named = (belt_id: number, lane: number) => lanes.includes(`${belt_id}/${lane}`);
    return { ...config, belts: config.belts.map(belt => ({ ...belt,
        ...(flow_direction !== undefined && belt.lanes.some((_, index) => named(belt.id, index + 1)) && { flow_direction }),
        lanes: belt.lanes.map((lane, index) => named(belt.id, index + 1) ? { ...lane, lane_end: { kind: "dead_end" } } : lane) as typeof belt.lanes })) };
}

// abucnasty's chemical science build (#725): 5.5 copies on two input belts that run east and end in an underground entrance
// with no exit, so all four input lanes are dead ends. In the game Takt Batches made 22, 12 and 30 of 32 on the third
// machine along the circuit lane (copy 2's first); Time-Study Windows and Euclidean Swings held on every machine.
describe("the copies of a build that share dead-ended lanes", () => {
    let generated: ClockAlternativesResult;
    beforeAll(async () => {
        const config = await loadConfigFromFile(path.join(__dirname, "fixtures", "chemical-science-120-5.5-copies-one-circuit-lane.json"));
        generated = generateClockAlternatives(deadEnded(config, ["1/1", "1/2", "2/1", "2/2"], 4), { logger: quiet });
    });
    const alternative = (id: string) => generated.alternatives.find(it => it.id === id)!;

    it("make a clock unstable under which a copy loses swings on the lane, naming the lane and the copy", () => {
        const takt = alternative("takt_batches_observed");
        expect(takt.verdict).toBe("unstable");
        expect(new Set(takt.assessment.shared_lane_losses?.map(loss => loss.copy))).toEqual(new Set([2]));
        expect(takt.assessment.shared_lane_losses?.slice(0, 1).map(loss => [loss.belt_id, loss.lane, loss.copy, loss.inserter_id])).toEqual([[2, 1, 2, 3]]);
        expect(takt.description).toContain("It is not stable on a lane its copies share. Lane 1 of belt 2 ends in a dead end. The 5.5 copies take "
            + "advanced circuit from it. When the items move east, copy 2 from the entry does not get sufficient items.");
    });

    it("keep the clocks that held on the build in the game, and select a stable one", () => {
        for (const id of ["euclidean_swings", "time_study_windows"]) {
            expect([id, alternative(id).verdict, alternative(id).assessment.shared_lane_losses]).toEqual([id, "stable", undefined]);
        }
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.shared_lane_losses).toBeUndefined();
        expect(generated.why_not_stable ?? null).toBeNull();
    });
});

// LOGISTIC_SCIENCE_240: one row of the build in the game is 11 copies 6 tiles apart on a feed belt whose two lanes dead-end,
// taken at 120 of 120 a second each. The recommended clock (4 output swings a window cycle of 176 ticks) moved 704 packs
// in every one of 21 window cycles in each row.
describe("the logistic science build with its feed lanes stated as dead ends", () => {
    it("selects the clock recorded on it, which holds on every copy", async () => {
        const config = deadEnded(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240), ["2/1", "2/2"]);
        const generated = generateClockAlternatives(config, { logger: quiet });
        const selected = generated.alternatives[generated.selected_index];
        expect([selected.id, selected.verdict, selected.result.simulation_duration.ticks, selected.result.used_terminal_swing_count])
            .toEqual(["takt_batches_observed", "stable", 176, 4]);
        expect(selected.assessment.shared_lane_losses).toBeUndefined();
    });
});

// CHEMICAL_SCIENCE_240_SHARED_FOUNDRY: Coordinated Sources is composed on 352 ticks from the clocks made before it, and on
// the advanced-circuit lane its copies share copy 5 takes half of what one copy alone takes. A clock made that is not stable
// is not listed; it is in not_made, with what its check found, as a clock no maker could make is.
describe("a composed clock made and not stable on a lane the copies share", () => {
    it("is in not_made with what the check found, and not listed", async () => {
        const generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY), { logger: quiet });
        expect(generated.alternatives.some(it => it.maker === "per-branch")).toBe(false);
        const composed = generated.not_made.find(it => it.id === "per-branch");
        expect(composed).toMatchObject({ label: "Coordinated Sources" });
        expect(composed!.reason).toMatch(/^Made on 352 ticks and not stable\. It is not stable on a lane its copies share\. Lane 1 of belt 1 ends in an outlet\. The 5\.5 copies take advanced circuit from it\./);
    }, 300_000);
});
