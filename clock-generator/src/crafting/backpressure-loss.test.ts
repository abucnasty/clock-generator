import { beforeAll, describe, expect, it } from "vitest";
import {
    backpressureLossesOf, judgeRecovery, LOSS_PLACES, LOSS_SHARES, lossId, lossLabel, lossTrialsPartOfTheWay, lossTrialsUntilStopped,
    MAX_LOSS_PERIODS, MAX_RECOVERY_PERIODS, verdictOf,
    type BackpressureLossReport,
} from "./backpressure-loss";
import { backpressureLossOf, generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

describe("the trials of a loss", () => {
    it("are the same for every build: four places in the period, and a quarter, a half, three quarters and all of the time the build takes to stop", () => {
        expect(LOSS_PLACES).toEqual([0, 0.25, 0.5, 0.75]);
        expect(LOSS_SHARES).toEqual([0.25, 0.5, 0.75, 1]);
    });

    it("cut a loss that runs its course at each place, and restore it at the place it was cut at", () => {
        expect(lossTrialsUntilStopped(528)).toEqual([
            { cut_at: 0, restore_at: 0 }, { cut_at: 132, restore_at: 132 }, { cut_at: 264, restore_at: 264 }, { cut_at: 396, restore_at: 396 },
        ]);
    });

    it("end a loss part of the way after each share of the ticks the build takes to stop, at each place", () => {
        const trials = lossTrialsPartOfTheWay(100, 1000);
        expect(trials).toHaveLength(12);
        expect(trials.slice(0, 4)).toEqual([
            { cut_at: 0, loss_ticks: 250 }, { cut_at: 25, loss_ticks: 250 }, { cut_at: 50, loss_ticks: 250 }, { cut_at: 75, loss_ticks: 250 },
        ]);
        expect(Array.from(new Set(trials.map(trial => "loss_ticks" in trial ? trial.loss_ticks : null)))).toEqual([250, 500, 750]);
    });

    it("last a tick at least, for a build that stops at once", () => {
        expect(lossTrialsPartOfTheWay(100, 0, [0], [0.5])).toEqual([{ cut_at: 0, loss_ticks: 1 }]);
    });
});

describe("judging what a build made after a loss", () => {
    it("has it recover when the periods that repeat are all at the expected output, and counts the periods before", () => {
        // the state at the end of the fourth period was that at the end of the third: from there on it makes 704
        expect(judgeRecovery([640, 688, 704, 704], 704, 3, 8)).toEqual({ recovers: true, recovered_after_bins: 2, proven: true, ends_in: [704] });
    });

    it("does not have it recover when the periods that repeat are short, however many came out whole before", () => {
        expect(judgeRecovery([704, 704, 608, 624, 608, 624], 704, 2, 8)).toEqual({ recovers: false, recovered_after_bins: null, proven: true, ends_in: [608, 624, 608, 624] });
    });

    it("holds it to its last periods where no state repeated, and takes fewer periods than that for no recovery", () => {
        expect(judgeRecovery([600, 704, 704, 704], 704, null, 3)).toEqual({ recovers: true, recovered_after_bins: 1, proven: false, ends_in: [704, 704, 704] });
        expect(judgeRecovery([704, 704], 704, null, 3).recovers).toBe(false);
    });
});

// Automation science: copper plates and gear wheels off one belt into a machine, the packs onto another
describe("the losses a build can have", () => {
    let config: Config;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    });

    it("are one for each item that comes off a belt and one for each that leaves on one, the product of the build among them", () => {
        const losses = backpressureLossesOf(createEntityRegistryFromConfig(structuredClone(config)), "automation-science-pack");
        expect(losses.map(lossId).sort()).toEqual(["output:automation-science-pack", "supply:copper-plate", "supply:iron-gear-wheel"]);
        expect(losses.map(lossLabel)).toContain("copper-plate stops arriving");
        expect(losses.map(lossLabel)).toContain("automation-science-pack is not taken away");
    });
});

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

    it("lets a loss last until the build has stopped, 200 periods at most, and gives the build 40 periods to be back", () => {
        expect(MAX_LOSS_PERIODS).toBe(200);
        expect(MAX_RECOVERY_PERIODS).toBe(40);
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
