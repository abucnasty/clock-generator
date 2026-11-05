import { beforeAll, describe, expect, it } from "vitest";
import { verdictOf } from "./backpressure-loss";
import { backpressureLossOf, generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { alwaysOnReasonProblemsOf, quiet } from "./generate-blueprint-test-helpers";

// The clocks of whole samples, generated and tried for backpressure loss, which takes seconds: the trials themselves and
// the losses a build can have are tested in backpressure-loss.test.ts

// Military science: from the staged start no clock of the build is stable. Two hold 120 a second and are broken by a loss
// (the selected one among them); the others fail the long run and are unstable. The test of a surviving clock selected
// over a broken one is on another sample below.
describe("what the generator calls stable", () => {
    let config: Config;
    let alternatives: ClockAlternative[];
    let selected: ClockAlternative;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_120);
        const generated = generateClockAlternatives(config, { logger: quiet });
        alternatives = generated.alternatives;
        selected = alternatives[generated.selected_index];
    });

    it("names why every inserter and drill a clock leaves always on is", () => {
        expect(alwaysOnReasonProblemsOf(config, { alternatives })).toEqual([]);
    });

    it("tries every clock that holds its expected output for backpressure loss, and no other", () => {
        expect(alternatives.some(alternative => alternative.verdict !== "unstable")).toBe(true);
        expect(alternatives.some(alternative => alternative.verdict === "unstable")).toBe(true);
        for (const alternative of alternatives) {
            expect(alternative.assessment.backpressure_loss !== null, alternative.id).toBe(alternative.verdict !== "unstable");
        }
    });

    it("is a clock that holds its expected output and gets back to it after every loss", () => {
        for (const alternative of alternatives) {
            expect(alternative.verdict === "stable", alternative.id).toBe(alternative.verdict !== "unstable" && alternative.assessment.backpressure_loss!.survives);
            expect(alternative.ranking.meets_target_rate && alternative.verdict !== "stable", alternative.id).toBe(false);
        }
    });

    it("gives a clock the verdict the trials give its windows", () => {
        const report = backpressureLossOf(
            { ...config, overrides: { ...config.overrides, terminal_swing_count: selected.result.used_terminal_swing_count } },
            selected.result.clock_windows, selected.result.simulation_duration.ticks, selected.result.stability_check.expected_output_items, quiet);
        expect(selected.assessment.backpressure_loss).toEqual(verdictOf(report));
    });

    // the build has no deadlock risk (see deadlock-risk.ts): on one that has, the verdict is shown and does not decide
    it("names no deadlock risk on any clock, and has a clock get back from every loss to meet the target rate", () => {
        for (const alternative of alternatives) {
            expect(alternative.deadlock_risks).toEqual([]);
            expect(alternative.insights.some(it => it.id === "deadlock-risk")).toBe(false);
            expect(alternative.ranking.meets_target_rate && alternative.verdict !== "stable", alternative.id).toBe(false);
        }
    });
});
