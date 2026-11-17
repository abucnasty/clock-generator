import { describe, expect, it } from "vitest";
import { automationRow } from "../../tests/configs/automation-row";
import { quiet } from "./generate-blueprint-test-helpers";
import { type CopiesChecks, verdictWithCopies } from "./copies-verdict";
import { currentRunMemo, withRunMemo } from "./plan/run-memo";
import { SecondaryPlanningInvariantError } from "./round-robin-polling-primitive-policy";
import type { CopiesTrialVerdict } from "./shared-lane-trial";
import type { SharedLaneJudgement, SharedLaneLoss } from "./shared-lane-verdict";

// nine automation science machines of one copy on one belt (shared-lane-trial.test.ts): the lanes the input inserters take from are
// shared, so both checks have a key
const config = { ...automationRow({ machines: 9, pitch: 9 }), overrides: { terminal_swing_count: 1 } };
const inputs = Array.from({ length: 9 }, (_, index) => [`inserter:${2 * index + 1}`, [{ start: 1, end: 24 }]] as const);
const outputs = Array.from({ length: 9 }, (_, index) => [`inserter:${2 * index + 2}`, [{ start: 0, end: 3 }, { start: 36, end: 39 }]] as const);
const clock = { config, windows: Object.fromEntries([...inputs, ...outputs]), window_cycle_ticks: 72, expected_output_items: 288 };

const holds: SharedLaneJudgement = { losses: [], fast_check_passes: true, simulated: true, longer_run: false, lanes: ["1/1"] };
const loses: SharedLaneJudgement = { ...holds, losses: [{ belt_id: 1, lane: 1, item: "copper-plate", copy: 3, inserter_id: 5, swings: 10, alone_swings: 12,
    text: "Copy 3 loses swings." } as unknown as SharedLaneLoss] };
const survives: CopiesTrialVerdict = { survives: true, lanes: ["1/1"], expected_output_items: 288, recovered_after_window_cycles: 2 };

/** Checks that count their runs and give the judgement and the verdict given */
function counted(judgement: SharedLaneJudgement | (() => SharedLaneJudgement), verdict: CopiesTrialVerdict | (() => CopiesTrialVerdict) = survives) {
    const runs = { lanes: 0, trials: 0, one_copy: 0 };
    const checks: CopiesChecks = {
        sharedLanes: () => { runs.lanes++; return typeof judgement === "function" ? judgement() : judgement; },
        trials: () => { runs.trials++; return typeof verdict === "function" ? verdict() : verdict; },
    };
    const one_copy = () => { runs.one_copy++; return true; };
    return { runs, checks, one_copy };
}

describe("the verdict of a clock with the copies", () => {
    it("is a loss without the trials on the copies where a taker loses swings on a shared lane, and asks nothing of one copy", () => {
        const { runs, checks, one_copy } = counted(loses);
        const verdict = verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks);
        expect(verdict.holds).toBe(false);
        expect(verdict.lane_check.losses).toHaveLength(1);
        expect(verdict.copies_trial).toBeNull();
        expect(runs).toEqual({ lanes: 1, trials: 0, one_copy: 0 });
    });

    it("tries the copies only where no swing is lost and the trials of one copy pass", () => {
        const { runs, checks } = counted(holds);
        const fails_one_copy = verdictWithCopies(clock, () => false, true, "Pitch Pickups", quiet, checks);
        expect([fails_one_copy.copies_trial, runs.trials]).toEqual([null, 0]);
        const tried = verdictWithCopies(clock, () => true, true, "Pitch Pickups", quiet, checks);
        expect([tried.copies_trial, tried.holds, runs.trials]).toEqual([survives, true, 1]);
        const off = verdictWithCopies(clock, () => true, false, "Pitch Pickups", quiet, checks);
        expect([off.copies_trial, runs.trials]).toEqual([null, 1]);
    });

    it("judges a clock once in a generation: the second judgement of the same clock runs no check", () => {
        const { runs, checks, one_copy } = counted(holds);
        withRunMemo(() => {
            const first = verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks);
            const again = verdictWithCopies(clock, one_copy, true, "Coordinated Sources", quiet, checks);
            expect(again).toEqual(first);
            expect([currentRunMemo()!.shared_lane_check_hits, currentRunMemo()!.copies_trial_hits]).toEqual([1, 1]);
        });
        expect([runs.lanes, runs.trials]).toEqual([1, 1]);
        // another clock is judged on its own
        withRunMemo(() => {
            verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks);
            verdictWithCopies({ ...clock, window_cycle_ticks: 144 }, one_copy, true, "Pitch Pickups", quiet, checks);
        });
        expect([runs.lanes, runs.trials]).toEqual([3, 3]);
    });

    it("is a loss that says why where the check of the lanes stops with an error, and keeps nothing of it", () => {
        const { runs, checks, one_copy } = counted(() => { throw new Error("Lane 1 of belt 9 is not in the config"); });
        withRunMemo(() => {
            const verdict = verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks);
            expect(verdict.lane_check).toEqual({ judgement: null, losses: [{ kind: "not_checked", reason: "Lane 1 of belt 9 is not in the config",
                text: "The lanes its copies share could not be checked: Lane 1 of belt 9 is not in the config." }] });
            expect([verdict.holds, verdict.copies_trial]).toEqual([false, null]);
            verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks);
        });
        expect(runs.lanes).toBe(2);
    });

    it("keeps the verdict of one copy where the trials on the copies stop with an error, saying why, and keeps nothing of them", () => {
        const { runs, checks, one_copy } = counted(holds, () => { throw new Error("no run"); });
        withRunMemo(() => {
            const verdict = verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks);
            expect(verdict.copies_trial).toEqual({ survives: true, lanes: [], expected_output_items: 288, recovered_after_window_cycles: null, not_tried: "no run" });
            expect(verdict.holds).toBe(true);
            verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks);
        });
        expect(runs.trials).toBe(2);
    });

    it("fails the generation on an internal error of the generator", () => {
        const { checks, one_copy } = counted(() => { throw new SecondaryPlanningInvariantError("broken"); });
        expect(() => verdictWithCopies(clock, one_copy, true, "Pitch Pickups", quiet, checks)).toThrow(SecondaryPlanningInvariantError);
        const trials = counted(holds, () => { throw new SecondaryPlanningInvariantError("broken"); });
        expect(() => verdictWithCopies(clock, trials.one_copy, true, "Pitch Pickups", quiet, trials.checks)).toThrow(SecondaryPlanningInvariantError);
    });
});
