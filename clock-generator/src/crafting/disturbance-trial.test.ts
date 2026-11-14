import { beforeAll, describe, expect, it } from "vitest";
import {
    clockCountsOneAt, countedOnTheClock, disturbanceTrialsOf, judgedCopies, judgedOnTheClock, judgedTogether, judgeRecovery, LATE_AFTER_WINDOW_CYCLES, LOSS_PLACES, LOSS_SHARES, lossId, lossLabel, lossLimitOf, lossTrialsPartOfTheWay,
    lossTrialsUntilStopped, LossOutcome, LossTrial, MAX_LOSS_WINDOW_CYCLES, MAX_RECOVERY_WINDOW_CYCLES, MAX_RUN_ON_WINDOW_CYCLES, plannedTrialsOf, reportOf, RUN_ON_EXACT_WINDOW_CYCLES,
    repeatOnTheClock, runsOn, trialCountOf, verdictOf, withEveryTrialCounted,
} from "./disturbance-trial";
import { Duration } from "../data-types";
import type { BranchBins } from "./terminal-rate";
import { SPOIL_LIMIT_SHARE } from "../common/rule-constants";
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
        // the state at the end of the fourth window cycle was that at the end of the third: from there on it makes 704
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

describe("judging a repeated state on the clock", () => {
    /** One branch with no hand and no surplus, its bins those of the repeat counted on the clock */
    const exact = (bins: number[], share: number): BranchBins[] => [{ bins, share_per_bin: share, hand: 0, takes_surplus: false }];
    /** The running totals at each bin's start (and at the end) of bins, and at the clock's count 1 in each, `before` into it */
    const totals = (bins: number[], before: number[]) => {
        const starts = bins.reduce((sums, items) => [...sums, sums[sums.length - 1] + items], [0]);
        return { starts, marks: before.map((items, at) => starts[at] + items) };
    };
    // military science's time-study windows after piercing rounds stop for 130 ticks at phase 120: from bin 5 the state
    // repeats every two bins of 400 and 368, and the clock counts 1 229 ticks into each bin; a hand drops on one side of the
    // bin's edge or the other
    const military = [336, 384, 368, 384, 368, 400, 368];
    const military_marks = totals(military, [168, 200, 184, 200, 184, 200, 184]);

    it("counts a repeat in whole window cycles from the clock's count 1, the window cycle over the repeat's end going on from its start", () => {
        expect(repeatOnTheClock(military_marks.starts, military_marks.marks, 5)).toEqual([384, 384]);
        // where the clock counts 1 as a bin starts, the window cycles are the bins
        expect(repeatOnTheClock(totals([10, 12, 8], [0, 0, 0]).starts, [0, 10, 22], 1)).toEqual([12, 8]);
    });

    it("has a repeat back whose bins read 400 and 368 where every window cycle on the clock holds 384, from the bin it begins at", () => {
        const judged = judgeRecovery(military, 384, 5, 8);
        expect(judged.recovers).toBe(false);
        expect(judgedOnTheClock(judged, exact(repeatOnTheClock(military_marks.starts, military_marks.marks, 5), 384), 5)).toEqual({
            recovers: true, recovered_after_bins: 5, proven: true, ends_in: [400, 368], ends_in_on_the_clock: [384, 384],
        });
    });

    it("does not have a repeat back that holds 48 and 16 on the clock where 32 is expected, though its sum is right", () => {
        // automation science's 1-swing takt batches: 15 window cycles of 480, one of 48 and one of 16 on the clock
        const on_the_clock = [32, 48, 32, 32, 16, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32];
        const bins = [32, 32, 48, 32, 32, 16, 32, 32, 32, 32, 32, 32, 32, 32, 32];
        expect(on_the_clock.reduce((sum, items) => sum + items, 0)).toBe(32 * 15);
        const judged = judgedOnTheClock(judgeRecovery([0, ...bins], 32, 1, 8), exact(on_the_clock, 32), 1);
        expect(judged).toMatchObject({ recovers: false, recovered_after_bins: null, ends_in_on_the_clock: on_the_clock });
    });

    it("does not have a repeat back that is short on the clock", () => {
        expect(judgedOnTheClock(judgeRecovery([336, 400, 367], 384, 1, 8), exact([384, 383], 384), 1).recovers).toBe(false);
        expect(judgedOnTheClock(judgeRecovery([336, 400, 368], 384, 1, 8), exact([392, 376], 384), 1).recovers).toBe(false);
    });

    it("holds every branch to its share in each window cycle on the clock, with its hand and surplus as in the bins", () => {
        const branch = (bins: number[]): BranchBins => ({ bins, share_per_bin: 32, hand: 16, takes_surplus: true });
        const judged = judgeRecovery([0, 96, 32], 64, 1, 8, [branch([0, 64, 0]), branch([0, 32, 32])]);
        expect(judged.recovers).toBe(false);
        expect(judgedOnTheClock(judged, [branch([32, 32]), branch([32, 32])], 1)).toMatchObject({ recovers: true, recovered_after_bins: 1 });
        // one branch two hands behind in a window cycle on the clock: as in a bin, more than its hand
        expect(judgedOnTheClock(judged, [branch([64, 0]), branch([32, 32])], 1).recovers).toBe(false);
    });

    it("never takes a recovery away, and leaves a trial with no repeat as it is", () => {
        const today = judgeRecovery([640, 688, 704, 704], 704, 3, 8);
        expect(judgedOnTheClock(today, exact([600], 704), 3)).toBe(today);
        const unproven = judgeRecovery([600, 704, 704, 700], 704, null, 3);
        expect(judgedOnTheClock(unproven, exact([704], 704), null)).toBe(unproven);
    });

    it("judges each copy of a run of the copies on the clock: one copy at 100 and 92 in its bins and 96 on the clock is back", () => {
        const copies = [[80, 96, 96, 96], [72, 96, 100, 92]];
        const together = copies[0].map((items, at) => items + copies[1][at]);
        const second = totals(copies[1], [36, 48, 52, 48]);
        const each = [judgeRecovery(copies[0], 96, 2, 8), judgedOnTheClock(judgeRecovery(copies[1], 96, 2, 8), exact(repeatOnTheClock(second.starts, second.marks, 2), 96), 2)];
        expect(each[1]).toMatchObject({ recovers: true, recovered_after_bins: 2, ends_in_on_the_clock: [96, 96] });
        expect(judgedTogether(each, together, 2, 8)).toEqual({ recovers: true, recovered_after_bins: 2, proven: true, ends_in: [196, 188] });
        const short = [each[0], judgedOnTheClock(judgeRecovery([72, 96, 100, 90], 96, 2, 8), exact([96, 94], 96), 2)];
        expect(judgedTogether(short, together, 2, 8)).toMatchObject({ recovers: false, recovered_after_bins: null });
    });

    it("judges a run of the copies as runLossTrials does: each copy recounted on its own, the trial back where every copy is", () => {
        const one = (bins: number[]): BranchBins[] => [{ bins, share_per_bin: 96, hand: 0, takes_surplus: false }];
        // the second copy's bins read 100 and 92 from bin 2, and the clock counts 1 48 and 52 items into bins 2 and 3: 96 and 96
        const first = [80, 96, 96, 96], second = [72, 96, 100, 92];
        const counts = totals(second, [36, 48, 52, 48]);
        const copies = [
            { bins: first, branches: one(first), on_the_clock: { starts: [totals(first, [0, 0, 0, 0]).starts], marks: [totals(first, [40, 48, 48, 48]).marks] } },
            { bins: second, branches: one(second), on_the_clock: { starts: [counts.starts], marks: [counts.marks] } },
        ];
        const together = first.map((items, at) => items + second[at]);
        const run = judgedCopies(copies, together, 96, 2, 8);
        expect(run.each.map(it => [it.recovers, it.recovered_after_bins])).toEqual([[true, 1], [true, 2]]);
        expect(run.judged).toEqual({ recovers: true, recovered_after_bins: 2, proven: true, ends_in: [196, 188] });
        // without the totals of the clock (a run with nothing cut, or no clock found) the copy is judged in its bins
        const in_bins = judgedCopies([copies[0], { bins: second, branches: one(second) }], together, 96, 2, 8);
        expect(in_bins.judged).toMatchObject({ recovers: false, recovered_after_bins: null });
        // one copy: the trial is as that copy is, with its window cycles on the clock
        expect(judgedCopies([copies[1]], second, 96, 2, 8).judged).toEqual({ recovers: true, recovered_after_bins: 2, proven: true, ends_in: [100, 92], ends_in_on_the_clock: [96, 96] });
    });

    it("leaves the run with nothing cut to its bins: it is the check of what the clock holds", () => {
        expect(countedOnTheClock({ kind: "none" })).toBe(false);
        expect(countedOnTheClock({ kind: "supply", item: "copper-plate" })).toBe(true);
        expect(countedOnTheClock({ kind: "output", item: "automation-science-pack" })).toBe(true);
        // automation science's 1-swing takt batches with nothing cut: 48 and 16 in its bins, not back, as before
        const nothing_cut = [32, 32, 48, 32, 32, 16, 32, 32, 32, 32, 32, 32, 32, 32, 32];
        expect(judgeRecovery(nothing_cut, 32, 0, 8)).toEqual({ recovers: false, recovered_after_bins: null, proven: true, ends_in: nothing_cut });
    });

    it("finds where the clock counts 1 from the clocks of its window cycle, a subtick clock's in the whole ticks it repeats in", () => {
        const clock = (ticks: number, clock_tick: number, is_game_clock = true) => ({ windowCycleDuration: Duration.ofTicks(ticks), is_game_clock, clockTick: () => clock_tick });
        // now is tick 1000 of the run; a clock of 480 ticks that has counted 1,229 ticks since its start counts 1 at tick 251 and 480 apart
        expect(clockCountsOneAt([clock(480, 1229), clock(37, 5)], 480, 480, 1000)).toBe(251);
        // a fuel clock of another window cycle and a planning schedule do not count; clocks that do not agree give none
        expect(clockCountsOneAt([clock(480, 1229), clock(480, 7, false)], 480, 480, 1000)).toBe(251);
        expect(clockCountsOneAt([clock(480, 1229), clock(480, 1230)], 480, 480, 1000)).toBeNull();
        expect(clockCountsOneAt([], 480, 480, 1000)).toBeNull();
        // a window cycle of 12,672/23 ticks repeats in 12,672 whole ticks, 23 window cycles, where its count starts again
        expect(clockCountsOneAt([clock(12672 / 23, 20000)], 12672 / 23, 12672, 30000)).toBe(10000);
    });
});

describe("a trial that is short late in its window", () => {
    // back from the second window cycle, then one hand short at window cycle 34 of 40, and never proven: today's hold of 8 fails it
    const late = [320, ...Array(32).fill(400), 352, ...Array(6).fill(400)];

    it("runs on where no state repeated, it was back for 8 periods before the late mark and is short only after it", () => {
        expect(late).toHaveLength(MAX_RECOVERY_WINDOW_CYCLES);
        expect(judgeRecovery(late, 400, null, 8).recovers).toBe(false);
        expect(runsOn(late, 400, null, LATE_AFTER_WINDOW_CYCLES, 8)).toBe(true);
    });

    it("does not run on where a state repeated: what it does from there it does for good", () => {
        expect(runsOn(late, 400, 36, LATE_AFTER_WINDOW_CYCLES, 8)).toBe(false);
    });

    it("does not run on where it was short in the 8 periods before the late mark: one that is short every few periods", () => {
        // the 4-swing clock of agricultural science, short every 4 to 6 window cycles with or without a loss
        const every_few = [0, 6, 11, 16, 21, 27, 34, 37].reduce((bins, at) => { bins[at] = 384; return bins; }, Array(40).fill(400));
        expect(runsOn(every_few, 400, null, LATE_AFTER_WINDOW_CYCLES, 8)).toBe(false);
    });

    it("does not run on where it was back at the end of the window", () => {
        const early = [320, 352, ...Array(38).fill(400)];
        expect(runsOn(early, 400, null, LATE_AFTER_WINDOW_CYCLES, 8)).toBe(false);
    });

    it("does not run on where a bin is longer than the window: a subtick clock of 83 periods a bin", () => {
        expect(runsOn([1000], 1020, null, Math.floor(LATE_AFTER_WINDOW_CYCLES / 83), Math.ceil(8 / 83))).toBe(false);
    });

    it("is judged on the periods after its last short one once it has run on", () => {
        const ran_on = [...late, ...Array(RUN_ON_EXACT_WINDOW_CYCLES - 6).fill(400)];
        expect(judgeRecovery(ran_on, 400, null, RUN_ON_EXACT_WINDOW_CYCLES)).toMatchObject({ recovers: true, recovered_after_bins: 34, proven: false });
        expect(judgeRecovery([...ran_on.slice(0, -1), 384], 400, null, RUN_ON_EXACT_WINDOW_CYCLES).recovers).toBe(false);
    });
});

describe("the losses a build whose items spoil is tried with", () => {
    it("are shorter than three quarters of the spoil time of the item of the build that spoils first", async () => {
        expect(SPOIL_LIMIT_SHARE).toBe(0.75);
        const registryOf = async (file: string) => createEntityRegistryFromConfig(await loadConfigFromFile(file));
        // iron bacteria spoil in a minute, the nutrients burned in five
        expect(lossLimitOf(await registryOf(ConfigPaths.IRON_BACTERIA_380_CULTIVATION))).toEqual({ ticks: 2700, item: "iron-bacteria" });
        // nutrients in five minutes, pentapod eggs in fifteen, the packs in an hour, bioflux in two
        expect(lossLimitOf(await registryOf(ConfigPaths.AGRICULTURAL_SCIENCE_250))).toEqual({ ticks: 13500, item: "nutrients" });
        expect(lossLimitOf(await registryOf(ConfigPaths.AUTOMATION_SCIENCE_240))).toBeNull();
    });

    it("are named in the verdict, which no other build's has", () => {
        const none: LossOutcome = { loss: { kind: "none" }, bin_ticks: 100, window_cycles_per_bin: 1, expected_per_bin: 10, trials: [], planned_trials: 1, recovers: true,
            recovered_after_bins: 0, stopped_after_ticks: 0, ticks: 1000 };
        expect(verdictOf(reportOf(100, 10, none, [], { ticks: 2700, item: "iron-bacteria" })).loss_limit).toEqual({ ticks: 2700, item: "iron-bacteria" });
        expect(verdictOf(reportOf(100, 10, none, [])).loss_limit).toBeUndefined();
    });
});

// Automation science: copper plates and gear wheels off one belt into a machine, the packs onto another
describe("the verdict of a clock's losses", () => {
    const outcome = (loss: LossOutcome["loss"], recovers: boolean, failed_pickup_phases?: LossOutcome["failed_pickup_phases"]): LossOutcome => ({
        loss, bin_ticks: 100, window_cycles_per_bin: 1, expected_per_bin: 10, trials: [], planned_trials: 16, recovers,
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
            broken_by: ["coal stops arriving", "copper plate stops arriving"],
            broken_at_other_lane_phases: ["copper plate stops arriving"],
            recovered_after_window_cycles: null,
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
            not_tried: ["iron plate stops arriving", "iron gear wheel is not taken away"],
            recovered_after_window_cycles: null,
        });
        expect(verdictOf(reportOf(100, 10, outcome({ kind: "none" }, true), [outcome({ kind: "supply", item: "coal" }, true)]))).not.toHaveProperty("not_tried");
    });

    it("says in a sentence what was not tried, and nothing where all was", () => {
        expect(notTriedSentence(["iron plate stops arriving", "iron gear wheel is not taken away"]))
            .toBe(" Not tried, since one failure is enough: iron plate stops arriving, iron gear wheel is not taken away.");
        expect(notTriedSentence([])).toBe("");
        expect(notTriedSentence(undefined)).toBe("");
    });

    it("has none apart for a clock that gets back from every loss", () => {
        const report = reportOf(100, 10, outcome({ kind: "none" }, true), [outcome({ kind: "supply", item: "coal" }, true)]);
        expect(verdictOf(report)).toEqual({ survives: true, broken_by: [], broken_at_other_lane_phases: [], recovered_after_window_cycles: 1 });
    });
});

describe("the trials of a loss that breaks a clock, as numbers", () => {
    const trial = (cut_at: number, loss_ticks: number, until_stopped: boolean, recovers: boolean, plan_index = 0): LossTrial => ({
        plan_index, cut_at, restore_at: cut_at, until_stopped, loss_ticks, output_during_loss: 0, stopped_after_ticks: until_stopped ? loss_ticks : null,
        output_per_bin: [10], recovers, recovered_after_bins: recovers ? 1 : null, proven: true, ends_in: [10],
    });
    const outcome = (loss: LossOutcome["loss"], trials: LossTrial[], planned_trials = 16): LossOutcome => ({
        loss, bin_ticks: 72, window_cycles_per_bin: 1, expected_per_bin: 10, trials, planned_trials, recovers: trials.every(it => it.recovers),
        recovered_after_bins: null, stopped_after_ticks: null, ticks: 1000,
    });
    const stopped = [0, 18, 36, 54].map(cut => trial(cut, 1900, true, true));

    it("are planned for each place in the window cycle and each length: 16 for a loss, 4 for an excess or a loss of fixed ticks", () => {
        expect(plannedTrialsOf({ kind: "supply", item: "copper-plate" }, LOSS_PLACES, LOSS_SHARES)).toBe(16);
        expect(plannedTrialsOf({ kind: "output", item: "copper-plate" }, LOSS_PLACES, [1])).toBe(4);
        expect(plannedTrialsOf({ kind: "supply", item: "copper-plate" }, LOSS_PLACES, [0.5])).toBe(5);
        expect(plannedTrialsOf({ kind: "supply", item: "copper-plate" }, LOSS_PLACES, LOSS_SHARES, 300)).toBe(4);
        expect(plannedTrialsOf({ kind: "excess", at: [{ machine_id: "machine:1", item: "iron-ore", count: 67 }] }, LOSS_PLACES, LOSS_SHARES)).toBe(4);
        expect(plannedTrialsOf({ kind: "none" }, LOSS_PLACES, LOSS_SHARES)).toBe(1);
    });

    it("give the trials planned, every one run, those recovered from, and the first not recovered from: the sixth of 16, a quarter of the time to stop", () => {
        const copper = { ...outcome({ kind: "supply", item: "copper-plate" }, [...stopped, trial(0, 466, false, true), trial(18, 466, false, false)]),
            every_trial: { run: 16, recovered: 15 } };
        expect(trialCountOf(copper)).toEqual({ loss: { kind: "supply", items: ["copper-plate"] }, planned: 16, run: 16, recovered: 15,
            first_not_recovered: { cut_at: 18, loss_ticks: 466, until_stopped: false } });
    });

    // the first run stops at plan trial 5; run again without it, trial 10 does not recover; run without both, every other one does
    it("are run to the end of the plan: again from the same start with each trial that did not recover left out, until none fails", () => {
        const copper = { kind: "supply", item: "copper-plate" } as const;
        const planOf = (skipped: readonly number[], fails: number | null) => Array.from({ length: 16 }, (_, index) => index)
            .filter(index => !skipped.includes(index))
            .map(index => trial(index * 9, index < 4 ? 1900 : 466, index < 4, index !== fails, index))
            .filter((_, at, all) => fails === null || all[at].plan_index <= fails);
        const first = outcome(copper, planOf([], 5));
        const asked: number[][] = [];
        const rerun = (skipped: readonly { plan_index: number; stopped_after_ticks: number | null }[]) => {
            asked.push(skipped.map(it => it.plan_index));
            return outcome(copper, planOf(skipped.map(it => it.plan_index), skipped.length === 1 ? 10 : null));
        };
        const counted = withEveryTrialCounted(first, rerun);
        expect(asked).toEqual([[5], [5, 10]]);
        expect(counted.every_trial).toEqual({ run: 16, recovered: 14 });
        // the outcome is the first run's: its trials end at the first that does not recover, which the verdict names
        expect(counted.trials).toBe(first.trials);
        expect(counted.ticks).toBe(3000);
        expect(trialCountOf(counted)).toEqual({ loss: { kind: "supply", items: ["copper-plate"] }, planned: 16, run: 16, recovered: 14,
            first_not_recovered: { cut_at: 45, loss_ticks: 466, until_stopped: false } });
    });

    it("run nothing more for a loss the clock recovers from, or the run with nothing cut", () => {
        const never = () => { throw new Error("run again"); };
        const recovered = outcome({ kind: "supply", item: "copper-plate" }, stopped);
        expect(withEveryTrialCounted(recovered, never)).toBe(recovered);
        const none = outcome({ kind: "none" }, [trial(0, 0, false, true)], 1);
        expect(withEveryTrialCounted(none, never)).toBe(none);
    });

    it("stop with an error where the runs go on failing after as many runs as the plan has trials", () => {
        const failing = outcome({ kind: "supply", item: "copper-plate" }, [trial(0, 1900, true, false)], 2);
        expect(() => withEveryTrialCounted(failing, () => failing)).toThrow(/2 planned/);
    });

    it("count a first trial that runs its course and does not recover, and an output blockage or an excess by its items", () => {
        expect(trialCountOf({ ...outcome({ kind: "output", item: "automation-science-pack" }, [trial(0, 216, true, false)]), every_trial: { run: 16, recovered: 4 } })).toEqual({
            loss: { kind: "output", items: ["automation-science-pack"] }, planned: 16, run: 16, recovered: 4,
            first_not_recovered: { cut_at: 0, loss_ticks: 216, until_stopped: true } });
        const excess = { kind: "excess", at: [{ machine_id: "machine:1", item: "iron-ore", count: 67 }, { machine_id: "machine:2", item: "iron-ore", count: 3 }] } as const;
        expect(trialCountOf(outcome(excess, [trial(0, 0, false, true), trial(18, 0, false, false)], 4))?.loss).toEqual({ kind: "excess", items: ["iron-ore"] });
    });

    it("are not given for a loss the clock recovers from", () => {
        expect(trialCountOf(outcome({ kind: "supply", item: "copper-plate" }, stopped))).toBeNull();
    });

    it("are in the verdict for each loss that breaks the clock, in the order of the losses it does not recover from, and absent from a clock that recovers", () => {
        const none = outcome({ kind: "none" }, [trial(0, 0, false, true)], 1);
        const coal = { ...outcome({ kind: "supply", item: "coal" }, [trial(0, 1900, true, true), trial(18, 1900, true, false)]), every_trial: { run: 16, recovered: 13 } };
        const copper = { ...outcome({ kind: "supply", item: "copper-plate" }, [trial(36, 1900, true, false)]), failed_pickup_phases: { "inserter:2": [1, 5] as const },
            every_trial: { run: 16, recovered: 0 } };
        const verdict = verdictOf(reportOf(72, 10, none, [coal, outcome({ kind: "supply", item: "iron-plate" }, stopped), copper]));
        expect(verdict.broken_by).toEqual(["coal stops arriving", "copper plate stops arriving"]);
        expect(verdict.trial_counts?.map(it => [it.loss.items[0], it.planned, it.run, it.recovered])).toEqual([["coal", 16, 16, 13], ["copper-plate", 16, 16, 0]]);
        expect(verdictOf(reportOf(72, 10, none, [outcome({ kind: "supply", item: "iron-plate" }, stopped)]))).not.toHaveProperty("trial_counts");
    });
});

describe("the losses a build can have", () => {
    let config: Config;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
    });

    it("are one for each item that comes off a belt and one for each that leaves on one, the product of the build among them", () => {
        const losses = disturbanceTrialsOf(createEntityRegistryFromConfig(structuredClone(config)), "automation-science-pack");
        expect(losses.map(lossId).sort()).toEqual(["output:automation-science-pack", "supply:copper-plate", "supply:iron-gear-wheel"]);
        expect(losses.map(lossLabel)).toContain("copper plate stops arriving");
        expect(losses.map(lossLabel)).toContain("automation science pack is not taken away");
    });

    it("are worded with the game's name of the item, not its id", () => {
        expect(lossLabel({ kind: "supply", item: "tungsten-ore" })).toBe("tungsten ore stops arriving");
        expect(lossLabel({ kind: "output", item: "military-science-pack" })).toBe("military science pack is not taken away");
        expect(lossLabel({ kind: "none" })).toBe("nothing is cut");
        expect(lossId({ kind: "output", item: "military-science-pack" })).toBe("output:military-science-pack");
        const excess = { kind: "excess", at: [{ machine_id: "machine:1", item: "iron-ore", count: 67 }] } as const;
        expect(lossLabel(excess)).toBe("iron ore comes over its mean");
        expect(lossId(excess)).toBe("excess:iron-ore");
        const two = { kind: "excess", at: [{ machine_id: "machine:1", item: "iron-ore", count: 3 }, { machine_id: "machine:1", item: "stone", count: 2 }] } as const;
        expect(lossLabel(two)).toBe("iron ore and stone come over their mean");
    });
});

describe("what the generator calls stable", () => {
    it("lets a loss last until the build has stopped, 200 periods at most, and gives the build 40 periods to be back", () => {
        expect(MAX_LOSS_WINDOW_CYCLES).toBe(200);
        expect(MAX_RECOVERY_WINDOW_CYCLES).toBe(40);
    });

    it("runs a trial short late in its 40 periods on, until 40 periods at the expected output follow its last short one, 200 periods at most", () => {
        expect(LATE_AFTER_WINDOW_CYCLES).toBe(32);
        expect(RUN_ON_EXACT_WINDOW_CYCLES).toBe(40);
        expect(MAX_RUN_ON_WINDOW_CYCLES).toBe(200);
    });
});
