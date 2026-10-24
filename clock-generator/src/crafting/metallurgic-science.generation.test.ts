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
    // has 1 tick to spare in a period of 320. From the staged start of the simulator (every machine empty, the clock at
    // its tick 0) one clock holds the target rate on the moving belts: the observed windows of 3 output swings, which
    // do not get back from a loss of tungsten ore. Every other clock falls short, the plain 1-swing clock among them. No
    // clock of the build meets goal 1, so the one nearest to the target rate is selected (GOALS.md). With the belts
    // backed up, the observed windows of 2 output swings are stable.
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
        let one_swing: ClockAlternative;
        let two_swings: ClockAlternative;
        let backed_up: ClockAlternative;

        beforeAll(() => {
            const generated = generateClockAlternatives(config);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
            observed = alternatives.find(a => a.label === "Observed windows: 3 output swings per cycle")!;
            one_swing = alternatives.find(a => a.label === "1 output swing per cycle, subtick clock")!;
            two_swings = alternatives.find(a => a.label === "2 output swings per cycle, subtick clock")!;
            const backed = generateClockAlternatives({ ...config, overrides: { ...config.overrides, backed_up_belts: true } });
            backed_up = backed.alternatives[backed.selected_index];
        });

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(alwaysOnReasonProblemsOf(config, { alternatives })).toEqual([]);
        });

        it("selects the observed windows of 3 output swings at 45 a second: the only clock that holds", () => {
            expect(selected).toBe(observed);
            expect(selected.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(selected.result.simulation_duration.ticks).toBe(320);
            expect(selected.belt?.kind).toBe("moving");
            expect(alternatives.filter(a => a.assessment.holds)).toEqual([observed]);
        });

        // A build no clock on offer survives backpressure loss on (GOALS.md): it keeps its clocks, named for what they are
        it("calls no clock of the build stable: the one that holds does not get back to its rate once the tungsten ore has run out", () => {
            expect(selected.verdict).toBe("no recovery");
            expect(selected.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["tungsten-ore stops arriving"] });
            expect(selected.result.stability_check.as_built?.long_run_proven).toBe(true);
            expect(alternatives.some(a => a.verdict === "stable")).toBe(false);
        });

        it("calls the 1-swing and 2-swing clocks unstable, and ranks them after the clock that holds", () => {
            for (const clock of [one_swing, two_swings]) {
                expect(clock.verdict).toBe("unstable");
                expect(clock).not.toBe(selected);
                expect(clock.ranking.holds_expected_output).toBe(false);
            }
            // listed by the mean of its long run: the one period the first check measures moved 36 a second
            expect(one_swing.assessment.items_per_second).toBeCloseTo(34.875, 6);
        });

        it("with the belts backed up, selects the observed windows of 2 output swings, which are stable", () => {
            expect(backed_up.label).toBe("Observed windows: 2 output swings per cycle, subtick clock");
            expect(backed_up.verdict).toBe("stable");
            expect(backed_up.assessment.items_per_second).toBeCloseTo(45, 6);
            expect(backed_up.result.subtick?.clock.period_ticks).toBe(640);
        });
    });
});
