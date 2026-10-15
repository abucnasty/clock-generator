import { describe, expect, it } from "vitest";
import { STATUS_FULL_OUTPUT, STATUS_WORKING, trueStartsOfDump, trueStartsOfProgress } from "./true-starts";

const WORK = STATUS_WORKING;
const FULL = STATUS_FULL_OUTPUT;
/** The item shortage status; any code that is neither working nor full output is a rest */
const SHORT = 28;

/** The indices at which a series is true */
const at = (values: readonly boolean[]): number[] => values.flatMap((value, t) => value ? [t] : []);

/** A delta of 0.25 finishes a craft every four working ticks, in floats that are exact */
const QUARTER = 0.25;

describe("trueStartsOfDump", () => {
    describe("a machine that starts from rest", () => {
        it("starts when the status turns to working and again at each wrap of the progress, with the finishes as crafts out", () => {
            const statuses = [SHORT, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK];
            const finished = [0, 0, 0, 0, 1, 1, 1, 1, 2];
            const result = trueStartsOfDump(statuses, finished, QUARTER, 0, 9);
            expect(at(result.start)).toEqual([1, 4, 8]);
            expect(at(result.craft_out)).toEqual([4, 8]);
            expect(result.diag).toEqual({ resync: 0, miss: 0, phase_ties: 0, phase_viol: 0, phase_runs: 1 });
        });

        it("never starts at index 0, even when the machine is working there", () => {
            const result = trueStartsOfDump([WORK, WORK, WORK], [0, 0, 0], 0.01, 0, 3);
            expect(result.start[0]).toBe(false);
            expect(result.craft_out[0]).toBe(false);
        });
    });

    describe("a finish the progress puts a tick away from the rise of products_finished", () => {
        it("moves it to the later rise, and counts a resync", () => {
            // the progress finishes at 4, the counter rises at 5
            const statuses = [SHORT, WORK, WORK, WORK, WORK, WORK, WORK];
            const result = trueStartsOfDump(statuses, [0, 0, 0, 0, 0, 1, 1], QUARTER, 0, 7);
            expect(at(result.start)).toEqual([1, 5]);
            expect(at(result.craft_out)).toEqual([5]);
            expect(result.diag.resync).toBe(1);
            expect(result.diag.miss).toBe(0);
        });

        it("moves it to the earlier rise when no rise follows, and counts a resync", () => {
            // the progress finishes at 4 and 8, the counter rises at 3 and 8
            const statuses = [SHORT, WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK];
            const result = trueStartsOfDump(statuses, [0, 0, 0, 1, 1, 1, 1, 1, 2], QUARTER, 0, 9);
            expect(at(result.start)).toEqual([1, 3, 8]);
            expect(at(result.craft_out)).toEqual([3, 8]);
            expect(result.diag.resync).toBe(1);
            expect(result.diag.miss).toBe(0);
        });
    });

    it("counts a miss, and still starts, when a predicted finish has no rise to move to", () => {
        const statuses = [SHORT, WORK, WORK, WORK, WORK, WORK];
        const result = trueStartsOfDump(statuses, [0, 0, 0, 0, 0, 0], QUARTER, 0, 6);
        expect(at(result.start)).toEqual([1, 4]);
        expect(at(result.craft_out)).toEqual([4]);
        expect(result.diag.miss).toBe(1);
        expect(result.diag.resync).toBe(0);
    });

    describe("a craft that finishes as the machine leaves work", () => {
        it("is a craft out without a start when the counter rises on that tick", () => {
            const statuses = [SHORT, WORK, WORK, WORK, FULL, FULL, WORK];
            const result = trueStartsOfDump(statuses, [0, 0, 0, 0, 1, 1, 1], QUARTER, 0, 7);
            expect(at(result.start)).toEqual([1, 6]);
            expect(at(result.craft_out)).toEqual([4]);
        });

        it("is held while the output is full and paid out as a craft out on the resume, which also starts a craft", () => {
            const statuses = [SHORT, WORK, WORK, WORK, FULL, FULL, WORK];
            const result = trueStartsOfDump(statuses, [0, 0, 0, 0, 0, 0, 1], QUARTER, 0, 7);
            expect(at(result.start)).toEqual([1, 6]);
            expect(at(result.craft_out)).toEqual([6]);
        });

        it("is not a craft when the progress has not reached 1, and the progress is lost at rest", () => {
            const statuses = [SHORT, WORK, WORK, SHORT, WORK, WORK, WORK, WORK, WORK];
            const result = trueStartsOfDump(statuses, [0, 0, 0, 0, 0, 0, 0, 0, 1], QUARTER, 0, 9);
            // the first run reaches 0.75 at index 3 and loses it; the second starts at 4 and finishes at 7, where the
            // counter rises a tick later (resynced), so that no craft of the first run is counted
            expect(at(result.start)).toEqual([1, 4, 8]);
            expect(at(result.craft_out)).toEqual([8]);
            expect(result.diag.resync).toBe(1);
        });
    });

    describe("a machine working on the first sample", () => {
        it("fits the phase of the running craft to the rises", () => {
            // rises at 3 and 7: the progress put a finish at each when it started a quarter above rest
            const statuses = Array.from({ length: 8 }, () => WORK);
            const result = trueStartsOfDump(statuses, [0, 0, 0, 1, 1, 1, 1, 2], QUARTER, 0, 8);
            expect(at(result.start)).toEqual([3, 7]);
            expect(at(result.craft_out)).toEqual([3, 7]);
            expect(result.diag.phase_viol).toBe(0);
            expect(result.diag.phase_ties).toBe(1);
            expect(result.diag.phase_runs).toBe(1);
        });

        it("fits only the coarse stage when the rises leave many phases feasible, and says so", () => {
            const statuses = Array.from({ length: 8 }, () => WORK);
            const result = trueStartsOfDump(statuses, [0, 0, 0, 1, 1, 1, 1, 2], QUARTER, 0, 8);
            expect(result.diag.phase_coarse).toBe(1);
        });

        it("reads a rise of 2 on a tick of steady work as a craft when a payout a tick is not possible (delta * pb < 1)", () => {
            // the counter rises by 2 at index 4: a finish there, and the phase that finishes at 2 and 6 is ruled out
            const statuses = Array.from({ length: 9 }, () => WORK);
            const finished = [0, 0, 1, 1, 3, 3, 4, 4, 5];
            const result = trueStartsOfDump(statuses, finished, QUARTER, 0.5, 9);
            expect(result.diag.phase_ties).toBe(1);
            expect(at(result.start)).toEqual([4, 8]);
        });

        it("reads no step of 2 when a payout a tick is possible (delta * pb >= 1): two phases tie, and each is simulated", () => {
            const statuses = Array.from({ length: 9 }, () => WORK);
            const finished = [0, 0, 1, 1, 3, 3, 4, 4, 5];
            const result = trueStartsOfDump(statuses, finished, QUARTER, 4, 9);
            expect(result.diag.phase_ties).toBe(2);
            expect(result.diag.phase_runs).toBe(2);
        });

        it("does not fit a phase when the first sample is not working", () => {
            const result = trueStartsOfDump([SHORT, SHORT], [0, 0], QUARTER, 0, 2);
            expect(result.diag.phase_runs).toBe(1);
            expect(result.diag.phase_ties).toBe(0);
        });
    });

    describe("a craft of a tick or less (delta >= 1)", () => {
        it("starts on every working tick, and on a rise that no working sample precedes", () => {
            const statuses = [FULL, WORK, FULL, FULL, WORK, FULL, FULL];
            const finished = [0, 0, 1, 1, 1, 2, 2];
            const result = trueStartsOfDump(statuses, finished, 2, 0, 7);
            // 1 and 4 work; 2 is a rise after a working sample (the craft in progress), 5 too
            expect(at(result.start)).toEqual([1, 4]);
            expect(at(result.craft_out)).toEqual([2, 5]);
            expect(result.diag).toEqual({ resync: 0, miss: 0, phase_ties: 0, phase_viol: 0, phase_runs: 0 });
        });

        it("starts a craft begun and finished between two samples of full output", () => {
            const result = trueStartsOfDump([FULL, FULL, FULL], [0, 1, 1], 1, 0, 3);
            expect(at(result.start)).toEqual([1]);
            expect(at(result.craft_out)).toEqual([1]);
        });
    });
});

describe("trueStartsOfProgress", () => {
    it("starts when the progress is strictly between 0 and 1 after resting at 0, or a craft pending at 1", () => {
        const progress = [0, 0.25, 0.5, 0.75, 0, 0.25, 1, 0.25];
        expect(at(trueStartsOfProgress(progress, QUARTER, 8))).toEqual([1, 5, 7]);
    });

    it("starts at a wrap while working: the progress fell", () => {
        expect(at(trueStartsOfProgress([0.5, 0.75, 0.25, 0.5], QUARTER, 4))).toEqual([2]);
    });

    it("starts on every tick that leaves the progress strictly between 0 and 1 when a craft takes a tick or less", () => {
        expect(at(trueStartsOfProgress([0, 0.5, 0, 1, 0.3], 2, 5))).toEqual([1, 4]);
    });
});
