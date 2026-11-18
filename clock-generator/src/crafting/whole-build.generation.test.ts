import { beforeAll, describe, expect, it } from "vitest";
import {
    clockOf, lossesOf, nineOnLine, onNine, shortAssemblers, threeCopiesOnLine, threeOf, TWO_SWINGS,
    COORDINATED, COORDINATED_ON_LINE, SIX_OUTPUT_WINDOWS, TIME_STUDY, TWO_OUTPUT_WINDOWS,
} from "../../tests/configs/whole-build-clocks";
import { automationRow } from "../../tests/configs/automation-row";
import { validateConfig } from "./plan/validate-config";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

// The whole build of nine identical automation science assemblers, as a Sidecar export of all nine gives it: a build that
// holds nine copies of one assembler, clocked as it is given, every inserter where it stands. The pair pins that its input
// lanes are checked from the inserters' positions: at 9 tiles the 72-tick clock misses swings on the second input (in the
// game the second machine falls short at some starts), at 6 tiles it holds and is recommended. At 9 tiles the row stands
// for the automation science sample's scaffold and states its output line; at 6 tiles it stands for no scaffold.
// The test of three copies of three assemblers (its generation is of its own) is in whole-build-copies.generation.test.ts:
// no file holds more than one long generation.
describe("a whole build of nine identical assemblers, clocked as given", () => {
    let nine: ClockAlternativesResult;
    let six: ClockAlternativesResult;

    beforeAll(() => {
        nine = generateClockAlternatives(nineOnLine(), { logger: quiet });
        six = generateClockAlternatives(automationRow({ machines: 9, pitch: 6 }), { logger: quiet });
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
