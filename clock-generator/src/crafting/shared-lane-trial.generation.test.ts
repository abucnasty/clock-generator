import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { Config } from "../config/schema";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";
import { copiesDisturbanceTrial } from "./shared-lane-trial";
import { judgeSharedLanes, sharedLaneRunsOf } from "./shared-lane-verdict";
import { disturbanceTrialOf } from "./trial";
import { currentRunMemo, withRunMemo } from "./plan/run-memo";
import { runOnSharedLanes } from "./shared-lane-model";
import { OpenRange } from "../data-types";

const dead_end = { kind: "dead_end" } as const;

/** The config with both lanes of belt 1 dead ends, the belt running east, and the copies `tiles` apart along it */
function deadEndedEast(config: Config, tiles: number): Config {
    return { ...config, setpoint: { ...config.setpoint, copy_offset: { x: tiles, y: 0 } },
        belts: config.belts.map(belt => belt.id !== 1 ? belt : { ...belt, flow_direction: 4,
            lanes: belt.lanes.map(lane => ({ ...lane, lane_end: dead_end })) as typeof belt.lanes }) };
}

// ELECTROMAGNETIC_SCIENCE_330 as abucnasty built it: 11 copies on one belt, accumulators on lane 1 and supercapacitors on
// lane 2, both lanes dead ends that the supply fills at what the copies take, the copies 11 tiles apart. A clock of 704
// ticks (2 output swings, 352 packs a copy a window cycle) found for that spacing holds on one copy, gets back from every
// loss there, and keeps every copy at its target on the shared lanes. In the game, with the two accumulator supply
// inserters off for 2,010 ticks, copy 3 settled at 25 packs a second (272 to 304 a window cycle) for the 42,240 ticks
// judged, and the other ten went back to 30 (recorded 2026-11-10).
const em_clock = {
    window_cycle_ticks: 704,
    terminal_swing_count: 2,
    windows: {
        "inserter:1": [[19, 23], [68, 72], [138, 152], [194, 210], [260, 285], [324, 328], [392, 411], [452, 465], [522, 557], [588, 593], [639, 661]],
        "inserter:2": [[1, 9], [65, 72], [129, 137], [193, 201], [257, 264], [321, 329], [385, 393], [449, 456], [513, 521], [577, 584], [641, 648]],
        "inserter:3": [[1, 9], [65, 72], [129, 137], [193, 201], [257, 264], [321, 329], [385, 393], [449, 456], [513, 521], [577, 584], [641, 648]],
    },
};
const windowsByRange = (windows: Record<string, { start: number; end: number }[]>) =>
    new Map(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
const windowsOf = (windows: Record<string, number[][]>) => Object.fromEntries(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(([start, end]) => ({ start, end }))]));

describe("the disturbance trials on the copies that share a dead-ended lane", () => {
    it("find no recovery where a copy stays short after the supply stops at the lane's entry, naming the lane, the copies and what each settles at", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330);
        const config = deadEndedEast({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: em_clock.terminal_swing_count } }, 11);
        const windows = windowsOf(em_clock.windows);
        // on one copy, and on the copies from the cold start, the clock holds
        expect(disturbanceTrialOf(config, windows, em_clock.window_cycle_ticks, 352, quiet).survives).toBe(true);
        expect(judgeSharedLanes(config, windows, em_clock.window_cycle_ticks, quiet).losses).toEqual([]);

        const verdict = copiesDisturbanceTrial(config, windows, em_clock.window_cycle_ticks, 352, quiet)!;
        // the supplies are tried in the order the inserters meet them: the supercapacitors first, and that stop, run until the
        // copies have stopped and restored a quarter into the window cycle, leaves copy 3 short for good
        expect(verdict).toMatchObject({ survives: false, broken_by: "supercapacitor stops arriving", lanes: ["1/1", "1/2"], recovered_after_window_cycles: null,
            trial: { cut_at: 176, until_stopped: true }, short: [{ copy: 3, items_per_window_cycle: [288, 304, 288] }] });
        expect(verdict.text).toBe("Supercapacitor stops arriving at the entry of the supercapacitor lane, which the 11 copies share, and comes back. "
            + "Copy 3 from the entry ends at 288, 304 and 288 a window cycle, where one copy makes 352.");

        // the accumulators stopped as in the game: copy 3 ends at 25 packs a second, 272 to 304 a window cycle, and the others at 352
        const { readings } = sharedLaneRunsOf(config);
        const accumulator = runOnSharedLanes(readings[0].under, windowsByRange(windows), em_clock.window_cycle_ticks, readings[0].layouts[0], 1, quiet, undefined,
            { loss: { kind: "supply", item: "accumulator" }, window_cycle_ticks: em_clock.window_cycle_ticks, expected_output_items: 352 }).disturbance_trial!;
        const last = accumulator.trials[accumulator.trials.length - 1];
        expect(accumulator.recovers).toBe(false);
        expect(last.copies!.filter(it => !it.recovers)).toEqual([{ copy: 3, recovers: false, ends_in: [304, 272, 304] }]);
        expect(last.copies!.filter(it => it.recovers).every(it => it.ends_in.every(items => items === 352))).toBe(true);
    });
});

// LOGISTIC_SCIENCE_240 in the game: one row of the build is 11 copies 6 tiles apart on a feed belt whose two lanes are dead
// ends, taken at 120 of 120 a second. The recommended clock (4 output swings, 176 ticks) moved 704 packs in every one of
// 21 window cycles in each row, 64 a copy.
describe("the disturbance trials on the copies of a build whose copies all get back", () => {
    it("find every copy back at the expected output of one copy after every loss", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240);
        const config = { ...sample, belts: sample.belts.map(belt => belt.id !== 2 ? belt
            : { ...belt, lanes: belt.lanes.map(lane => ({ ...lane, lane_end: dead_end })) as typeof belt.lanes }) };
        const windows = { "inserter:1": [{ start: 52, end: 71 }, { start: 76, end: 95 }], "inserter:2": [{ start: 1, end: 49 }] };
        const verdict = copiesDisturbanceTrial(config, windows, 176, 64, quiet)!;
        expect(verdict.survives).toBe(true);
        expect(verdict.lanes).toEqual(["2/1", "2/2"]);
        expect(verdict.recovered_after_window_cycles).not.toBeNull();
        expect([verdict.broken_by, verdict.short, verdict.not_tried]).toEqual([undefined, undefined, undefined]);
    });
});

describe("a build whose copies share no lane", () => {
    it("is not run on copies: no run is made, nothing is kept", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_EXACT_SPEED);
        const memo = withRunMemo(() => {
            expect(copiesDisturbanceTrial(config, {}, 144, 960, quiet)).toBeNull();
            return currentRunMemo()!;
        });
        expect([memo.size, memo.copies_trials_made, memo.copies_trial_hits]).toEqual([0, 0, 0]);
    });

    it("gets the same alternatives with the trials on the copies on and off", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_EXACT_SPEED);
        const on = generateClockAlternatives(config, { logger: quiet });
        const off = generateClockAlternatives({ ...config, overrides: { ...config.overrides, disturbance_trials_on_copies: false } }, { logger: quiet });
        expect(on.alternatives.length).toBeGreaterThan(0);
        expect(JSON.stringify(on.alternatives)).toBe(JSON.stringify(off.alternatives));
        expect(on.alternatives.every(it => it.assessment.disturbance_trial?.on_copies === undefined)).toBe(true);
    });
});

// AUTOMATION_SCIENCE_240: 9 copies on one belt whose two lanes are dead ends. Its selected clock (pitch pickups, 72 ticks)
// gets back from every loss on one copy, and on the copies a copper plate stop leaves copy 2 short.
describe("the verdict of a clock the trials on the copies break", () => {
    it("is no recovery, naming the loss on the copies, and stable with the trials on the copies switched off", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const on = generateClockAlternatives(config, { logger: quiet });
        const off = generateClockAlternatives({ ...config, overrides: { ...config.overrides, disturbance_trials_on_copies: false } }, { logger: quiet });
        const clock = on.alternatives.find(it => it.id === "pitch_pickups")!;
        const alone = off.alternatives.find(it => it.id === "pitch_pickups")!;
        expect(clock.verdict).toBe("no recovery");
        expect(clock.assessment.disturbance_trial).toMatchObject({ survives: false, broken_by: ["copper plate stops arriving on the copies that share a lane"],
            on_copies: { survives: false, broken_by: "copper plate stops arriving", short: [{ copy: 2 }] } });
        expect(clock.description).toContain("Copper plate stops arriving at the entry of the copper plate lane");
        expect(alone.verdict).toBe("stable");
        expect(alone.assessment.disturbance_trial?.on_copies).toBeUndefined();
    });
});
