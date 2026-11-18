import { beforeAll, describe, expect, it } from "vitest";
import { clockOf, nineOnLine, onNine, threeOf, SIX_OUTPUT_WINDOWS, TWO_OUTPUT_WINDOWS } from "../../tests/configs/whole-build-clocks";
import { PITCH_PICKUPS_BACKOFF_VARIABLE } from "./candidates/pitch-pickups";
import { generateClockAlternatives, type ClockAlternativesResult } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";

// docs/clock-candidates.md, "Pitch Pickups": CLOCK_PITCH_PICKUPS_BACKOFF=1 makes Pitch Pickups back off its output swings from the
// plan's count also where the primary clock does not hold. The row of nine automation science assemblers at 9 tiles on its output line
// is the build it was found on: there the primary clock does not hold, so with the switch off Pitch Pickups is the planned clock of two
// swings (the same windows as Pitch Pickups' 72-tick clock in whole-build.generation.test.ts) and Coordinated Sources selects a clock
// with every output in two windows. With the switch on, Pitch Pickups times one full hand in each of two windows of 4 ticks, and
// Coordinated Sources takes those windows for eight of the nine outputs. The switch-off selection is pinned in
// whole-build.generation.test.ts.
/** The inputs of assemblers 4 and 8 in the Time-Study clock on the line: two windows, not four */
const WIDE_INPUT = [{ start: 0, end: 52 }, { start: 122, end: 215 }];
/** Pitch Pickups' outputs with the switch on: one hand in each of two windows of 4 ticks, 36 ticks apart */
const FULL_HAND_OUTPUT = [{ start: 0, end: 3 }, { start: 36, end: 39 }];

function withPitchPickupsBackoff<T>(generate: () => T): T {
    const before = process.env[PITCH_PICKUPS_BACKOFF_VARIABLE];
    process.env[PITCH_PICKUPS_BACKOFF_VARIABLE] = "1";
    try {
        return generate();
    } finally {
        if (before === undefined) delete process.env[PITCH_PICKUPS_BACKOFF_VARIABLE];
        else process.env[PITCH_PICKUPS_BACKOFF_VARIABLE] = before;
    }
}

describe("nine identical assemblers on their line, with Pitch Pickups backing off whatever the primary clock", () => {
    let nine: ClockAlternativesResult;

    beforeAll(() => {
        nine = withPitchPickupsBackoff(() => generateClockAlternatives(nineOnLine(), { logger: quiet }));
    });

    it("Pitch Pickups times a full hand in each output window", () => {
        const pitch = clockOf(nine, "pitch_pickups");
        expect(pitch.result.simulation_duration.ticks).toBe(72);
        expect(pitch.result.clock_windows["inserter:2"]).toEqual(FULL_HAND_OUTPUT);
    });

    it("Coordinated Sources takes those windows for every output but the seventh assembler's", () => {
        const selected = nine.alternatives[nine.selected_index];
        expect(selected.id).toBe("coordinated_sources");
        expect(selected.verdict).toBe("stable");
        expect(selected.result.clock_windows).toEqual({ ...onNine(threeOf([SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS, SIX_OUTPUT_WINDOWS])),
            "inserter:7": WIDE_INPUT, "inserter:14": TWO_OUTPUT_WINDOWS, "inserter:15": WIDE_INPUT });
    });
});
