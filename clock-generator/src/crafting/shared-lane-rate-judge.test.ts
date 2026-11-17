import path from "path";
import fs from "fs";
import { describe, expect, it } from "vitest";
import { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { SerializableClockWindows } from "./clock";
import { BehindTarget, CopyMade, growing, judgeSharedLanes, rateBehind, rateOpenCaseOfBuild, RunOfCopies, TargetRates } from "./shared-lane-verdict";

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const FIXTURES = path.join(__dirname, "fixtures");
type Clocks = Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows; terminal_swing_count?: number }>;
const clocksOf = (file: string): Clocks => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));

/** The config with lane facts stated on lanes of it, by "belt/lane" */
function withFacts(config: Config, facts: Record<string, Record<string, unknown>>): Config {
    return { ...config, belts: config.belts.map(belt => ({ ...belt,
        lanes: belt.lanes.map((lane, index) => ({ ...lane, ...(facts[`${belt.id}/${index + 1}`] ?? {}) })) as typeof belt.lanes })) };
}
const dead_end = { lane_end: { kind: "dead_end" } };

/** One clock recorded in the game on a build whose copies share lanes, and what the game did */
interface Recorded { name: string; holds_in_game: boolean; config: Config; windows: SerializableClockWindows; window_cycle_ticks: number }

const byRate = (it: Pick<Recorded, "config" | "windows" | "window_cycle_ticks">) => judgeSharedLanes(it.config, it.windows, it.window_cycle_ticks, quiet, { by_rate: true });

// #733: the clocks recorded in the game on builds whose copies share lanes, as #733 counts them (17). Two are not here: the
// Round-Robin Polling clocks with 4 swings (48 ticks) and 2 swings (24 ticks) recorded on the inserter build of three copies
// before the sample stated its ore lanes' ends. Their windows were not kept, and no clock in the repository is known to be
// theirs. The game's result of each clock is that of the tests and fixtures named.
describe("the rate judge on the clocks recorded in the game on copies that share lanes (#733)", async () => {
    const recorded: Recorded[] = [];
    // #660, shared-lane-verdict.test.ts: three copies on ore lanes into loaders; under Takt Batches with 6 swings copy 3 made
    // about 4,000 of 4,800 a minute, and every copy made 4,800 under the other four
    const d1 = withFacts(await loadConfigFromFile(path.join(FIXTURES, "inserter-crafting-240-3-copies-ore-lines.json")), { "2/1": dead_end, "2/2": dead_end });
    for (const [id, clock] of Object.entries(clocksOf("inserter-crafting-240-recorded-clocks.json"))) {
        recorded.push({ name: `inserter build, ore lanes into loaders: ${id}`, holds_in_game: id !== "takt_batches_swings_6", config: d1, ...clock });
    }
    // the same build with its ore lanes' ends stated (the sample): Coordinated Sources (the clock of the game recording
    // generated-three-copies, inserter-crafting-240-shared-signal-clock-controls.json) and Time-Study Windows (as
    // shared-lane-verdict.test.ts gives it), both held by the game on every copy
    const sample = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
    const third_copy_speeds: Record<number, number> = { 4: 40.3125, 5: 86.1655 };
    for (const [id, { terminal_swing_count, ...clock }] of Object.entries(clocksOf("inserter-crafting-240-ends-stated-recorded-clocks.json"))) {
        const at_speeds = id === "time_study_windows"
            ? { ...sample, machines: sample.machines.map(machine => third_copy_speeds[machine.id] === undefined ? machine : { ...machine, crafting_speed: third_copy_speeds[machine.id] }) }
            : sample;
        recorded.push({ name: `inserter build, ore lanes' ends stated: ${id}`, holds_in_game: true,
            config: { ...at_speeds, overrides: { ...at_speeds.overrides, terminal_swing_count } }, ...clock });
    }
    // abucnasty's flying robot frame build of 12 copies (2026-11-09): every copy held 400 a minute under the job file's two
    // clocks; under the planner's Time-Study Windows copies 4 and 5 made 50 % and 68 %
    const frame = await loadConfigFromFile(path.join(FIXTURES, "flying-robot-frame-80-12-copies-recorded.json"));
    for (const [id, clock] of Object.entries(clocksOf("flying-robot-frame-80-recorded-clocks.json"))) {
        recorded.push({ name: `flying robot frame build: ${id}`, holds_in_game: id !== "time_study_windows_planner", config: frame, ...clock });
    }
    // LOGISTIC_SCIENCE_240, shared-lane-verdict.test.ts: 704 packs in every one of 21 window cycles in each row
    recorded.push({ name: "logistic science build of 11 copies: batched swings", holds_in_game: true,
        config: withFacts(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240), { "2/1": dead_end, "2/2": dead_end }), window_cycle_ticks: 176,
        windows: { "inserter:1": [{ start: 52, end: 71 }, { start: 76, end: 95 }], "inserter:2": [{ start: 1, end: 49 }] } });

    it.each(recorded)("$name: judged by the rate, as the game", it => {
        const judged = byRate(it);
        expect(judged.by_rate).toMatchObject({ spans: expect.any(Array) });
        expect(judged.losses.length === 0).toBe(it.holds_in_game);
    });

    it.each(recorded.filter(it => it.holds_in_game))("$name: no machine more than one craft behind, so no run longer than the long run", it => {
        expect(byRate(it).by_rate!.spans).toHaveLength(1);
    });

    it.each(recorded.filter(it => !it.holds_in_game))("$name: a loss only after four times the run, its machine further behind at each doubling", it => {
        const judged = byRate(it);
        expect(judged.by_rate!.spans).toHaveLength(3);
        const behind = judged.losses[0].behind!;
        expect(behind.kind).toBe("machine");
        // more than a craft a window cycle behind over the run four times as long: a shortfall that grows with the run
        expect(behind.behind).toBeGreaterThan(judged.by_rate!.spans[2] / 2);
    });

    // abucnasty's chemical science build of 5.5 copies (#725), shared-lane-verdict.test.ts: a part copy is one of the cases
    // #733 leaves open, so the comparison with the run of one copy alone judges its four recorded clocks
    it("leaves the chemical science build of 5.5 copies to the run of one copy alone, as the game: a part copy", async () => {
        const base = await loadConfigFromFile(path.join(FIXTURES, "chemical-science-120-5.5-copies-one-circuit-lane.json"));
        const config = withFacts({ ...base, belts: base.belts.map(belt => [1, 2].includes(belt.id) ? { ...belt, flow_direction: 4 as const } : belt) },
            { "1/1": dead_end, "1/2": dead_end, "2/1": dead_end, "2/2": dead_end });
        for (const [id, clock] of Object.entries(clocksOf("chemical-science-120-recorded-clocks.json"))) {
            const judged = byRate({ config, ...clock });
            expect(judged.by_rate).toEqual({ open_case: "part_copy" });
            expect(judged.losses.length === 0).toBe(!["coordinated_sources", "takt_batches_observed"].includes(id));
        }
    });
});

// ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED: five copies, machines with 175 % productivity, which make their crafts in
// bursts. Under Coordinated Sources on 40 ticks (the clock the generator makes for the sample) machine 2 of copy 5 is 2.8
// crafts ahead, 5.3 behind and 5.6 ahead in the runs of 1, 2 and 4 times the long run's window cycles (measured
// 2026-11-17): it grows at the first doubling and not at the second, a band that holds. Two runs alone would fail it.
describe("a band of crafts behind under 175 % productivity", () => {
    it("holds the clock after four times the run", async () => {
        const config = { ...await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED) };
        const clock = clocksOf("electromagnetic-science-240-recycler-coordinated-sources.json").coordinated_sources;
        const { terminal_swing_count, ...run } = clock;
        const judged = byRate({ config: { ...config, overrides: { ...config.overrides, terminal_swing_count } }, ...run });
        expect(judged.losses).toEqual([]);
        expect(judged.by_rate!.spans).toHaveLength(3);
    });
});

describe("what the rate judge reads of a run of the copies", () => {
    // a whole copy over 10 seconds: machine 7 makes 2 crafts a second (20 in the span); output inserters 8 and 9 take its
    // product into one chest, each with a target of 4 items a second (40 in the span) and a hand of 4
    const rates: TargetRates = {
        crafts_per_second: new Map([[7, 2]]),
        output_inserters: new Map([[8, { items_per_second: 4, hand: 4 }], [9, { items_per_second: 4, hand: 4 }]]),
        takers: new Map(),
    };
    const run = (made: CopyMade[]): RunOfCopies => ({ shortfalls: [], made, from: 0, to: 600, window_cycles: 10, holds: [] });
    const output = (id: number, items: number): CopyMade => ({ copy: 0, kind: "output_inserter", id, counts: [{ tick: 300, amount: items }] });

    it("judges a copy's output inserters together: one that puts down the hands of the other's target is not behind", () => {
        expect(rateBehind(run([output(8, 80), output(9, 0)]), rates)).toEqual([{ copy: 1, kind: "output_inserter", id: 8, made: 80, target: 80, behind: 0 }]);
        expect(rateBehind(run([output(8, 60), output(9, 0)]), rates)).toEqual([{ copy: 1, kind: "output_inserter", id: 8, made: 60, target: 80, behind: 5 }]);
    });

    const behind = (copy: number, crafts: number): BehindTarget => ({ copy, kind: "machine", id: 7, made: 0, target: 0, behind: crafts });

    it("counts a growth by more than one craft on the behind side only", () => {
        expect(growing([behind(1, 3)], [behind(1, 5)]).map(it => it.behind)).toEqual([5]);
        // one craft more is the grain, not a growth
        expect(growing([behind(1, 3)], [behind(1, 4)])).toEqual([]);
        // a machine further ahead, or one that came back, grows nothing
        expect(growing([behind(1, -2)], [behind(1, -9)])).toEqual([]);
        expect(growing([behind(1, 5)], [behind(1, 0.5)])).toEqual([]);
        // from ahead to more than a craft behind is a growth
        expect(growing([behind(1, -3)], [behind(1, 2)]).map(it => it.behind)).toEqual([2]);
    });
});

describe("the cases #733 leaves open", () => {
    // AGRICULTURAL_SCIENCE_250: its biochambers burn nutrients (and nutrients and bioflux spoil)
    it("leaves a build whose machines burn fuel to the run of one copy alone", async () => {
        expect(rateOpenCaseOfBuild(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250))).toBe("fuel");
    });

    it("leaves a part copy to the run of one copy alone, and judges a build of whole copies whose items do not spoil", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240);
        expect(rateOpenCaseOfBuild({ ...config, setpoint: { ...config.setpoint, copies: 10.5 } })).toBe("part_copy");
        expect(rateOpenCaseOfBuild(config)).toBeNull();
    });

    it("is off by default: the run of one copy alone judges, and the judgement says nothing of the rate", async () => {
        const config = withFacts(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240), { "2/1": dead_end, "2/2": dead_end });
        const judged = judgeSharedLanes(config, { "inserter:1": [{ start: 52, end: 71 }, { start: 76, end: 95 }], "inserter:2": [{ start: 1, end: 49 }] }, 176, quiet);
        expect(judged.by_rate).toBeUndefined();
    });
});
