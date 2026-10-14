import { beforeAll, describe, expect, it } from "vitest";
import { lossId, verdictOf, type BackpressureLossReport } from "./backpressure-loss";
import { backpressureLossOf, generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

// The clocks of whole samples, generated and tried for backpressure loss, which takes seconds: the trials themselves and
// the losses a build can have are tested in backpressure-loss.test.ts

// Automation science: copper plates and gear wheels off one belt into a machine, the packs onto another
describe("a clock tried for backpressure loss", () => {
    let config: Config;
    let selected: ClockAlternative;
    let report: BackpressureLossReport;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        selected = alternatives[selected_index];
        report = backpressureLossOf(config, selected.result.clock_windows, selected.result.simulation_duration.ticks,
            selected.result.stability_check.expected_output_items, quiet);
    });

    // Pinned before the supply gates were added: the selected clock of the sample and its windows are the same with
    // them in place, since a run in which nothing is cut is the run it was before
    it("is selected and stable at the target rate, as it was before a loss was ever tried", () => {
        expect(selected.id).toBe("full-hand");
        expect(selected.result.simulation_duration.ticks).toBe(72);
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.items_per_second).toBeCloseTo(config.target_output.items_per_second, 6);
    });

    it("is run once with nothing cut, where it makes what the generator's own check found", () => {
        expect(report.undisturbed.trials).toHaveLength(1);
        expect(report.undisturbed.recovers).toBe(selected.verdict === "stable");
        expect(report.undisturbed.expected_per_bin).toBe(selected.result.stability_check.expected_output_items);
    });

    it("makes the 16 trials of every loss: 4 that run their course and 12 that end part of the way", () => {
        expect(report.losses.map(outcome => lossId(outcome.loss)).sort()).toEqual(["output:automation-science-pack", "supply:copper-plate", "supply:iron-gear-wheel"]);
        for (const outcome of report.losses) {
            expect(outcome.trials.filter(trial => trial.until_stopped)).toHaveLength(4);
            expect(outcome.trials.filter(trial => !trial.until_stopped)).toHaveLength(12);
        }
    });

    it("stops the build with every loss that runs its course: the machine runs dry or fills up", () => {
        for (const outcome of report.losses) {
            expect(outcome.stopped_after_ticks, lossId(outcome.loss)).not.toBeNull();
            expect(outcome.trials.filter(trial => trial.until_stopped).every(trial => trial.loss_ticks > 0)).toBe(true);
        }
    });

    it("survives when it is back at its expected output after every trial, and names the losses that break it when not", () => {
        expect(report.survives).toBe(report.undisturbed.recovers && report.losses.every(outcome => outcome.recovers));
        expect(report.broken_by).toEqual(report.losses.filter(outcome => !outcome.recovers).map(outcome => lossId(outcome.loss)));
        expect(report.recovered_after_periods === null).toBe(!report.survives);
    });

    it("is put in the words a list of clocks needs: whether it survives, and the losses it does not get back from", () => {
        const verdict = verdictOf(report);
        expect(verdict.survives).toBe(report.survives);
        expect(verdict.recovered_after_periods).toBe(report.recovered_after_periods);
        expect(verdictOf({ ...report, survives: false, losses: report.losses.map(outcome => ({ ...outcome, recovers: outcome.loss.kind !== "supply" })) }).broken_by)
            .toEqual(["copper-plate stops arriving", "iron-gear-wheel stops arriving"]);
    });

    it("cuts at fewer places when asked, to make the run shorter", () => {
        const shorter = backpressureLossOf(config, selected.result.clock_windows, selected.result.simulation_duration.ticks,
            selected.result.stability_check.expected_output_items, quiet, { places: [0] });
        expect(shorter.losses.every(outcome => outcome.trials.length === 4)).toBe(true);
    });
});

// Military science: every clock but one holds 120 a second and does not get back to it once the coal has run out
describe("what the generator calls stable", () => {
    let config: Config;
    let alternatives: ClockAlternative[];
    let selected: ClockAlternative;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE);
        const generated = generateClockAlternatives(config, { logger: quiet });
        alternatives = generated.alternatives;
        selected = alternatives[generated.selected_index];
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

    it("selects a clock that survives over one with a better rank that does not", () => {
        const full_hand = alternatives.find(alternative => alternative.id === "full-hand")!;
        expect(full_hand.verdict).not.toBe("unstable");
        expect(full_hand.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["coal stops arriving"], recovered_after_periods: null });
        expect(full_hand.verdict).not.toBe("stable");
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.backpressure_loss!.survives).toBe(true);
    });

    it("says of a clock that does not survive which losses break it, in its description and in an insight", () => {
        const full_hand = alternatives.find(alternative => alternative.id === "full-hand")!;
        expect(full_hand.description).toContain("It does not survive backpressure loss: the build does not get back to its expected output under this clock after coal stops arriving.");
        expect(full_hand.insights.find(insight => insight.id === "backpressure-loss")?.what).toContain("coal stops arriving");
        expect(full_hand.insights.some(insight => insight.id === "unstable")).toBe(false);
        expect(selected.description).not.toContain("backpressure loss");
        expect(selected.insights.some(insight => insight.id === "backpressure-loss")).toBe(false);
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
