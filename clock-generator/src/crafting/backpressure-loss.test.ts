import { beforeAll, describe, expect, it } from "vitest";
import {
    backpressureLossesOf, judgeRecovery, LATE_AFTER_PERIODS, LOSS_PLACES, LOSS_SHARES, lossId, lossLabel, lossLimitOf, lossTrialsPartOfTheWay,
    lossTrialsUntilStopped, LossOutcome, MAX_LOSS_PERIODS, MAX_RECOVERY_PERIODS, MAX_RUN_ON_PERIODS, reportOf, RUN_ON_EXACT_PERIODS,
    runsOn, SPOIL_LIMIT_SHARE, verdictOf,
} from "./backpressure-loss";
import { notTriedSentence } from "./why-not-stable";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";

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

    it("keeps the per-period recovery requirement when a repeating cycle only meets the average target", () => {
        expect(judgeRecovery([764, 772, 764, 772], 768, 0, 8)).toEqual({
            recovers: false, recovered_after_bins: null, proven: true, ends_in: [764, 772, 764, 772],
        });
    });

    it("holds it to its last periods where no state repeated, and takes fewer periods than that for no recovery", () => {
        expect(judgeRecovery([600, 704, 704, 704], 704, null, 3)).toEqual({ recovers: true, recovered_after_bins: 1, proven: false, ends_in: [704, 704, 704] });
        expect(judgeRecovery([704, 704], 704, null, 3).recovers).toBe(false);
    });
});

describe("a trial that is short late in its window", () => {
    // back from the second period, then one hand short at period 34 of 40, and never proven: today's hold of 8 fails it
    const late = [320, ...Array(32).fill(400), 352, ...Array(6).fill(400)];

    it("runs on where no state repeated, it was back for 8 periods before the late mark and is short only after it", () => {
        expect(late).toHaveLength(MAX_RECOVERY_PERIODS);
        expect(judgeRecovery(late, 400, null, 8).recovers).toBe(false);
        expect(runsOn(late, 400, null, LATE_AFTER_PERIODS, 8)).toBe(true);
    });

    it("does not run on where a state repeated: what it does from there it does for good", () => {
        expect(runsOn(late, 400, 36, LATE_AFTER_PERIODS, 8)).toBe(false);
    });

    it("does not run on where it was short in the 8 periods before the late mark: one that is short every few periods", () => {
        // the 4-swing clock of agricultural science, short every 4 to 6 periods with or without a loss
        const every_few = [0, 6, 11, 16, 21, 27, 34, 37].reduce((bins, at) => { bins[at] = 384; return bins; }, Array(40).fill(400));
        expect(runsOn(every_few, 400, null, LATE_AFTER_PERIODS, 8)).toBe(false);
    });

    it("does not run on where it was back at the end of the window", () => {
        const early = [320, 352, ...Array(38).fill(400)];
        expect(runsOn(early, 400, null, LATE_AFTER_PERIODS, 8)).toBe(false);
    });

    it("does not run on where a bin is longer than the window: a subtick clock of 83 periods a bin", () => {
        expect(runsOn([1000], 1020, null, Math.floor(LATE_AFTER_PERIODS / 83), Math.ceil(8 / 83))).toBe(false);
    });

    it("is judged on the periods after its last short one once it has run on", () => {
        const ran_on = [...late, ...Array(RUN_ON_EXACT_PERIODS - 6).fill(400)];
        expect(judgeRecovery(ran_on, 400, null, RUN_ON_EXACT_PERIODS)).toMatchObject({ recovers: true, recovered_after_bins: 34, proven: false });
        expect(judgeRecovery([...ran_on.slice(0, -1), 384], 400, null, RUN_ON_EXACT_PERIODS).recovers).toBe(false);
    });
});

describe("the losses a build whose items spoil is tried with", () => {
    it("are shorter than three quarters of the spoil time of the item of the build that spoils first", async () => {
        expect(SPOIL_LIMIT_SHARE).toBe(0.75);
        const registryOf = async (file: string) => createEntityRegistryFromConfig(await loadConfigFromFile(file));
        // iron bacteria spoil in a minute, the nutrients burned in five
        expect(lossLimitOf(await registryOf(ConfigPaths.IRON_BACTERIA_CULTIVATION))).toEqual({ ticks: 2700, item: "iron-bacteria" });
        // nutrients in five minutes, pentapod eggs in fifteen, the packs in an hour, bioflux in two
        expect(lossLimitOf(await registryOf(ConfigPaths.AGRICULTURAL_SCIENCE))).toEqual({ ticks: 13500, item: "nutrients" });
        expect(lossLimitOf(await registryOf(ConfigPaths.AUTOMATION_SCIENCE))).toBeNull();
    });

    it("are named in the verdict, which no other build's has", () => {
        const none: LossOutcome = { loss: { kind: "none" }, bin_ticks: 100, periods_per_bin: 1, expected_per_bin: 10, trials: [], recovers: true,
            recovered_after_bins: 0, stopped_after_ticks: 0, ticks: 1000 };
        expect(verdictOf(reportOf(100, 10, none, [], { ticks: 2700, item: "iron-bacteria" })).loss_limit).toEqual({ ticks: 2700, item: "iron-bacteria" });
        expect(verdictOf(reportOf(100, 10, none, [])).loss_limit).toBeUndefined();
    });
});

// Automation science: copper plates and gear wheels off one belt into a machine, the packs onto another
describe("the verdict of a clock's losses", () => {
    const outcome = (loss: LossOutcome["loss"], recovers: boolean, failed_pickup_phases?: LossOutcome["failed_pickup_phases"]): LossOutcome => ({
        loss, bin_ticks: 100, periods_per_bin: 1, expected_per_bin: 10, trials: [], recovers,
        recovered_after_bins: recovers ? 1 : null, stopped_after_ticks: 50, ticks: 1000, ...(failed_pickup_phases && { failed_pickup_phases }),
    });

    it("names the losses it does not get back from, and apart those it only misses from another lane phase of a moving belt", () => {
        const report = reportOf(100, 10, outcome({ kind: "none" }, true), [
            outcome({ kind: "supply", item: "coal" }, false),
            outcome({ kind: "supply", item: "iron-plate" }, true),
            outcome({ kind: "supply", item: "copper-plate" }, false, { "inserter:2": [1, 5] }),
            outcome({ kind: "output", item: "iron-gear-wheel" }, true),
        ]);
        expect(verdictOf(report)).toEqual({
            survives: false,
            broken_by: ["coal stops arriving", "copper-plate stops arriving"],
            broken_at_other_lane_phases: ["copper-plate stops arriving"],
            recovered_after_periods: null,
        });
    });

    it("names the losses that were not tried after the first it does not get back from, and has none for a clock that tried them all", () => {
        const report = reportOf(100, 10, outcome({ kind: "none" }, true), [outcome({ kind: "supply", item: "coal" }, false)], null, [
            { kind: "supply", item: "iron-plate" }, { kind: "output", item: "iron-gear-wheel" },
        ]);
        expect(verdictOf(report)).toEqual({
            survives: false,
            broken_by: ["coal stops arriving"],
            broken_at_other_lane_phases: [],
            not_tried: ["iron-plate stops arriving", "iron-gear-wheel is not taken away"],
            recovered_after_periods: null,
        });
        expect(verdictOf(reportOf(100, 10, outcome({ kind: "none" }, true), [outcome({ kind: "supply", item: "coal" }, true)]))).not.toHaveProperty("not_tried");
    });

    it("says in a sentence what was not tried, and nothing where all was", () => {
        expect(notTriedSentence(["iron-plate stops arriving", "iron-gear-wheel is not taken away"]))
            .toBe(" Not tried, since one failure is enough: iron-plate stops arriving, iron-gear-wheel is not taken away.");
        expect(notTriedSentence([])).toBe("");
        expect(notTriedSentence(undefined)).toBe("");
    });

    it("has none apart for a clock that gets back from every loss", () => {
        const report = reportOf(100, 10, outcome({ kind: "none" }, true), [outcome({ kind: "supply", item: "coal" }, true)]);
        expect(verdictOf(report)).toEqual({ survives: true, broken_by: [], broken_at_other_lane_phases: [], recovered_after_periods: 1 });
    });
});

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

describe("what the generator calls stable", () => {
    it("lets a loss last until the build has stopped, 200 periods at most, and gives the build 40 periods to be back", () => {
        expect(MAX_LOSS_PERIODS).toBe(200);
        expect(MAX_RECOVERY_PERIODS).toBe(40);
    });

    it("runs a trial short late in its 40 periods on, until 40 periods at the expected output follow its last short one, 200 periods at most", () => {
        expect(LATE_AFTER_PERIODS).toBe(32);
        expect(RUN_ON_EXACT_PERIODS).toBe(40);
        expect(MAX_RUN_ON_PERIODS).toBe(200);
    });
});
