import {beforeAll, describe, expect, test} from "vitest";
import {ClockAlternativesResult, generateClockAlternatives} from "./generate-blueprint";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config/schema";
import {alwaysOnReasonProblemsOf} from "./generate-blueprint-test-helpers";

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

// Atlan cell 29 at 9.97 gears/s: the batched clock's period is 2880000/997 ticks, which has no subtick clock (2880000 x
// 997 does not fit a 32-bit signal), so its blueprint counts 2,888 ticks and runs 0.02% fast. In the game it held 480
// gears a period and recovered from two iron ore cuts and a blocked output (#332). A rounded clock meets goal 1 at most
// 0.1% fast and within what the machines make, tried on its own period (GOALS.md, goal 1).
describe("Atlan cell 29: a clock rounded down to whole ticks", () => {
    let config: Config;
    let generated: ClockAlternativesResult;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.REAL_ATLAN_CELL29);
        generated = generateClockAlternatives(config, {logger: quiet});
    });

    test("every inserter and drill a clock leaves always on says why", () => {
        expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
    });

    test("is selected, 0.02% fast, as the 2,888-tick clock it is, and was tried on its own period", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack");
        expect(selected.result.simulation_duration.ticks).toBeCloseTo(2880000 / 997, 6);
        expect(selected.result.subtick).toBeUndefined();
        expect(selected.label).toMatch(/\(clock rounded to 2888 ticks, runs 0\.02% fast\)$/);
        expect(selected.rounded).toMatchObject({period_ticks: 2888, within_machines: true, tried_on_its_period: true});
        expect(selected.assessment.items_per_second).toBeCloseTo(480 * 60 / 2888, 9);
        expect(selected.ranking).toMatchObject({meets_target_rate: true, runs_fast: expect.closeTo(480 * 60 / 2888 / 9.97 - 1, 9)});
        // its clock-only check is of 2,888 ticks: shifted start phases are tried, as for any clock of whole ticks
        expect(selected.result.stability_check.as_built).toMatchObject({holds: true, actual_output_items: 480});
        expect(selected.result.stability_check.as_built!.start_phases_checked).toBeGreaterThan(1);
        expect(selected.result.stability_check.as_built!.wake_ups).toBeDefined();
    });

    test("gets back from every loss on its own period, with a real verdict", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.backpressure_loss).toMatchObject({survives: true, broken_by: []});
        expect(selected.assessment.backpressure_loss_not_tried).toBeUndefined();
        expect(selected.description).toContain("so it is checked on its own 2888-tick period");
    });

    test("leaves the subtick clocks of the exact rate, which do not get back from a loss, unselected", () => {
        const exact = generated.alternatives.filter(alternative => alternative.id.endsWith("-subtick") && alternative.assessment.holds);
        expect(exact.length).toBeGreaterThan(0);
        for (const alternative of exact) {
            expect(alternative.verdict, alternative.id).toBe("no recovery");
            expect(alternative.ranking.meets_target_rate, alternative.id).toBe(false);
        }
    });
});
