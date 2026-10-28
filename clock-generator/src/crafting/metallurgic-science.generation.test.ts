import { describe, it, expect, beforeAll } from "vitest";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { alwaysOnReasonProblemsOf } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    // Metallurgic science at the speeds the game gives its scaffold (68.875, 40.3125, 180.75, 191.481), its packs taken
    // into a chest that removes them. The science foundry makes 45.19 packs a second against the target of 45, so it
    // has 1 tick to spare in a period of 320. The packs drop into an infinity chest, a sink that never blocks, so each
    // lane-phase start and each loss is judged by the rate over the cycle (terminal-rate.ts). From the staged start of the
    // simulator (every machine empty, the clock at its tick 0) the observed windows of 2 output swings, on a subtick
    // clock, hold the target rate on the moving belts and get back from every loss. Judged exactly in every period, the
    // observed windows of 3 output swings held instead and did not get back from a loss of tungsten ore; by the rate
    // more of their paddings pass the quick check from a dozen starts, the confirmations go to paddings that fail a
    // later start, and the observed windows back off to 2 output swings.
    // The game disagrees about the moving belts. Recorded on the scaffold on 2026-10-21, with the ore belt drained: back
    // to 240 a period after the ore was cut for two periods, and after the output was blocked and the coal cut. In the
    // game the science foundry also runs at its full speed under either clock, where the simulator holds it to the
    // target: 4 or 5 periods in 60 move a hand of 16 more.
    // With the config's speeds rounded up (180.8 for the science foundry) and a chest of 480 packs that was never
    // emptied, the batched and full-hand 1-swing clocks held as well, and no clock got back from a loss.
    describe("metallurgic science", async () => {
        const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        let observed: ClockAlternative;
        let observed_rounded: ClockAlternative;
        let one_swing: ClockAlternative;
        let two_swings: ClockAlternative;

        beforeAll(() => {
            const generated = generateClockAlternatives(config);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
            observed = alternatives.find(a => a.label === "Observed windows: 2 output swings per cycle, subtick clock")!;
            observed_rounded = alternatives.find(a => a.id === "derived")!;
            one_swing = alternatives.find(a => a.label === "1 output swing per cycle, subtick clock")!;
            two_swings = alternatives.find(a => a.label === "2 output swings per cycle, subtick clock")!;
        });

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(alwaysOnReasonProblemsOf(config, { alternatives })).toEqual([]);
        });

        it("selects the observed windows of 2 output swings on a subtick clock at 45 a second: by the rate over the cycle into a sink that never blocks, the only clocks that hold are these windows", () => {
            expect(selected).toBe(observed);
            expect(selected.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(selected.result.subtick?.clock.period_ticks).toBe(640);
            expect(alternatives.filter(a => a.assessment.holds)).toEqual([observed, observed_rounded]);
        });

        it("calls the observed windows stable: by its rate over the cycle into a sink that never blocks, it gets back from every loss, the tungsten ore's included", () => {
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.backpressure_loss).toMatchObject({ survives: true, broken_by: [] });
            expect(selected.result.stability_check.as_built?.long_run_proven).toBe(true);
        });

        it("calls the 1-swing and 2-swing clocks unstable, and ranks them after the clock that holds", () => {
            for (const clock of [one_swing, two_swings]) {
                expect(clock.verdict).toBe("unstable");
                expect(clock).not.toBe(selected);
                expect(clock.ranking.holds_expected_output).toBe(false);
            }
            // listed by the mean of its long run, unrounded per period: the one period the first check measures moved
            // 36 a second
            expect(one_swing.assessment.items_per_second).toBeCloseTo(456 / 13, 6);
        });
    });
});
