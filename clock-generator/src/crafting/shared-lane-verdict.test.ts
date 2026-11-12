import path from "path";
import fs from "fs";
import { describe, expect, it } from "vitest";
import { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { loadKeptConfig } from "../../tests/configs/kept-config";
import { SerializableClockWindows } from "./clock";
import { behindTargetIn, CopyMade, judgeSharedLanes, RunOfCopies, TargetRates } from "./shared-lane-verdict";
import { withoutSharedLaneFacts } from "./generate-blueprint-test-helpers";

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** The config with lane facts stated on lanes of it, by "belt/lane" */
function withFacts(config: Config, facts: Record<string, Record<string, unknown>>): Config {
    return { ...config, belts: config.belts.map(belt => ({ ...belt,
        lanes: belt.lanes.map((lane, index) => ({ ...lane, ...(facts[`${belt.id}/${index + 1}`] ?? {}) })) as typeof belt.lanes })) };
}

/** The config with the belts it names stating the way their items move */
function flowing(config: Config, belt_ids: number[], flow_direction: 0 | 4 | 8 | 12): Config {
    return { ...config, belts: config.belts.map(belt => belt_ids.includes(belt.id) ? { ...belt, flow_direction } : belt) };
}

/** The config with the machines it names at a crafting speed of their own, by machine id */
function atSpeeds(config: Config, speeds: Record<number, number>): Config {
    return { ...config, machines: config.machines.map(machine => speeds[machine.id] === undefined ? machine : { ...machine, crafting_speed: speeds[machine.id] }) };
}

const dead_end = { lane_end: { kind: "dead_end" } };

// The scenario's speeds, the inserter build's third copy: the inserter crafting cases below were measured at them, and their hands' timing follows them
const THIRD_COPY_SPEEDS = { 4: 40.3125, 5: 86.1655 };

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
    const stated = flowing(withFacts(config, { "1/1": dead_end, "1/2": dead_end, "2/1": dead_end, "2/2": dead_end }), [1, 2], 4);
    const judged = (id: string, on: Config = stated) => judgeSharedLanes(on, clocks[id].windows, clocks[id].window_cycle_ticks, quiet);
    // the fixture's machines by kind and recipe, the two of a kind and recipe with their numbers, in the game's names
    const CHEMICAL_SCIENCE_MACHINES: Record<number, string> = {
        1: "assembling machine 3 (machine 1) that makes chemical science pack", 2: "assembling machine 3 (machine 2) that makes chemical science pack",
        3: "assembling machine 3 (machine 3) that makes engine unit", 4: "assembling machine 3 (machine 4) that makes engine unit", 5: "foundry that makes casting pipe",
    };

    it.each(["coordinated_sources", "takt_batches_observed"])("fails %s on the second copy alone, its first circuit taker short the most", id => {
        const { losses } = judged(id);
        expect(losses.length).toBeGreaterThan(0);
        expect(new Set(losses.map(loss => loss.copy))).toEqual(new Set([2]));
        expect([losses[0].belt_id, losses[0].lane, losses[0].copy, losses[0].inserter_id, losses[0].flow.x]).toEqual([2, 1, 2, 3, 1]);
        // the game's machine made 19 of 30 hands
        expect(losses[0].items / losses[0].alone_items).toBeCloseTo(2 / 3, 1);
        // a machine of the second copy makes fewer crafts than its target rate in the same run
        const behind = losses[0].behind!;
        expect([behind.copy, behind.kind]).toEqual([2, "machine"]);
        expect(behind.behind).toBeGreaterThan(1);
        expect(losses[0].text).toBe(`Lane 1 of belt 2 ends in a dead end. The 5.5 copies take advanced circuit from it. When the items move east, `
            + `copy 2 from the entry does not get sufficient items. Its inserter 3 takes ${losses[0].items.toLocaleString("en-US")} in ${losses[0].window_cycles} window cycles. `
            + `With no other copy on the lane, it takes ${losses[0].alone_items.toLocaleString("en-US")}. `
            + `In the same run, the ${CHEMICAL_SCIENCE_MACHINES[behind.id]} in copy 2 is ${behind.behind.toLocaleString("en-US", { maximumFractionDigits: 1 })} crafts behind its target rate.`);
    });

    it.each(["time_study_windows", "euclidean_swings"])("holds %s on every copy", id => {
        expect(judged(id)).toMatchObject({ losses: [], simulated: true, lanes: ["1/1", "1/2", "2/1", "2/2"] });
    });

    it("runs a lane that states no flow direction both ways along the copies: the second copy's first taker either way", () => {
        const unstated = withFacts(config, { "1/1": dead_end, "1/2": dead_end, "2/1": dead_end, "2/2": dead_end });
        const worst = (flow: number) => judged("takt_batches_observed", unstated).losses.find(loss => loss.flow.x === flow && loss.belt_id === 2 && loss.lane === 1)!;
        expect([worst(1).copy, worst(1).inserter_id, worst(-1).copy, worst(-1).inserter_id]).toEqual([2, 3, 2, 6]);
    });

    it("checks an unknown end as a dead end and as an infinite end", () => {
        const unknown = withFacts(stated, { "2/1": { lane_end: { kind: "unknown" } } });
        const losses = judged("takt_batches_observed", unknown).losses.filter(loss => loss.belt_id === 2 && loss.lane === 1);
        expect(losses.some(loss => loss.run_as === "dead_end" && loss.copy === 2 && loss.inserter_id === 3)).toBe(true);
        expect(losses.find(loss => loss.run_as === "dead_end")!.text)
            .toContain("Lane 1 of belt 2 has an unknown end. It is checked as a dead end. The 5.5 copies take advanced circuit from it.");
    });

    it("leaves lanes that are per copy to the run of one copy when they end in a dead end", () => {
        const own = { ...dead_end, sharing: "per_copy" };
        const per_copy = withFacts(config, { "1/1": own, "1/2": own, "2/1": own, "2/2": own });
        expect(judged("takt_batches_observed", per_copy)).toMatchObject({ losses: [], simulated: false, lanes: [] });
    });
});

// #660: INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK in the game, three copies 9 tiles apart on two ore belts that run east into
// loaders, both lanes of each an infinite end that never stands (recorded), and an electronic-circuit belt that ends in a
// dead end: its last tile faces nothing, and no item leaves it past the last taker (recorded). The game ran the five clocks
// with these enable windows (read off the recording, a window cycle of 216 ticks): under Takt Batches with 6 swings copy 3
// made about 4,000 of 4,800 a minute, its two ore inserters 82 swings against 99; under the other four every copy made 4,800.
describe("the clocks recorded on the inserter build whose copies share flowing ore lanes", async () => {
    const config = withFacts(await loadKeptConfig(path.join(__dirname, "fixtures", "inserter-crafting-240-3-copies-ore-lines.json")),
        { "2/1": dead_end, "2/2": dead_end });
    const clocks: Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows }> =
        JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "inserter-crafting-240-recorded-clocks.json"), "utf8"));
    const judged = (id: string) => judgeSharedLanes(config, clocks[id].windows, clocks[id].window_cycle_ticks, quiet);

    it("fails takt_batches_swings_6 on copy 3 alone, its ore inserters short", () => {
        const { losses } = judged("takt_batches_swings_6");
        expect(new Set(losses.map(loss => loss.copy))).toEqual(new Set([3]));
        expect(losses.some(loss => loss.belt_id === 1 && loss.item === "iron-ore")).toBe(true);
    });

    it("names the machine of copy 3 that falls more than a thousand crafts behind its target rate under takt_batches_swings_6", () => {
        const { losses } = judged("takt_batches_swings_6");
        const behind = losses[0].behind!;
        expect([behind.copy, behind.kind]).toEqual([3, "machine"]);
        expect(behind.behind).toBeGreaterThan(1000);
        // the electric furnaces 2, 3, 5 and 6 make iron plate: they are told apart by their numbers
        const name = behind.id === 1 ? "assembling machine 3 that makes inserter" : behind.id === 4 ? "assembling machine 3 that makes iron gear wheel"
            : `electric furnace (machine ${behind.id}) that makes iron plate`;
        expect(losses[0].text).toContain(`In the same run, the ${name} in copy 3 is `);
    });

    it.each(["coordinated_sources", "takt_batches_swings_2", "takt_batches_observed_swings_2", "takt_batches_observed_swings_6"])("holds %s on every copy", id => {
        expect(judged(id)).toMatchObject({ losses: [], simulated: true });
    });

    it("runs takt_batches_swings_6 no longer: its copy 3 is short by more than one hand", () => {
        const { losses, longer_run } = judged("takt_batches_swings_6");
        expect(longer_run).toBe(false);
        expect(losses.some(loss => loss.alone_items - loss.items > 16)).toBe(true);
    });

    it.each(["coordinated_sources", "takt_batches_swings_2", "takt_batches_observed_swings_2", "takt_batches_observed_swings_6"])("runs %s no longer: no copy is short", id => {
        expect(judged(id).longer_run).toBe(false);
    });

    // A clock the generator composed for this build (Coordinated Sources on 48 ticks). In the judged window cycles copy 3 is
    // short by one hand (16 items) on inserters 1 and 3 and by none on inserter 4; in the run twice as long it is short by
    // one hand on inserter 4 alone. The hand still being filled at the end of the span falls on another inserter: a lag.
    it("holds a clock whose unfinished hand falls on another inserter in the run twice as long", () => {
        const composed: Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows }> = JSON.parse(fs.readFileSync(
            path.join(__dirname, "fixtures", "inserter-crafting-240-ore-lines-composed-clock-last-hand-on-another-inserter.json"), "utf8"));
        const { windows, window_cycle_ticks } = composed.coordinated_sources;
        expect(judgeSharedLanes(config, windows, window_cycle_ticks, quiet)).toMatchObject({ losses: [], simulated: true, longer_run: true });
    });
});

// ADVANCED_CIRCUIT_240, three copies, every lane an infinite end: a clock the generator made for it (Euclidean Swings on 24
// ticks) has copy 3 short by one hand (16 items) on the electronic circuits of belts 1 and 4 and on the coal of belt 3 in the
// judged window cycles, and in the run twice as long by 32 on belt 1 and 112 on belt 4. Measured on the sample as it was
// before it stated the spacing of its copies and the way its belts move, with the four lanes an infinite end. The sample now
// states that those lanes end in a dead end, and this test is of lanes that flow on: it takes the sample without those
// facts.
describe("a clock whose copy is short by more than one hand in the run twice as long", () => {
    it("fails it on that copy", async () => {
        const infinite_end = { lane_end: { kind: "infinite" } };
        const config = withFacts(withoutSharedLaneFacts(await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240)),
            { "1/1": infinite_end, "3/1": infinite_end, "3/2": infinite_end, "4/1": infinite_end });
        const windows = {
            "inserter:1": [{ start: 2, end: 18 }], "inserter:2": [{ start: 0, end: 0 }], "inserter:3": [{ start: 2, end: 19 }],
            "inserter:4": [{ start: 20, end: 23 }, { start: 0, end: 5 }], "inserter:5": [{ start: 12, end: 23 }, { start: 0, end: 0 }],
            "inserter:6": [{ start: 20, end: 23 }, { start: 0, end: 5 }], "inserter:7": [{ start: 2, end: 19 }], "inserter:8": [{ start: 2, end: 18 }],
            "inserter:9": [{ start: 0, end: 0 }],
        };
        const { losses, longer_run } = judgeSharedLanes(config, windows, 24, quiet);
        expect(longer_run).toBe(true);
        expect(losses.length).toBeGreaterThan(0);
        expect(new Set(losses.map(loss => loss.copy))).toEqual(new Set([3]));
        expect(losses.every(loss => loss.alone_items - loss.items > 16)).toBe(true);
        expect(losses.some(loss => loss.belt_id === 4 && loss.alone_items - loss.items === 112)).toBe(true);
    });
});

// Two clocks the generator made for INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK (Round-Robin Polling with 2 swings on 24
// ticks, and Coordinated Sources composed on 48): in the run of the three copies, copy 3's ore inserters put each hand down
// up to 10 ticks after the run of one copy alone, and that lag does not grow. In the judged window cycles copy 3 is short
// by the one hand still being filled at their end (688 against 704 on 24 ticks; 1,392 against 1,408 and 1,376 against
// 1,392 on 48): in a run twice as long it is short by no more than that. Measured with both lanes of each ore belt an
// infinite end, which the sample stated before it stated the ends the build has; the test keeps those ends.
describe("the clocks whose third copy puts its last ore hand down a few ticks after one copy alone", async () => {
    const infinite_end = { lane_end: { kind: "infinite" } };
    const config = withFacts(atSpeeds(await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK), THIRD_COPY_SPEEDS),
        { "1/1": infinite_end, "1/2": infinite_end, "4/1": infinite_end, "4/2": infinite_end });
    const clocks: Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows }> =
        JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "inserter-crafting-240-generated-clocks-copy-3-one-hand-late.json"), "utf8"));

    it.each(["round_robin_polling_swings_2", "coordinated_sources"])("holds %s on every copy, after a run twice as long", id => {
        expect(judgeSharedLanes(config, clocks[id].windows, clocks[id].window_cycle_ticks, quiet))
            .toMatchObject({ losses: [], simulated: true, longer_run: true });
    });
});

// A clock the generator makes for INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK with its ore lanes' ends as the sample states
// them (Time-Study Windows on 72 ticks, 3 output swings): in the judged window cycles copy 3's inserter 4 puts down 48 iron
// ore (3 hands) fewer than one copy alone, but every machine and every output inserter of every copy keeps its target rate.
// The copy alone is still filling a furnace's plate stock there; copy 3 filled it earlier. The game holds the clock.
describe("a clock whose copy takes less from a shared lane than one copy alone while every machine keeps its target rate", () => {
    it("holds it, with no other run", async () => {
        const config = atSpeeds(await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK), THIRD_COPY_SPEEDS);
        const windows = {
            "inserter:1": [{ start: 0, end: 8 }, { start: 33, end: 44 }, { start: 69, end: 71 }],
            "inserter:2": [{ start: 0, end: 8 }, { start: 33, end: 44 }, { start: 69, end: 71 }],
            "inserter:3": [{ start: 0, end: 8 }, { start: 33, end: 44 }, { start: 69, end: 71 }],
            "inserter:4": [{ start: 16, end: 27 }, { start: 49, end: 60 }],
            "inserter:5": [{ start: 0, end: 3 }, { start: 5, end: 48 }, { start: 50, end: 71 }],
            "inserter:6": [{ start: 0, end: 71 }], "inserter:7": [{ start: 0, end: 71 }],
            "inserter:8": [{ start: 0, end: 31 }, { start: 33, end: 55 }, { start: 58, end: 71 }],
            "inserter:9": [{ start: 1, end: 59 }, { start: 62, end: 72 }],
            "inserter:10": [{ start: 0, end: 71 }], "inserter:11": [{ start: 0, end: 71 }],
        };
        const judged = judgeSharedLanes({ ...config, overrides: { ...config.overrides, terminal_swing_count: 3 } }, windows, 72, quiet);
        expect(judged).toMatchObject({ losses: [], simulated: true, longer_run: false });
    });
});

// The machines and output inserters behind their target in one run of the copies. A build of 3.5 copies over 10 seconds
// (600 ticks): machine 7 of a whole copy makes 2 crafts a second, 20 in the span, and four inserters take from it with
// one hand each an output cycle. The part copy (copy 4) holds machine 7 and two of its four takers, inserter 1 and
// inserter 9, so it is held to half of 20. Inserter 9 is also an output inserter, with its own target of 4 items a
// second (40 in the span) and a hand of 4.
describe("the target a machine or an output inserter of a copy is held to", () => {
    const rates: TargetRates = {
        crafts_per_second: new Map([[7, 2]]),
        output_inserters: new Map([[9, { items_per_second: 4, hand: 4 }]]),
        takers: new Map([[7, ["inserter:1", "inserter:2", "inserter:3", "inserter:9"].map(inserter_id => ({ inserter_id, transfers: 1 }))]]),
    };
    const part_copy = new Set(["machine:7", "inserter:1", "inserter:9"]);
    const run = (made: CopyMade[]): RunOfCopies => ({ shortfalls: [], made, from: 0, to: 600, holds: ["whole", "whole", part_copy] });
    const machine = (copy: number, crafts: number): CopyMade => ({ copy, kind: "machine", id: 7, counts: [{ tick: 300, amount: crafts }] });

    it("holds a part copy's machine with half of its takers to half of a whole copy's target: making half, it is not behind", () => {
        expect(behindTargetIn(run([machine(3, 10)]), rates)).toEqual([]);
    });

    it("finds a part copy's machine behind when it makes less than its share by more than one craft, against the share's target", () => {
        expect(behindTargetIn(run([machine(3, 7)]), rates)).toEqual([{ copy: 4, kind: "machine", id: 7, made: 7, target: 10, behind: 3 }]);
    });

    it("holds a whole copy's machine to the whole target", () => {
        expect(behindTargetIn(run([machine(1, 10)]), rates)).toEqual([{ copy: 2, kind: "machine", id: 7, made: 10, target: 20, behind: 10 }]);
        expect(behindTargetIn(run([machine(0, 20), machine(2, 19)]), rates)).toEqual([]);
    });

    it("holds a part copy's output inserter to its own target", () => {
        const output: CopyMade = { copy: 3, kind: "output_inserter", id: 9, counts: [{ tick: 300, amount: 32 }] };
        expect(behindTargetIn(run([output]), rates)).toEqual([{ copy: 4, kind: "output_inserter", id: 9, made: 32, target: 40, behind: 2 }]);
        expect(behindTargetIn(run([{ ...output, counts: [{ tick: 300, amount: 40 }] }]), rates)).toEqual([]);
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

// The automation science 240 build states its output belt. In the game (three recordings of the whole build) the clock
// takt_batches_observed of the build (4cc378b0763b) leaves copies 4 and 8 short: their side belts fill at their joins onto
// the output belt, and their output inserters wait. Time-Study Windows (b1490c9f2c49) keeps every copy at its rate.
describe("a copy short because its side belt is full at its join onto the output belt", async () => {
    const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
    const output = [{ start: 1, end: 37 }, { start: 109, end: 145 }];
    const clocks: Record<string, SerializableClockWindows> = {
        takt_batches_observed: { "inserter:2": output, "inserter:1": [{ start: 13, end: 38 }, { start: 42, end: 65 }, { start: 133, end: 154 }, { start: 181, end: 193 }] },
        time_study_windows: { "inserter:2": output, "inserter:1": [{ start: 0, end: 50 }, { start: 122, end: 149 }, { start: 159, end: 186 }, { start: 215, end: 215 }] },
    };

    it("says that the copy's join is full, not that the lane gives it too few items", () => {
        const { losses } = judgeSharedLanes(config, clocks.takt_batches_observed, 216, quiet);
        expect(losses.length).toBeGreaterThan(0);
        expect([...new Set(losses.map(loss => loss.copy))].sort()).toEqual([4, 8]);
        for (const loss of losses) {
            expect(loss.join_full).toBeDefined();
            expect(loss.text).toMatch(new RegExp(`^The side belt of copy ${loss.copy} from the entry is full at its join onto the output belt\\. `
                + "Its output inserter waits for room in \\d+ of its \\d+ hands in \\d+ window cycles\\. In the same run, "));
            expect(loss.text).not.toMatch(/does not get sufficient items/);
        }
    });

    it("says the join is full on the clock moved by four ticks too, which the game leaves short at copies 4 and 8", () => {
        const moved = { ...clocks.takt_batches_observed, "inserter:1": [{ start: 17, end: 42 }, { start: 46, end: 69 }, { start: 137, end: 158 }, { start: 185, end: 197 }] };
        const { losses } = judgeSharedLanes(config, moved, 216, quiet);
        expect([...new Set(losses.map(loss => loss.copy))].sort()).toEqual([4, 8]);
        expect(losses.every(loss => loss.join_full !== undefined && loss.side_belt_waits === undefined)).toBe(true);
    });

    it("finds no copy short under the clock that holds every copy", () => {
        expect(judgeSharedLanes(config, clocks.time_study_windows, 216, quiet).losses).toEqual([]);
    });

    // With one output swing a cycle, Time-Study Windows leaves copy 4 short on the input lanes with or without the output
    // belt (inserter 1 takes 1,024 where it takes 1,040 alone; machine 1 is 10 crafts behind either way). Its side belt
    // holds 2 of its 128 hands, which is not the cause.
    it("names the input lane where the output belt does not make the copy further behind, with the held hands as a fact", () => {
        const one_swing = { ...config, overrides: { ...config.overrides, terminal_swing_count: 1 } };
        const windows = { "inserter:1": [{ start: 1, end: 20 }], "inserter:2": [{ start: 2, end: 21 }, { start: 38, end: 56 }] };
        const copy4 = judgeSharedLanes(one_swing, windows, 72, quiet).losses.filter(loss => loss.copy === 4);
        expect(copy4.length).toBe(2);
        for (const loss of copy4) {
            expect(loss.join_full).toBeUndefined();
            expect(loss.side_belt_waits).toEqual({ held_hands: 2, hands: 128 });
            expect(loss.text).toMatch(/^Lane [12] of belt 1 ends in a dead end\. The 9 copies take (iron gear wheel|copper plate) from it\. When the items move east, copy 4 from the entry does not get sufficient items\. Its inserter 1 takes 1,024 in 65 window cycles\. With no other copy on the lane, it takes 1,040\. Its output inserter also waits for room on its side belt in 2 of its 128 hands\. In the same run, the assembling machine 3 that makes automation science pack in copy 4 is 10 crafts behind its target rate\.$/);
        }
    });
});
