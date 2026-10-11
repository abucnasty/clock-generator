import { describe, it, expect, beforeAll } from "vitest";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";

describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    // Metallurgic science, by the simulator alone: the build has no scaffold, so nothing of this is recorded in the
    // game. It is pinned because the long run decides it. The planned 1-swing clock, period 106.667 ticks, was
    // selected only while a fractional period was under-counted: counted over its repeat (320 ticks, 3 periods) it
    // moves 32 too many in the periods judged, the tail of a start-up surplus, and the full-hand clock is selected.
    describe("metallurgic science, which only the simulator vouches for", async () => {
        const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;

        beforeAll(() => {
            const generated = generateClockAlternatives(config);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
        });

        it("selects the full-hand subtick clock, which holds the target of 45 a second", () => {
            expect(selected.label).toBe("Full-hand output swings: 1 output swing per cycle, subtick clock");
            expect(selected.holds_expected_output).toBe(true);
            expect(selected.items_per_second).toBeCloseTo(45, 6);
            expect(selected.result.simulation_duration.ticks).toBeCloseTo(320 / 3, 6);
        });

        // A build no clock on offer survives backpressure loss on (GOALS.md): it keeps its clocks, named for what they are
        it("calls no clock of the build stable: under the one that holds, it does not get back to its rate once the tungsten ore has run out", () => {
            expect(selected.backpressure_loss).toMatchObject({ survives: false, broken_by: ["tungsten-ore stops arriving"] });
            expect(selected.is_stable).toBe(false);
            expect(alternatives.some(a => a.is_stable)).toBe(false);
            expect(selected.description).toContain("It does not survive backpressure loss");
        });

        it("does not call the plain 1-swing clock of the same period stable", () => {
            const one_swing = alternatives.find(a => a.label === "1 output swing per cycle, subtick clock")!;
            expect(one_swing.is_stable).toBe(false);
        });
    });
});
