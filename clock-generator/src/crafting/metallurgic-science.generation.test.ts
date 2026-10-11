import { describe, it, expect, beforeAll } from "vitest";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";

describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    // Metallurgic science, by the simulator alone: the build has no scaffold, so nothing of this is recorded in the
    // game. It is pinned because the long run decides it. The planned 1-swing clock, period 106.667 ticks, holds
    // from the generator's start and fails the long run: counted over its repeat (320 ticks, 3 periods) it moves 32
    // too many in the periods judged, the tail of a start-up surplus. The full-hand clock of the same period holds and
    // does not get back from a loss of tungsten ore. Since the one search of 2026-10-11 the observed windows of the
    // 2-swing clock (213.333 ticks) hold too, at fewer wake-ups than either, and do not get back from three losses. No
    // clock of the build meets goal 1, so the one nearest to the target rate is selected, and the three tie at 45 a
    // second: the two that hold come before the one that does not (GOALS.md), and the fewest wake-ups decide between them.
    describe("metallurgic science, which only the simulator vouches for", async () => {
        const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        let full_hand: ClockAlternative;
        let one_swing: ClockAlternative;

        beforeAll(() => {
            const generated = generateClockAlternatives(config);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
            full_hand = alternatives.find(a => a.label === "Full-hand output swings: 1 output swing per cycle, subtick clock")!;
            one_swing = alternatives.find(a => a.label === "1 output swing per cycle, subtick clock")!;
        });

        it("selects the observed windows of the 2-swing subtick clock at 45 a second: it holds, with fewer wake-ups than the full-hand clock", () => {
            expect(selected.label).toBe("Observed windows: 2 output swings per cycle, subtick clock");
            expect(selected.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(selected.result.simulation_duration.ticks).toBeCloseTo(640 / 3, 6);
            for (const other of [full_hand, one_swing]) {
                expect(other.assessment.items_per_second).toBeCloseTo(45, 6);
                expect(selected.assessment.wake_ups_per_minute!).toBeLessThan(other.assessment.wake_ups_per_minute!);
            }
        });

        // A build no clock on offer survives backpressure loss on (GOALS.md): it keeps its clocks, named for what they are
        it("calls no clock of the build stable: the clocks that hold do not get back to their rate once the tungsten ore has run out", () => {
            expect(selected.verdict).toBe("no recovery");
            expect(selected.assessment.backpressure_loss?.broken_by).toContain("tungsten-ore stops arriving");
            expect(full_hand.verdict).toBe("no recovery");
            expect(full_hand.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["tungsten-ore stops arriving"] });
            expect(full_hand.description).toContain("It does not survive backpressure loss");
            expect(alternatives.some(a => a.verdict === "stable")).toBe(false);
        });

        it("calls the plain 1-swing clock of the same rate unstable: it fails the long run, and ranks it after the two that hold", () => {
            expect(one_swing.verdict).toBe("unstable");
            expect(alternatives.indexOf(one_swing)).not.toBe(alternatives.indexOf(selected));
            expect(one_swing.ranking.holds_expected_output).toBe(false);
        });
    });
});
