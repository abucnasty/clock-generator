import { describe, it, expect, beforeAll } from "vitest";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";

describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    // Metallurgic science, by the simulator alone: the build has no scaffold, so nothing of this is recorded in the
    // game. It is pinned because the long run decides it. From the staged start of the simulator (every machine empty,
    // the clock at its tick 0) two clocks of period 106.667 ticks hold the target rate, the batched and the full-hand
    // one, and neither gets back from a loss of tungsten ore or of the packs being taken away; every clock of 2 or
    // more output swings fails the long run, and the plain 1-swing clock is not offered. No clock of the build meets
    // goal 1, so the one nearest to the target rate is selected, and the two that hold tie at 45 a second: the fewest
    // wake-ups decide between them (GOALS.md). Before the staged start the observed windows of the 2-swing clock were
    // selected, and the plain 1-swing clock failed the long run.
    describe("metallurgic science, which only the simulator vouches for", async () => {
        const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        let full_hand: ClockAlternative;
        let batched: ClockAlternative;
        let two_swings: ClockAlternative;

        beforeAll(() => {
            const generated = generateClockAlternatives(config);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
            full_hand = alternatives.find(a => a.label === "Full-hand output swings: 1 output swing per cycle, subtick clock")!;
            batched = alternatives.find(a => a.label === "Batched swings: 1 output swing per cycle, subtick clock")!;
            two_swings = alternatives.find(a => a.label === "2 output swings per cycle, subtick clock")!;
        });

        it("selects the full-hand 1-swing subtick clock at 45 a second: it holds, with fewer wake-ups than the batched clock", () => {
            expect(selected.label).toBe("Full-hand output swings: 1 output swing per cycle, subtick clock");
            expect(selected.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(selected.result.simulation_duration.ticks).toBeCloseTo(320 / 3, 6);
            expect(batched.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(selected.assessment.wake_ups_per_minute!).toBeLessThan(batched.assessment.wake_ups_per_minute!);
        });

        // A build no clock on offer survives backpressure loss on (GOALS.md): it keeps its clocks, named for what they are
        it("calls no clock of the build stable: the clocks that hold do not get back to their rate once the tungsten ore has run out", () => {
            expect(selected.verdict).toBe("no recovery");
            expect(selected.assessment.backpressure_loss?.broken_by).toContain("tungsten-ore stops arriving");
            expect(full_hand.verdict).toBe("no recovery");
            // since the rules of issue 152 a loss of the output breaks it too
            expect(full_hand.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["tungsten-ore stops arriving", "metallurgic-science-pack is not taken away"] });
            expect(full_hand.description).toContain("It does not survive backpressure loss");
            expect(alternatives.some(a => a.verdict === "stable")).toBe(false);
        });

        it("calls the 2-swing clock unstable: it fails the long run, and ranks it after the clocks that hold; the plain 1-swing clock is not offered", () => {
            expect(two_swings.verdict).toBe("unstable");
            expect(alternatives.indexOf(two_swings)).not.toBe(alternatives.indexOf(selected));
            expect(two_swings.ranking.holds_expected_output).toBe(false);
            expect(alternatives.some(a => a.label === "1 output swing per cycle, subtick clock")).toBe(false);
        });
    });
});
