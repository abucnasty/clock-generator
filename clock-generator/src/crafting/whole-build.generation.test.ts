import { beforeAll, describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { validateConfig } from "./plan/validate-config";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";
import type { Config } from "../config";
import type { SerializableClockWindows } from "./clock";
import { judgeSharedLanes } from "./shared-lane-verdict";

/** The 72-tick clock of two output swings each output cycle: outputs open 2-14 and inputs 29-52, a clock the game fails at 9 tiles */
const TWO_SWINGS = "takt_batches_observed_swings_2";

const clockOf = (result: ClockAlternativesResult, id: string) => {
    const clock = result.alternatives.find(alternative => alternative.id === id);
    if (clock === undefined) throw new Error(`no clock ${id}: ${result.alternatives.map(it => it.id).join(", ")}`);
    return clock;
};

const lossesOf = (result: ClockAlternativesResult, id: string) => (clockOf(result, id).assessment.shared_lane_losses ?? [])
    .map(loss => "inserter_id" in loss ? `${loss.inserter_id} ${loss.item} ${loss.swings}/${loss.alone_swings}` : loss.kind);

const INPUT = [{ start: 0, end: 50 }, { start: 122, end: 149 }, { start: 159, end: 186 }, { start: 215, end: 215 }];
const TWO_OUTPUT_WINDOWS = [{ start: 1, end: 37 }, { start: 109, end: 145 }];
const SIX_OUTPUT_WINDOWS = [0, 36, 72, 108, 144, 180].map(start => ({ start, end: start + 3 }));
/** A clock of 216 ticks for a build of three of the assemblers (inserters 1, 3 and 5 the inputs, 2, 4 and 6 the outputs), by the outputs' windows */
const threeOf = (outputs: readonly (typeof TWO_OUTPUT_WINDOWS)[]): SerializableClockWindows => Object.fromEntries(outputs.flatMap((output, index) =>
    [[`inserter:${2 * index + 1}`, INPUT], [`inserter:${2 * index + 2}`, output]]));
/**
 * The clock that Coordinated Sources selected for three copies of three without the output line (784.241 wakeups a
 * minute), and the one of Time-Study Windows (902.088): the same but for the outputs of the first two assemblers
 */
const COORDINATED = threeOf([SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS]);
const TIME_STUDY = threeOf([TWO_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS]);
/** The clock that Coordinated Sources selects for three copies of three on the output line: the second assembler's output in two windows */
const COORDINATED_ON_LINE = threeOf([SIX_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS]);
/** The same windows on the build of nine: assembler k has those of assembler ((k - 1) mod 3) + 1 */
const onNine = (windows: SerializableClockWindows): SerializableClockWindows => Object.fromEntries(Array.from({ length: 18 }, (_, index) =>
    [`inserter:${index + 1}`, windows[`inserter:${(index % 6) + 1}`]]));

/** The assemblers whose input inserter (2k - 1 of a copy of k) takes less on the lanes than alone, upstream first */
const shortAssemblers = (config: Config, windows: SerializableClockWindows) => {
    const per_copy = config.machines.length;
    return [...new Set(judgeSharedLanes(config, windows, 216, quiet).losses
        .map(loss => (loss.copy - 1) * per_copy + (loss.inserter_id + 1) / 2))].sort((a, b) => a - b);
};

/** The row of nine at 9 tiles on the output line of its scaffold, with `off_line` assemblers kept off it */
const nineOnLine = (off_line: number[] = []) => automationRow({ machines: 9, pitch: 9, output_line: { off_line } });
/** Three copies of a build of three of the assemblers, the copies 27 tiles apart: the same row, on the same line */
const threeCopiesOnLine = () => automationRow({ machines: 3, pitch: 9, copies: 3, copy_offset: { x: 27, y: 0 }, output_line: {} });

// The whole build of nine identical automation science assemblers, as a Sidecar export of all nine gives it: a build that
// holds nine copies of one assembler, clocked as it is given, every inserter where it stands. The pair pins that its input
// lanes are checked from the inserters' positions: at 9 tiles the 72-tick clock misses swings on the second input (in the
// game the second machine falls short at some starts), at 6 tiles it holds and is recommended. At 9 tiles the row stands
// for the automation science sample's scaffold and states its output line; at 6 tiles it stands for no scaffold.
describe("a whole build of nine identical assemblers, clocked as given", () => {
    let nine: ClockAlternativesResult;
    let six: ClockAlternativesResult;
    let in_copies: ClockAlternativesResult;

    beforeAll(() => {
        nine = generateClockAlternatives(nineOnLine(), { logger: quiet });
        six = generateClockAlternatives(automationRow({ machines: 9, pitch: 6 }), { logger: quiet });
        in_copies = generateClockAlternatives(threeCopiesOnLine(), { logger: quiet });
    });

    it("passes Check", () => {
        expect(() => validateConfig(nineOnLine())).not.toThrow();
        expect(() => validateConfig(threeCopiesOnLine())).not.toThrow();
        expect(() => validateConfig(automationRow({ machines: 9, pitch: 6 }))).not.toThrow();
    });

    it("at 9 tiles: the 72-tick clock is unstable, the second input short, and another clock is recommended", () => {
        expect(clockOf(nine, TWO_SWINGS).result.simulation_duration.ticks).toBe(72);
        expect(clockOf(nine, TWO_SWINGS).verdict).toBe("unstable");
        expect(lossesOf(nine, TWO_SWINGS)).toEqual(["3 copper-plate 56/65", "3 iron-gear-wheel 58/65"]);
        const selected = nine.alternatives[nine.selected_index];
        expect(selected.id).toBe("coordinated_sources");
        expect(selected.verdict).toBe("stable");
        // every output opens in six windows, but the eighth assembler's in two; in the game every assembler makes 96 in
        // each of 99 window cycles under it
        expect(selected.result.clock_windows).toEqual({ ...onNine(threeOf([SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS])),
            "inserter:16": TWO_OUTPUT_WINDOWS });
    });

    it("at 6 tiles: the same clock holds and is recommended", () => {
        expect(clockOf(six, TWO_SWINGS).result.clock_windows).toEqual(clockOf(nine, TWO_SWINGS).result.clock_windows);
        expect(clockOf(six, TWO_SWINGS).verdict).toBe("stable");
        expect(six.alternatives[six.selected_index].id).toBe(TWO_SWINGS);
    });

    it("works with copies of a build that itself holds like assemblers: the copies and the inserters of a copy are both spaced", () => {
        expect(lossesOf(in_copies, TWO_SWINGS)).toEqual(["3 copper-plate 56/65", "3 iron-gear-wheel 58/65"]);
        expect(clockOf(in_copies, TWO_SWINGS).assessment.shared_lane_losses?.map(loss => "copy" in loss ? loss.copy : null)).toEqual([1, 1]);
        // Coordinated Sources is selected with the second assembler's output in two windows. Without the output line it put
        // the first two assemblers' outputs in six (COORDINATED), which the game fails (below). On the nine assemblers, this
        // clock makes 96 on every assembler in each of 99 window cycles in the game.
        const selected = in_copies.alternatives[in_copies.selected_index];
        expect(selected.id).toBe("coordinated_sources");
        expect(selected.result.clock_windows).toEqual(COORDINATED_ON_LINE);
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
