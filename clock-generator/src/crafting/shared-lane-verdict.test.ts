import path from "path";
import fs from "fs";
import { describe, expect, it } from "vitest";
import { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { SerializableClockWindows } from "./clock";
import { judgeSharedLanes } from "./shared-lane-verdict";

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** The config with lane facts stated on lanes of it, by "belt/lane" */
function withFacts(config: Config, facts: Record<string, Record<string, unknown>>): Config {
    return { ...config, belts: config.belts.map(belt => ({ ...belt,
        lanes: belt.lanes.map((lane, index) => ({ ...lane, ...(facts[`${belt.id}/${index + 1}`] ?? {}) })) as typeof belt.lanes })) };
}

const dead_end = { lane_end: { kind: "dead_end" } };

// abucnasty's chemical science build (#725): 5.5 copies 18 tiles apart. Its two input belts run east and each ends in an
// underground entrance with no exit, so all four input lanes are dead ends: the advanced circuits and the sulfur on belt 2,
// taken by inserters 3 and 6 of each copy, the gears and the steel on belt 1, taken by inserters 7 and 10. The four clocks
// recorded in the game on it: under Coordinated Sources and Takt Batches the third machine along the lane (copy 2's first)
// made 22, 12 and 30 of 32 in turn, 19 of 30 circuit hands; every other machine made 32. Time-Study Windows and Euclidean
// Swings held 14,080 of 14,080.
describe("the clocks recorded on the chemical science build whose copies share dead-ended lanes", async () => {
    const config = await loadConfigFromFile(path.join(__dirname, "fixtures", "chemical-science-120-5.5-copies-one-circuit-lane.json"));
    const clocks: Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows }> =
        JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "chemical-science-120-recorded-clocks.json"), "utf8"));
    const east = { ...dead_end, flow_direction: 4 };
    const stated = withFacts(config, { "1/1": east, "1/2": east, "2/1": east, "2/2": east });
    const judged = (id: string, on: Config = stated) => judgeSharedLanes(on, clocks[id].windows, clocks[id].window_cycle_ticks, quiet);

    it.each(["coordinated_sources", "takt_batches_observed"])("fails %s on the second copy alone, its first circuit taker short the most", id => {
        const { losses } = judged(id);
        expect(losses.length).toBeGreaterThan(0);
        expect(new Set(losses.map(loss => loss.copy))).toEqual(new Set([2]));
        expect([losses[0].belt_id, losses[0].lane, losses[0].copy, losses[0].inserter_id, losses[0].flow.x]).toEqual([2, 1, 2, 3, 1]);
        // the game's machine made 19 of 30 hands
        expect(losses[0].items / losses[0].alone_items).toBeCloseTo(2 / 3, 1);
        expect(losses[0].text).toBe(`Lane 1 of belt 2 ends in a dead end. The 5.5 copies take advanced circuit from it. When the items move east, `
            + `copy 2 from the entry does not get sufficient items. Its inserter 3 takes ${losses[0].items.toLocaleString("en-US")} in ${losses[0].window_cycles} window cycles. `
            + `With no other copy on the lane, it takes ${losses[0].alone_items.toLocaleString("en-US")}.`);
    });

    it.each(["time_study_windows", "euclidean_swings"])("holds %s on every copy", id => {
        expect(judged(id)).toMatchObject({ losses: [], simulated: true, lanes: ["1/1", "1/2", "2/1", "2/2"] });
    });

    it("runs a lane that states no flow direction both ways along the copies: the second copy's first taker either way", () => {
        const unstated = withFacts(config, { "1/1": dead_end, "1/2": dead_end, "2/1": dead_end, "2/2": dead_end });
        const worst = (flow: number) => judged("takt_batches_observed", unstated).losses.find(loss => loss.flow.x === flow && loss.belt_id === 2 && loss.lane === 1)!;
        expect([worst(1).copy, worst(1).inserter_id, worst(-1).copy, worst(-1).inserter_id]).toEqual([2, 3, 2, 6]);
    });

    it("checks an unknown end as a dead end and as a free outlet", () => {
        const unknown = withFacts(stated, { "2/1": { lane_end: { kind: "unknown" } } });
        const losses = judged("takt_batches_observed", unknown).losses.filter(loss => loss.belt_id === 2 && loss.lane === 1);
        expect(losses.some(loss => loss.run_as === "dead_end" && loss.copy === 2 && loss.inserter_id === 3)).toBe(true);
        expect(losses.find(loss => loss.run_as === "dead_end")!.text)
            .toContain("Lane 1 of belt 2 has an unknown end. It is checked as a dead end. The 5.5 copies take advanced circuit from it.");
    });

    it("leaves lanes that are one per copy to the run of one copy when they end in a dead end", () => {
        const own = { ...dead_end, sharing: "one_per_copy" };
        const one_per_copy = withFacts(config, { "1/1": own, "1/2": own, "2/1": own, "2/2": own });
        expect(judged("takt_batches_observed", one_per_copy)).toMatchObject({ losses: [], simulated: false, lanes: [] });
    });
});

// #660: INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK in the game, three copies 9 tiles apart on two ore belts that run east into
// loaders, both lanes of each a free outlet that never stands (recorded), and an electronic-circuit belt that ends in a
// dead end: its last tile faces nothing, and no item leaves it past the last taker (recorded). The game ran the five clocks
// with these enable windows (read off the recording, a window cycle of 216 ticks): under Takt Batches with 6 swings copy 3
// made about 4,000 of 4,800 a minute, its two ore inserters 82 swings against 99; under the other four every copy made 4,800.
describe("the clocks recorded on the inserter build whose copies share flowing ore lanes", async () => {
    const config = withFacts(await loadConfigFromFile(path.join(__dirname, "fixtures", "inserter-crafting-240-3-copies-ore-lines.json")),
        { "2/1": dead_end, "2/2": dead_end });
    const clocks: Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows }> =
        JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "inserter-crafting-240-recorded-clocks.json"), "utf8"));
    const judged = (id: string) => judgeSharedLanes(config, clocks[id].windows, clocks[id].window_cycle_ticks, quiet);

    it("fails takt_batches_swings_6 on copy 3 alone, its ore inserters short", () => {
        const { losses } = judged("takt_batches_swings_6");
        expect(new Set(losses.map(loss => loss.copy))).toEqual(new Set([3]));
        expect(losses.some(loss => loss.belt_id === 1 && loss.item === "iron-ore")).toBe(true);
    });

    it.each(["coordinated_sources", "takt_batches_swings_2", "takt_batches_observed_swings_2", "takt_batches_observed_swings_6"])("holds %s on every copy", id => {
        expect(judged(id)).toMatchObject({ losses: [], simulated: true });
    });
});

// LOGISTIC_SCIENCE_240 in the game: one row of the build is 11 copies 6 tiles apart, whose feed belt carries transport belts
// on one lane and inserters on the other, both lanes dead ends taken at 120 of 120 a second. The recommended clock (batched
// swings, 4 output swings a window cycle of 176 ticks) moved 704 packs in every one of 21 window cycles in each row.
describe("the logistic science build of 11 copies on two dead-ended lanes", () => {
    it("holds the clock recorded on it on every copy", async () => {
        const config = withFacts(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240), { "2/1": dead_end, "2/2": dead_end });
        const windows = { "inserter:1": [{ start: 52, end: 71 }, { start: 76, end: 95 }], "inserter:2": [{ start: 1, end: 49 }] };
        const judged = judgeSharedLanes(config, windows, 176, quiet);
        expect(judged).toMatchObject({ losses: [], simulated: true, lanes: ["2/1", "2/2"] });
    });
});
