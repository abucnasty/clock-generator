import path from "path";
import fs from "fs";
import { describe, expect, it } from "vitest";
import { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { SerializableClockWindows } from "./clock";
import { copiesSpanOf, CopiesSpan, judgeSharedLanes, ladderInputsOf, ladderRunOf, runAlone, sharedLaneRunsOf, shortfallsSpanOf } from "./shared-lane-verdict";
import { withTickLedger } from "./tick-ledger";

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

interface Recorded { name: string; holds_in_game: boolean; config: Config; windows: SerializableClockWindows; window_cycle_ticks: number }

const byRate = (it: Pick<Recorded, "config" | "windows" | "window_cycle_ticks">) => judgeSharedLanes(it.config, it.windows, it.window_cycle_ticks, quiet, { by_rate: true });

// The two tests of shared-lane-rate-judge.test.ts that take over 70 s each on CI: the clock takt_batches_swings_6 recorded in
// the game on the inserter build of three copies on ore lanes into loaders, where copy 3 made about 4,000 of 4,800 a minute.
describe("the rate judge on the clock recorded in the game on copies that share lanes (#733), the slow one", async () => {
    const recorded: Recorded[] = [];
    const d1 = withFacts(await loadConfigFromFile(path.join(FIXTURES, "inserter-crafting-240-3-copies-ore-lines.json")), { "2/1": dead_end, "2/2": dead_end });
    for (const [id, clock] of Object.entries(clocksOf("inserter-crafting-240-recorded-clocks.json"))) {
        if (id !== "takt_batches_swings_6") continue;
        recorded.push({ name: `inserter build, ore lanes into loaders: ${id}`, holds_in_game: false, config: d1, ...clock });
    }

    it.each(recorded)("$name: judged by the rate, as the game", it => {
        const judged = byRate(it);
        expect(judged.by_rate).toMatchObject({ spans: expect.any(Array) });
        expect(judged.losses.length === 0).toBe(it.holds_in_game);
    });

    it.each(recorded)("$name: a loss only after four times the run, its machine further behind at each doubling", it => {
        const judged = byRate(it);
        expect(judged.by_rate!.spans).toHaveLength(3);
        const behind = judged.losses[0].behind!;
        expect(behind.kind).toBe("machine");
        // more than a craft a window cycle behind over the run four times as long: a shortfall that grows with the run
        expect(behind.behind).toBeGreaterThan(judged.by_rate!.spans![2] / 2);
    });
});

// The rate judge makes one run of the copies on each layout, read at the end of the long run's window cycles and of twice
// as many while it goes on (`ladderRunOf`). Told to go on at each end, every reading is the one a run made for that many
// window cycles gives, and so is the reading at its end of four times as many, the logged facts included where asked for.
describe("the rate judge's one run of the copies, read at each end as a run made for that many window cycles", async () => {
    interface Clock { name: string; config: Config; windows: SerializableClockWindows; window_cycle_ticks: number; for_log: boolean }
    const clocks: Clock[] = [];
    // the clocks of shared-lane-rate-judge.test.ts: of its part copy the judge runs no ladder, and takt_batches_swings_6 is left out
    // for its time (its judging tests above judge it)
    const d1 = withFacts(await loadConfigFromFile(path.join(FIXTURES, "inserter-crafting-240-3-copies-ore-lines.json")), { "2/1": dead_end, "2/2": dead_end });
    for (const [id, clock] of Object.entries(clocksOf("inserter-crafting-240-recorded-clocks.json"))) {
        if (id === "takt_batches_swings_6") continue;
        clocks.push({ name: `inserter build, ore lanes into loaders: ${id}`, config: d1, ...clock, for_log: false });
    }
    const sample = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
    const third_copy_speeds: Record<number, number> = { 4: 40.3125, 5: 86.1655 };
    for (const [id, { terminal_swing_count, ...clock }] of Object.entries(clocksOf("inserter-crafting-240-ends-stated-recorded-clocks.json"))) {
        const at_speeds = id === "time_study_windows"
            ? { ...sample, machines: sample.machines.map(machine => third_copy_speeds[machine.id] === undefined ? machine : { ...machine, crafting_speed: third_copy_speeds[machine.id] }) }
            : sample;
        clocks.push({ name: `inserter build, ore lanes' ends stated: ${id}`, config: { ...at_speeds, overrides: { ...at_speeds.overrides, terminal_swing_count } }, ...clock, for_log: false });
    }
    const frame = await loadConfigFromFile(path.join(FIXTURES, "flying-robot-frame-80-12-copies-recorded.json"));
    for (const [id, clock] of Object.entries(clocksOf("flying-robot-frame-80-recorded-clocks.json"))) {
        for (const for_log of id === "time_study_windows_planner" ? [false, true] : [false]) {
            clocks.push({ name: `flying robot frame build: ${id}${for_log ? ", with the log" : ""}`, config: frame, ...clock, for_log });
        }
    }
    clocks.push({ name: "logistic science build of 11 copies: batched swings", for_log: false,
        config: withFacts(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240), { "2/1": dead_end, "2/2": dead_end }), window_cycle_ticks: 176,
        windows: { "inserter:1": [{ start: 52, end: 71 }, { start: 76, end: 95 }], "inserter:2": [{ start: 1, end: 49 }] } });
    const electromagnetic = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED);
    const { terminal_swing_count, ...electromagnetic_clock } = clocksOf("electromagnetic-science-240-recycler-coordinated-sources.json").coordinated_sources;
    for (const for_log of [false, true]) {
        clocks.push({ name: `electromagnetic science build, 175 % productivity: coordinated_sources${for_log ? ", with the log" : ""}`, for_log,
            config: { ...electromagnetic, overrides: { ...electromagnetic.overrides, terminal_swing_count } }, ...electromagnetic_clock });
    }

    const FIELDS = ["shortfalls", "made", "from", "to", "window_cycles", "holds", "join_full", "join_waits", "output_swings", "for_log"] as const;
    const expectSame = (read: CopiesSpan, made: CopiesSpan, what: string) => {
        for (const field of FIELDS) {
            expect(field in read.run, `${what}: ${field} given`).toBe(field in made.run);
            expect(read.run[field], `${what}: ${field}`).toStrictEqual(made.run[field]);
        }
        expect(read.last_tick, `${what}: the last tick judged up to`).toBe(made.last_tick);
        expect(read.run, what).toStrictEqual(made.run);
    };

    it.each(clocks)("$name", ({ config, windows: clock_windows, window_cycle_ticks, for_log }) => {
        withTickLedger(() => {}, () => {
            const { lanes, windows, window_cycles, ends, output_ids } = ladderInputsOf(config, clock_windows, window_cycle_ticks);
            for (const [reading, { under, layouts }] of sharedLaneRunsOf(config).readings.entries()) {
                const taker_ids = [...new Set(layouts[0].rows.flatMap(row => row.takers.map(taker => taker.inserter_id)))];
                const alone = runAlone(under, taker_ids, windows, window_cycle_ticks, 4 * window_cycles, quiet, output_ids);
                for (const [at, layout] of layouts.entries()) {
                    const what = `reading ${reading}, layout ${at}`;
                    const made = [1, 2].map(multiple => copiesSpanOf(under, layout, windows, window_cycle_ticks, multiple * window_cycles, quiet, ends));
                    const made_errors: string[] = [], read_errors: string[] = [];
                    const made_four = shortfallsSpanOf(under, lanes, layout, alone, windows, window_cycle_ticks, 4 * window_cycles, quiet, ends,
                        for_log ? { reading, errors: made_errors } : null);
                    const asked: number[] = [];
                    const read = ladderRunOf(under, lanes, layout, windows, window_cycle_ticks, window_cycles, quiet, ends, for_log ? { reading, errors: read_errors } : null,
                        (_, multiple) => { asked.push(multiple); return true; }, () => alone);
                    expect(asked, what).toEqual([1, 2]);
                    read.spans.forEach((span, index) => expectSame(span, made[index], `${what}, ${index + 1} times the long run`));
                    expect(read.four, what).toBeDefined();
                    const { alone: four_alone, ...four } = read.four!;
                    expect(four_alone).toBe(alone);
                    expectSame(four, made_four, `${what}, 4 times the long run`);
                    expect(read_errors, `${what}: the log's errors`).toEqual(made_errors);
                    if (for_log) expect(made_four.run.for_log, `${what}: the log asked for`).toBeDefined();
                }
            }
        });
    }, 1_200_000);
});
