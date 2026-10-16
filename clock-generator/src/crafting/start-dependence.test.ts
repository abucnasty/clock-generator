import { describe, expect, it } from "vitest";
import {
    CLOCK_STARTS, COLD_START_SHIFTS, cycleOf, startDependenceNote, startsReachingTarget, startVerdictOf,
    type StartDependence, type StartOutcome,
} from "./start-dependence";
import { clockVerdictOf, type ClockAssessment } from "./trial";

const outcome = (id: string, reaches_target: boolean, output_items_per_period: number | null = null, cycle: number[] | null = null, off_bins: StartOutcome["off_bins"] = null, span_items: number | null = null, long_run_keeps_up: boolean | null = null): StartOutcome =>
    ({ id, label: id, reaches_target, output_items_per_period, cycle, off_bins, span_items, long_run_keeps_up });

describe("the starts a clock is tried from", () => {
    it("are the cold start with the clock at five places of its period, then ascending and two random orders, the cold start first", () => {
        expect(CLOCK_STARTS.map(it => it.id)).toEqual(["cold", "cold+30", "cold+300", "cold+700", "cold+1000", "ascending", "random-1", "random-2"]);
        expect(COLD_START_SHIFTS).toEqual([0, 30, 300, 700, 1000]);
        expect(CLOCK_STARTS.slice(0, 5).map(it => [it.clock_shift, it.competing_takers_order])).toEqual([0, 30, 300, 700, 1000].map(shift => [shift, "descending"]));
        expect(CLOCK_STARTS.slice(5).map(it => [it.clock_shift, it.competing_takers_order])).toEqual([[0, "ascending"], [0, { seed: 1 }], [0, { seed: 2 }]]);
    });
});

describe("the verdict of a clock tried from several starts", () => {
    it("is stable when every start reaches the target", () => {
        expect(startVerdictOf([outcome("a", true), outcome("b", true)])).toBe("stable");
    });

    it("is start-dependent when some start reaches it and some does not, the cold start or another", () => {
        expect(startVerdictOf([outcome("cold", true), outcome("random-1", false)])).toBe("start-dependent");
        expect(startVerdictOf([outcome("cold", false), outcome("random-1", true)])).toBe("start-dependent");
    });

    it("is unstable when no start reaches it", () => {
        expect(startVerdictOf([outcome("cold", false), outcome("random-1", false)])).toBe("unstable");
    });

    it("lists a clock that depends on the start as unstable among the verdicts of a clock, and a stable one as it was", () => {
        const assessment = (start_dependence: StartDependence | null): ClockAssessment =>
            ({ holds: true, backpressure_loss: null, items_per_second: 480, wake_ups_per_minute: 100, start_dependence });
        const dependence = (verdict: StartDependence["verdict"]): StartDependence => ({ verdict, starts: [], expected_output_items: 3072 });
        expect(clockVerdictOf(assessment(null))).toBe("stable");
        expect(clockVerdictOf(assessment(dependence("stable")))).toBe("stable");
        expect(clockVerdictOf(assessment(dependence("start-dependent")))).toBe("unstable");
        expect(clockVerdictOf({ ...assessment(dependence("stable")), backpressure_loss: { survives: false, broken_by: ["coal stops arriving"], recovered_after_periods: null } })).toBe("no recovery");
    });
});

describe("the starts that reach the target, every one judged on the same checks", () => {
    const verdictOf = (cold_holds: boolean, ran: boolean[]) =>
        startVerdictOf(startsReachingTarget(cold_holds, ran).map(reaches_target => ({ reaches_target })));

    it("is the cold start's verdict for the cold start and the run for every other", () => {
        expect(startsReachingTarget(true, [true, true, false])).toEqual([true, true, false]);
        expect(startsReachingTarget(false, [false, true, true])).toEqual([false, true, true]);
    });

    it("is unstable, not start-dependent, for a clock that fails from every start", () => {
        expect(verdictOf(false, [false, false, false])).toBe("unstable");
    });

    it("is unstable where the cold start fails a check that is not about the start although every run keeps up", () => {
        // the one-period check or a start phase fails; the long runs of the other starts do not make the clock hold
        expect(startsReachingTarget(false, [true, true, true])).toEqual([false, false, false]);
        expect(verdictOf(false, [true, true, true])).toBe("unstable");
    });

    it("is start-dependent only where some start passes and some fails", () => {
        expect(verdictOf(true, [true, false, true])).toBe("start-dependent");
        expect(verdictOf(false, [false, true, true])).toBe("start-dependent");
        expect(verdictOf(true, [true, true, true])).toBe("stable");
    });
});

describe("the cycle a settled clock repeats in", () => {
    it("is one value for a flat run", () => {
        expect(cycleOf([2304, 3072, 3072, 3072, 3072, 3072, 3072, 3072])).toEqual([3072]);
    });

    it("is the shortest cycle of the last half of the run", () => {
        expect(cycleOf([2160, 2768, 2736, 2736, 2688, 2640, 2736, 2688, 2640, 2736, 2688, 2640])).toEqual([2736, 2688, 2640]);
    });

    it("is null when the run repeats in none", () => {
        expect(cycleOf([1, 2, 3, 4, 5, 6, 7, 8])).toBeNull();
    });
});

describe("the line that says where a clock depends on the start", () => {
    const per_second = (items: number) => items * 60 / 1344 * 3.5;
    const dependence = (...starts: StartOutcome[]): StartDependence => ({ verdict: startVerdictOf(starts), starts, expected_output_items: 3072 });

    it("names the starts that reach the target and, for each that settles elsewhere, its rate and its cycle", () => {
        const note = startDependenceNote(dependence(
            outcome("cold", true, 3072, [3072]),
            outcome("cold+30", true, 3072, [3072]),
            outcome("ascending", false, 2880, [2784, 2944, 2912]),
        ), per_second);
        expect(note).toBe("start-dependent: reaches 480/s from cold, cold+30; settles at 2880 a period (450.0/s, cycle 2784/2944/2912) from ascending.");
    });

    it("gives the rate alone for a flat run and says so when no long run was made", () => {
        expect(startDependenceNote(dependence(outcome("cold", true), outcome("random-1", false, 2560, [2560]), outcome("ascending", false)), per_second))
            .toBe("start-dependent: reaches 480/s from cold; settles at 2560 a period (400.0/s) from random-1; has no long run from ascending.");
    });

    it("says how many periods are off the target where the mean is at it", () => {
        expect(startDependenceNote(dependence(outcome("cold", true), outcome("random-1", false, 3072, [3072], { count: 3, of: 80 })), per_second))
            .toBe("start-dependent: reaches 480/s from cold; settles at 3072 a period (480.0/s, 3 of 80 periods more than a hand off it) from random-1.");
    });

    it("says by how many items the judged part is under the target where no period is far off it", () => {
        expect(startDependenceNote(dependence(outcome("cold", true), outcome("random-1", false, 3072, [3072], { count: 0, of: 80 }, -40, false)), per_second))
            .toBe("start-dependent: reaches 480/s from cold; settles at 3072 a period (480.0/s, 40 items under the judged periods as a whole) from random-1.");
    });

    it("is null for a clock that is stable or unstable", () => {
        expect(startDependenceNote(dependence(outcome("cold", true), outcome("random-1", true)), per_second)).toBeNull();
        expect(startDependenceNote(dependence(outcome("cold", false), outcome("random-1", false)), per_second)).toBeNull();
    });
});
