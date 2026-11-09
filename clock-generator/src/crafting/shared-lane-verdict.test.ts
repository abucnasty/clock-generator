import path from "path";
import fs from "fs";
import { describe, expect, it } from "vitest";
import { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { SerializableClockWindows } from "./clock";
import { judgeSharedLanes } from "./shared-lane-verdict";

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** The config with the lane end stated on lanes of a belt */
function withEnd(config: Config, belt_id: number, lanes: number[], kind: "dead_end" | "unknown" | "outlet"): Config {
    return { ...config, belts: config.belts.map(belt => belt.id !== belt_id ? belt
        : { ...belt, lanes: belt.lanes.map((lane, index) => lanes.includes(index + 1) ? { ...lane, lane_end: { kind } } : lane) as typeof belt.lanes }) };
}

// abucnasty's chemical science build (#725): 5.5 copies 18 tiles apart, the advanced circuits of every copy off lane 1 of
// belt 2, a turbo belt with stacks of 4 that dead-ends; inserters 3 and 6 of each copy take them, 11 takers in all. The
// four clocks recorded in the game on it: under Coordinated Sources and Takt Batches the third machine along the lane made
// 22, 12 and 30 of 32 in turn; Time-Study Windows and Euclidean Swings held 14,080 of 14,080.
describe("the clocks recorded on the chemical science build whose copies share a dead-ended circuit lane", async () => {
    const config = await loadConfigFromFile(path.join(__dirname, "fixtures", "chemical-science-120-5.5-copies-one-circuit-lane.json"));
    const clocks: Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows }> =
        JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "chemical-science-120-recorded-clocks.json"), "utf8"));
    const judged = (id: string, kind: "dead_end" | "unknown" | "outlet" = "dead_end") =>
        judgeSharedLanes(withEnd(config, 2, [1], kind), clocks[id].windows, clocks[id].window_cycle_ticks, quiet);

    it.each(["coordinated_sources", "takt_batches_observed"])("fails %s: the second copy's first circuit taker along the lane loses swings, either way the lane flows", id => {
        const { losses, simulated } = judged(id);
        expect(simulated).toBe(true);
        // the third circuit taker from the entry: the second copy's first one along the flow
        expect(losses.map(loss => [loss.belt_id, loss.lane, loss.copy, loss.inserter_id, loss.flow.x])).toEqual([[2, 1, 2, 3, 1], [2, 1, 2, 6, -1]]);
        expect(losses[0].items / losses[0].alone_items).toBeCloseTo(2 / 3, 1);
        expect(losses[0].text).toBe("Lane 1 of belt 2 ends in a dead end, and 5.5 copies take advanced circuit from it. When the items move east, "
            + "copy 2 from the entry of the lane gets too few. Its inserter 3 takes 1,792 in 56 window cycles, and 2,688 when no other copy takes from the lane.");
    });

    it.each(["time_study_windows", "euclidean_swings"])("holds %s, and the refill arithmetic agrees", id => {
        expect(judged(id)).toMatchObject({ losses: [], fast_check_passes: true, simulated: true, lanes: ["2/1"] });
    });

    it("checks an unknown end as a dead end, and leaves an outlet to the run of one copy", () => {
        expect(judged("takt_batches_observed", "unknown").losses.map(loss => [loss.copy, loss.inserter_id, loss.lane_end])).toEqual([[2, 3, "unknown"], [2, 6, "unknown"]]);
        expect(judged("takt_batches_observed", "unknown").losses[0].text).toContain("Lane 1 of belt 2 has an unknown end, which is checked as a dead end, and 5.5 copies take advanced circuit from it.");
        expect(judged("takt_batches_observed", "outlet")).toMatchObject({ losses: [], simulated: false, lanes: [] });
    });

    it("leaves a lane that is one per copy to the run of one copy when it ends in a dead end", () => {
        const own = withEnd(config, 2, [1], "dead_end");
        const one_per_copy = { ...own, belts: own.belts.map(belt => belt.id !== 2 ? belt
            : { ...belt, lanes: belt.lanes.map(lane => ({ ...lane, sharing: "one_per_copy" as const })) as typeof belt.lanes }) };
        const clock = clocks.takt_batches_observed;
        expect(judgeSharedLanes(one_per_copy, clock.windows, clock.window_cycle_ticks, quiet)).toMatchObject({ losses: [], lanes: [] });
    });
});

// LOGISTIC_SCIENCE_240 in the game: one row of the build is 11 copies 6 tiles apart, whose feed belt carries transport belts
// on one lane and inserters on the other, both lanes dead ends taken at 120 of 120 a second. The recommended clock (batched
// swings, 4 output swings a window cycle of 176 ticks) moved 704 packs in every one of 21 window cycles in each row.
describe("the logistic science build of 11 copies on two dead-ended lanes", () => {
    it("holds the clock recorded on it on every copy", async () => {
        const config = withEnd(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240), 2, [1, 2], "dead_end");
        const windows = { "inserter:1": [{ start: 52, end: 71 }, { start: 76, end: 95 }], "inserter:2": [{ start: 1, end: 49 }] };
        const judged = judgeSharedLanes(config, windows, 176, quiet);
        expect(judged).toMatchObject({ losses: [], simulated: true, lanes: ["2/1", "2/2"] });
    });
});
