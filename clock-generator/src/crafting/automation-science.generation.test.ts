import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import type {Config} from "../config/schema";
import {backpressureLossOf, generateClockAlternatives, selectableAsStable, type ClockAlternative, type ClockAlternativesResult} from "./generate-blueprint";
import {lossId, verdictOf, type BackpressureLossReport} from "./backpressure-loss";
import {START_DEPENDENCE_NOT_CHECKED} from "./start-dependence";
import {quiet, SEARCH_IDS, selectedAlternativeOf as selectedOf} from "./generate-blueprint-test-helpers";

let config: Config;
let by_default: ClockAlternativesResult;
let selected: ClockAlternative;

// These assertion groups exercise the same unmodified build; generate its alternatives once.
beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    by_default = generateClockAlternatives(config, {logger: quiet});
    selected = selectedOf(by_default);
});

describe("a clock tried for backpressure loss", () => {
    let report: BackpressureLossReport;

    beforeAll(() => {
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

describe("the searches only run when they are needed", () => {
    describe("automation science, where no clock made without a search is stable", () => {

        it("runs the searches by default", () => {
            expect(by_default.skipped_searches).toEqual([]);
            expect(by_default.alternatives.filter(a => !SEARCH_IDS.includes(a.id)).some(a => selectableAsStable(a.ranking))).toBe(false);
        });

        it("selects the stable clock a search finds", () => {
            expect(selectedOf(by_default).id).toBe("full-hand");
            expect(selectedOf(by_default).verdict).toBe("stable");
        });
    });
});

describe("a build generated with and without the check", () => {
    it("says plainly that start dependence was not checked, by default", () => {
        expect(by_default.start_dependence_checked).toBe(false);
        expect(by_default.start_dependence_note).toBe(START_DEPENDENCE_NOT_CHECKED);
        expect(by_default.alternatives.every(it => it.assessment.start_dependence === null)).toBe(true);
    });
});
