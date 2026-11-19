import { beforeAll, describe, expect, it } from "vitest";
import {
    clockOf, nineOnLine, onNine, shortAssemblers, threeCopiesOnLine, threeOf, TWO_SWINGS,
    COORDINATED, COORDINATED_ON_LINE, SIX_OUTPUT_WINDOWS, TIME_STUDY, TWO_OUTPUT_WINDOWS,
} from "../../tests/configs/whole-build-clocks";
import { automationRow } from "../../tests/configs/automation-row";
import { validateConfig } from "./plan/validate-config";
import { generateClockAlternatives, planClockAlternatives, runClockAlternativeTask, type ClockAlternativesResult } from "./alternatives";
import { clockFromWindows } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";
import { judgeSharedLanes } from "./shared-lane-verdict";

// The whole build of nine identical automation science assemblers, as a Sidecar export of all nine gives it: a build that
// holds nine copies of one assembler, clocked as it is given, every inserter where it stands. The pair pins that its input
// lanes are checked from the inserters' positions: at 9 tiles the 72-tick clock of 6 tiles misses swings on the second input
// (in the game the second machine falls short at some starts), at 6 tiles it holds and is recommended. At 9 tiles the row stands
// for the automation science sample's scaffold and states its output line; at 6 tiles it stands for no scaffold.
// The test of three copies of three assemblers (its generation is of its own) is in whole-build-copies.generation.test.ts:
// no file holds more than one long generation.
// The row at 9 tiles runs its output line in every run of a clock (src/crafting/output-belt-run.ts). There the 216-tick Takt Batches
// clock 8191de109ece falls short: assemblers 4 and 8 make 80 to 92 a window cycle, as in the game (Factorio 2.1.24: no steady state
// in 36,000 ticks, from ruling 60's start and from a warm-up), so the primary clock does not hold. Pitch Pickups still backs its
// swings off from the plan's count and times a full hand in each output window; Coordinated Sources takes those windows for every
// output but the seventh assembler's (2,367.6 wakeups a minute; 2,852.2 without them). In the game that clock holds from ruling
// 60's start (13,824 of 13,824 over 16 window cycles). The whole generation of the row takes about six times as long as Pitch
// Pickups' alone (Coordinated Sources composes more clocks from the full-hand windows), so only Pitch Pickups is made here, and the
// clock Coordinated Sources composes of its windows is checked as given.
/** Pitch Pickups' outputs at 9 tiles: one hand in each of two windows of 4 ticks, 36 ticks apart */
const FULL_HAND_OUTPUT = [{ start: 0, end: 3 }, { start: 36, end: 39 }];
/** Assemblers 4 and 8's inputs in the Time-Study clock at 9 tiles: two windows, not four */
const WIDE_INPUT = [{ start: 0, end: 52 }, { start: 122, end: 215 }];
/** The clock Coordinated Sources selects at 9 tiles: Pitch Pickups' outputs but the seventh assembler's, Time-Study's inputs */
const COORDINATED_FULL_HANDS = { ...onNine(threeOf([SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS])),
    "inserter:7": WIDE_INPUT, "inserter:14": TWO_OUTPUT_WINDOWS, "inserter:15": WIDE_INPUT };

describe("a whole build of nine identical assemblers, clocked as given", () => {
    let six: ClockAlternativesResult;

    beforeAll(() => {
        six = generateClockAlternatives(automationRow({ machines: 9, pitch: 6 }), { logger: quiet });
    });

    it("passes Check", () => {
        expect(() => validateConfig(nineOnLine())).not.toThrow();
        expect(() => validateConfig(threeCopiesOnLine())).not.toThrow();
        expect(() => validateConfig(automationRow({ machines: 9, pitch: 6 }))).not.toThrow();
    });

    it("at 9 tiles: the 72-tick clock of 6 tiles leaves the second input short", () => {
        const windows = clockOf(six, TWO_SWINGS).result.clock_windows;
        expect(clockOf(six, TWO_SWINGS).result.simulation_duration.ticks).toBe(72);
        expect(judgeSharedLanes(nineOnLine(), windows, 72, quiet).losses
            .map(loss => `${loss.inserter_id} ${loss.item} ${loss.swings}/${loss.alone_swings}`))
            .toEqual(["3 copper-plate 214/245", "3 iron-gear-wheel 215/245"]);
    });

    it("at 9 tiles: Pitch Pickups times a full hand in each output window, though the primary clock does not hold", () => {
        const plan = planClockAlternatives(nineOnLine(), { logger: quiet });
        expect(plan.context.primary_stable).toBe(false);
        const pitch = runClockAlternativeTask(nineOnLine(), plan.context, "full-hand", { logger: quiet })!.alternatives[0];
        expect(pitch.result.simulation_duration.ticks).toBe(72);
        expect(pitch.result.clock_windows["inserter:2"]).toEqual(FULL_HAND_OUTPUT);
    });

    it("at 9 tiles: the clock Coordinated Sources composes of those windows holds as built", () => {
        const config = nineOnLine();
        const made = clockFromWindows({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, terminal_swing_count: 3 } },
            COORDINATED_FULL_HANDS, 216, quiet);
        expect(made.stability_check.as_built?.holds).toBe(true);
        expect(made.stability_check.as_built?.wake_ups?.wake_ups_per_minute).toBeCloseTo(2367.58, 2);
    });

    it("at 6 tiles: the 72-tick clock holds and is recommended", () => {
        expect(clockOf(six, TWO_SWINGS).verdict).toBe("stable");
        expect(six.alternatives[six.selected_index].id).toBe(TWO_SWINGS);
    });
});

// The same row on the output line of its scaffold (the automation science sample's): the outputs of assemblers 1 to 4
// side-load onto one lane, one after another. In the game (Factorio 2.1.24, the windows of three copies of three on the
// nine assemblers, 99 whole window cycles after a warm-up of 3,600 ticks) every assembler makes its 96 packs a window
// cycle under both clocks, but for assembler 3 under the first: 80 in every second window cycle. Its side belt stands full
// while the packs of assemblers 1 and 2 pass its join. With the output of assembler 3, or of assemblers 1 and 2, kept off
// the line, assembler 3 makes 96 in every window cycle under the same clock.
describe("a whole build of nine identical assemblers on the output line of its scaffold", () => {
    it("nine in one copy: the first clock leaves assembler 3 short, the second holds every assembler", () => {
        expect(shortAssemblers(nineOnLine(), onNine(COORDINATED))).toEqual([3]);
        expect(shortAssemblers(nineOnLine(), onNine(TIME_STUDY))).toEqual([]);
    });

    it("nine in one copy: under the first clock assembler 3 holds when its output, or that of assemblers 1 and 2, is off the line", () => {
        expect(shortAssemblers(nineOnLine([3]), onNine(COORDINATED))).toEqual([]);
        expect(shortAssemblers(nineOnLine([1, 2]), onNine(COORDINATED))).toEqual([]);
    });

    it("three copies of three: the first clock leaves assembler 3 short, the second holds every assembler", () => {
        expect(shortAssemblers(threeCopiesOnLine(), COORDINATED)).toEqual([3]);
        expect(shortAssemblers(threeCopiesOnLine(), TIME_STUDY)).toEqual([]);
    });

    it("the clock selected for three copies of three holds every assembler on the line, in one copy and in three", () => {
        expect(shortAssemblers(nineOnLine(), onNine(COORDINATED_ON_LINE))).toEqual([]);
        expect(shortAssemblers(threeCopiesOnLine(), COORDINATED_ON_LINE)).toEqual([]);
    });
});
