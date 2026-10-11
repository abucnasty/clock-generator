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
    // does not get back from a loss of tungsten ore. No clock of the build meets goal 1, so the one nearest to the
    // target rate is selected, and the two tie at 45 a second: until 2026-10-11 the full-hand clock was ranked first
    // where a machine has spare speed, and since then the fewest wake-ups decide between them.
    describe("metallurgic science, which only the simulator vouches for", async () => {
        const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        let full_hand: ClockAlternative;

        beforeAll(() => {
            const generated = generateClockAlternatives(config);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
            full_hand = alternatives.find(a => a.label === "Full-hand output swings: 1 output swing per cycle, subtick clock")!;
        });

        it("selects the 1-swing subtick clock at 45 a second, with fewer wake-ups than the full-hand clock at the same rate", () => {
            expect(selected.label).toBe("1 output swing per cycle, subtick clock");
            expect(selected.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(selected.result.simulation_duration.ticks).toBeCloseTo(320 / 3, 6);
            expect(full_hand.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(selected.assessment.wake_ups_per_minute!).toBeLessThan(full_hand.assessment.wake_ups_per_minute!);
        });

        // A build no clock on offer survives backpressure loss on (GOALS.md): it keeps its clocks, named for what they are
        it("calls no clock of the build stable: under the one that holds, it does not get back to its rate once the tungsten ore has run out", () => {
            expect(full_hand.verdict).toBe("no recovery");
            expect(full_hand.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["tungsten-ore stops arriving"] });
            expect(full_hand.description).toContain("It does not survive backpressure loss");
            expect(alternatives.some(a => a.verdict === "stable")).toBe(false);
        });

        it("does not call the plain 1-swing clock of the same period stable", () => {
            expect(selected.verdict).toBe("unstable");
        });
    });
});
