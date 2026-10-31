import { describe, it, expect } from "vitest";
import { combineClockAlternativeRuns, rankingOf, searchesAreNeeded, type ClockAlternative, type ClockAlternativeRun, type ClockRanking } from "./generate-blueprint";
import { clockVerdictOf, windowsRoundedTo, type ClockAssessment } from "./trial";
import { clockCost, costTieFloor, searchesToRun, type ClockCost, type RoundedClock } from "./rank";
import type { InserterCount, InserterCounters } from "./inserter-counters";
import type { Config } from "../config";

type Ranked = ClockRanking & { id: string };

/** A cost of `ns` a tick for one copy, all of it paid for wake-ups unless `wake_side` says how much is */
const c = (ns: number, wake_side = ns): ClockCost =>
    ({ ns_per_tick: ns, input_wake_ups: wake_side, output_wake_ups: 0, belt_waits: 0, windows: ns - wake_side, wires: 0, deciders: 0 });

const clock = (id: string, ranking: Partial<ClockRanking> = {}): Ranked => ({
    id,
    meets_target_rate: true,
    rate_off_target: 0,
    holds_expected_output: true,
    matches_belt_choice: true,
    wake_ups_per_minute: 100,
    cost: c(1000),
    window_count: 10,
    ...ranking,
});

/** Each clock is a run of its own with windows of its own, unless it is given the signature of another */
const selectedOf = (clocks: Ranked[], signatures: Record<string, string> = {}): string => {
    const runs: ClockAlternativeRun<Ranked>[] = clocks.map(it => ({ signature: signatures[it.id] ?? it.id, alternatives: [it] }));
    const { alternatives, selected_index } = combineClockAlternativeRuns(runs, it => it);
    return alternatives[selected_index].id;
};

describe("combineClockAlternativeRuns", () => {
    it("lists the runs made with shared windows after the run, once, and ranks them with the rest", () => {
        const shared = (id: string, ranking: Partial<ClockRanking>, signature: string): ClockAlternativeRun<Ranked> => ({ signature, alternatives: [clock(id, ranking)] });
        const runs: ClockAlternativeRun<Ranked>[] = [
            { signature: "a", alternatives: [clock("a", { cost: c(800) })], also: [shared("a-shared", { cost: c(200) }, "a-shared")] },
            // the same clock again, with its shared one: listed once
            { signature: "a", alternatives: [clock("a-again")], also: [shared("a-shared-again", {}, "a-shared")] },
            { signature: "b", alternatives: [clock("b", { cost: c(500) })] },
        ];
        const { alternatives, selected_index } = combineClockAlternativeRuns(runs, it => it);
        expect(alternatives.map(it => it.id)).toEqual(["a", "a-shared", "b"]);
        expect(alternatives[selected_index].id).toBe("a-shared");
    });

    it("picks between a clock and its shared one as between any two: the one that keeps the rate and recovers, then the lowest cost, not the fewest deciders", () => {
        const pair = (separate: Partial<ClockRanking>, shared: Partial<ClockRanking>): string => {
            const runs: ClockAlternativeRun<Ranked>[] = [
                { signature: "a", alternatives: [clock("a", separate)], also: [{ signature: "a-shared", alternatives: [clock("a-shared", shared)] }] },
            ];
            const { alternatives, selected_index } = combineClockAlternativeRuns(runs, it => it);
            return alternatives[selected_index].id;
        };
        // shared windows keep some inserters enabled longer, so they wake more and cost more: the separate clock stays selected
        expect(pair({ cost: c(8400) }, { cost: c(14900) })).toBe("a");
        // where the separate windows do not keep the rate and recover, the shared clock is selected whatever its cost
        expect(pair({ cost: c(400), meets_target_rate: false }, { cost: c(700) })).toBe("a-shared");
    });

    it("selects the clock of the lowest cost among those that meet the target rate", () => {
        expect(selectedOf([
            clock("first", { cost: c(800) }),
            clock("more-windows", { cost: c(300), window_count: 25 }),
            clock("off-target", { cost: c(0), meets_target_rate: false }),
        ])).toBe("more-windows");
    });

    it("selects a clock that keeps belt pickup slack over a cheaper one that leaves it out", () => {
        expect(selectedOf([
            clock("slack", { cost: c(800) }),
            clock("no-slack", { cost: c(300), matches_belt_choice: false }),
        ])).toBe("slack");
    });

    it("selects a clock without belt pickup slack when no clock with it meets the target rate", () => {
        expect(selectedOf([
            clock("slack", { meets_target_rate: false }),
            clock("no-slack", { matches_belt_choice: false }),
        ])).toBe("no-slack");
    });

    it("selects the fewest windows among clocks of the same cost, and the first listed among equals", () => {
        expect(selectedOf([
            clock("first", { window_count: 12 }),
            clock("fewer-windows", { window_count: 9, cost: c(1000.004) }),
            clock("same", { window_count: 9 }),
        ])).toBe("fewer-windows");
    });

    it("ranks a clock whose wake-ups were not counted, so it has no cost, after one whose were", () => {
        expect(selectedOf([
            clock("not-counted", { cost: null, window_count: 1 }),
            clock("counted", { cost: c(5000) }),
        ])).toBe("counted");
    });

    it("selects the first listed when no clock meets the target rate and the windows are the same", () => {
        expect(selectedOf([
            clock("first", { meets_target_rate: false }),
            clock("second", { meets_target_rate: false }),
        ])).toBe("first");
    });

    // the processing unit sample with a belt export: no clock holds 40 a second, and the one with the fewest windows
    // made 18.4 where another made 34.3
    it("selects the clock nearest to the target rate when none meets it, whatever its windows and its belt", () => {
        expect(selectedOf([
            clock("fewest-windows", { meets_target_rate: false, rate_off_target: -21.64, window_count: 5 }),
            clock("nearest", { meets_target_rate: false, rate_off_target: -5.69, window_count: 40, matches_belt_choice: false }),
            clock("between", { meets_target_rate: false, rate_off_target: -8.57, window_count: 60 }),
        ])).toBe("nearest");
    });

    // the metallurgic science sample: the full-hand subtick clock holds 45 a second and does not get back from a loss
    // of tungsten ore; the plain 1-swing clock at the same rate fails the long run, with fewer wake-ups
    it("selects, of two clocks equally near a target rate no clock meets, the one that holds its expected output", () => {
        expect(selectedOf([
            clock("drifts", { meets_target_rate: false, rate_off_target: 0, holds_expected_output: false, cost: c(300) }),
            clock("holds", { meets_target_rate: false, rate_off_target: 0, cost: c(800) }),
        ])).toBe("holds");
    });

    it("does not look at whether a clock holds while another is nearer to the target rate", () => {
        expect(selectedOf([
            clock("holds-far", { meets_target_rate: false, rate_off_target: -5 }),
            clock("drifts-near", { meets_target_rate: false, rate_off_target: -1, holds_expected_output: false }),
        ])).toBe("drifts-near");
    });

    it("counts a rate above the target as far off as one below it", () => {
        expect(selectedOf([
            clock("over", { meets_target_rate: false, rate_off_target: 3 }),
            clock("under", { meets_target_rate: false, rate_off_target: -2 }),
        ])).toBe("under");
    });

    // Thaeln's cell 07: no clock holds 80.42 a second; the stable observed windows clock runs 2.3% over it, an unstable
    // clock of 6 output swings 0.2% under it
    it("selects a stable clock over the target rate before an unstable one nearer to it, the nearest of them first", () => {
        expect(selectedOf([
            clock("unstable-near", { meets_target_rate: false, rate_off_target: -0.18, holds_expected_output: false, cost: c(490) }),
            clock("stable-far-over", { meets_target_rate: false, stable_above_target: true, rate_off_target: 4, cost: c(1000) }),
            clock("stable-over", { meets_target_rate: false, stable_above_target: true, rate_off_target: 1.87, cost: c(4200) }),
        ])).toBe("stable-over");
    });

    it("selects a clock that meets the target rate before one stable over it", () => {
        expect(selectedOf([
            clock("stable-over", { meets_target_rate: false, stable_above_target: true, rate_off_target: 0.5, cost: c(10) }),
            clock("untried", { recovery_untried: true, cost: c(9000) }),
        ])).toBe("untried");
    });

    // the container wagons: even hands and the batched clock both at 0 wake-ups; even hands is back from a loss sooner
    it("selects, of clocks equal on cost, the one that gets back from a loss in fewer periods, before the fewest windows", () => {
        expect(selectedOf([
            clock("slow", { cost: c(0), recovery_periods: 33, window_count: 2 }),
            clock("fast", { cost: c(0), recovery_periods: 3, window_count: 9 }),
        ])).toBe("fast");
        expect(selectedOf([
            clock("untried", { cost: c(0), recovery_periods: null, window_count: 2 }),
            clock("tried", { cost: c(0), recovery_periods: 40, window_count: 9 }),
        ])).toBe("tried");
        expect(selectedOf([
            clock("cheaper", { cost: c(1000), recovery_periods: 40 }),
            clock("sooner", { cost: c(1000 + costTieFloor(1000)), recovery_periods: 1 }),
        ])).toBe("cheaper");
    });

    it("does not look at how near a clock is to the target rate while one meets it", () => {
        expect(selectedOf([
            clock("meets", { cost: c(5000) }),
            clock("near", { meets_target_rate: false, rate_off_target: 0.01, cost: c(0) }),
        ])).toBe("meets");
    });

    it("lists runs with the same windows once", () => {
        const runs: ClockAlternativeRun<Ranked>[] = [
            { signature: "a", alternatives: [clock("first")] },
            { signature: "a", alternatives: [clock("duplicate", { cost: c(0) })] },
        ];
        const { alternatives, selected_index } = combineClockAlternativeRuns([...runs, null], it => it);
        expect(alternatives.map(it => it.id)).toEqual(["first"]);
        expect(selected_index).toBe(0);
    });
});

// the car paste at 80.78/s: a clock whose losses could not be tried (its period has no whole-tick repeat) was taken as
// stable and beat every clock that was tried (U11)
describe("a clock whose recovery could not be tried", () => {
    const untried = (id: string, ranking: Partial<ClockRanking> = {}) => clock(id, { recovery_untried: true, ...ranking });
    const no_recovery = (id: string, ranking: Partial<ClockRanking> = {}) => clock(id, { meets_target_rate: false, ...ranking });

    it("ranks below a clock tried and getting back, whatever their costs", () => {
        expect(selectedOf([untried("untried", { cost: c(10) }), clock("recovers", { cost: c(9000) })])).toBe("recovers");
        expect(selectedOf([clock("recovers", { cost: c(9000) }), untried("untried", { cost: c(10) })])).toBe("recovers");
    });

    it("ranks above a clock tried and not getting back at the target rate, whatever their costs", () => {
        expect(selectedOf([no_recovery("no-recovery", { cost: c(10) }), untried("untried", { cost: c(9000) })])).toBe("untried");
        expect(selectedOf([untried("untried", { cost: c(9000) }), no_recovery("no-recovery", { cost: c(10) })])).toBe("untried");
    });

    it("is ranked among clocks like it by their cost", () => {
        expect(selectedOf([untried("more", { cost: c(5000) }), untried("fewer", { cost: c(500) }),
            no_recovery("no-recovery", { cost: c(0) })])).toBe("fewer");
    });

    it("leaves the searches to run: it is not a clock the selection can end on as stable", () => {
        expect(searchesAreNeeded([{ signature: "one", alternatives: [untried("untried")] }], it => it)).toBe(true);
        expect(searchesAreNeeded([{ signature: "one", alternatives: [untried("untried"), clock("recovers")] }], it => it)).toBe(false);
    });

    const config = { target_output: { recipe: "iron-plate", items_per_second: 80 } } as Config;
    const assessment = (overrides: Partial<ClockAssessment>): ClockAssessment =>
        ({ holds: true, backpressure_loss: null, items_per_second: 80, wake_ups_per_minute: 200, start_dependence: null, ...overrides });
    const ranked = (overrides: Partial<ClockAssessment>, deadlock = false): ClockRanking => {
        const clock_assessment = assessment(overrides);
        return rankingOf({ assessment: clock_assessment, verdict: clockVerdictOf(clock_assessment), ranking_window_count: 4,
            deadlock_risks: deadlock ? [{}] : [], result: { belt_pickup_slack_left_out: false, stability_check: {} } } as unknown as Omit<ClockAlternative, "ranking">, config);
    };
    const NOT_TRIED = "A clock of 47.537 ticks does not repeat in whole ticks, so its output cannot be counted by the period";

    it("is a clock that holds the target rate with no loss verdict and the reason the trials did not run", () => {
        expect(clockVerdictOf(assessment({ backpressure_loss_not_tried: NOT_TRIED }))).toBe("stable");
        expect(ranked({ backpressure_loss_not_tried: NOT_TRIED })).toMatchObject({ meets_target_rate: true, recovery_untried: true });
        expect(ranked({ backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 3 } }))
            .toMatchObject({ meets_target_rate: true, recovery_untried: false });
        expect(ranked({ holds: false })).toMatchObject({ meets_target_rate: false, recovery_untried: false });
    });

    it("is not one off the target rate, which ranks by its rate, nor one on a build with a deadlock risk, where the trials do not decide", () => {
        expect(ranked({ backpressure_loss_not_tried: NOT_TRIED, items_per_second: 81.7 })).toMatchObject({ meets_target_rate: false, recovery_untried: false });
        expect(ranked({ backpressure_loss_not_tried: NOT_TRIED }, true)).toMatchObject({ meets_target_rate: true, recovery_untried: false });
    });

    it("is not stable above the target rate, which needs its recovery tried and passed, or on a build with a deadlock risk its output held", () => {
        const recovers = { survives: true, broken_by: [], recovered_after_periods: 3 };
        expect(ranked({ backpressure_loss: recovers, items_per_second: 81.7 }).stable_above_target).toBe(true);
        expect(ranked({ backpressure_loss_not_tried: NOT_TRIED, items_per_second: 81.7 }).stable_above_target).toBeUndefined();
        expect(ranked({ backpressure_loss: { ...recovers, survives: false, broken_by: ["coal stops arriving"] }, items_per_second: 81.7 }).stable_above_target).toBeUndefined();
        expect(ranked({ holds: false, items_per_second: 81.7 }).stable_above_target).toBeUndefined();
        expect(ranked({ backpressure_loss_not_tried: NOT_TRIED, items_per_second: 81.7 }, true).stable_above_target).toBe(true);
    });
});

// Atlan cell 29: the 2,888-tick clock of a 2,888.666-tick period runs 0.02% fast, and held and recovered in the game (#332)
describe("a clock rounded down to whole ticks", () => {
    const rounded = (id: string, ranking: Partial<ClockRanking> = {}) => clock(id, { runs_fast: 0.0002, ...ranking });

    it("ranks below a clock that meets the target rate exactly, whatever their costs", () => {
        expect(selectedOf([rounded("rounded", { cost: c(10) }), clock("exact", { cost: c(9000) })])).toBe("exact");
    });

    it("ranks above a clock whose recovery could not be tried and one that does not meet the target rate", () => {
        expect(selectedOf([clock("untried", { recovery_untried: true, cost: c(10) }), rounded("rounded", { cost: c(9000) })])).toBe("rounded");
        expect(selectedOf([clock("no-recovery", { meets_target_rate: false, cost: c(0) }), rounded("rounded", { cost: c(9000) })])).toBe("rounded");
    });

    it("leaves the searches to run for a clock of exactly the target rate", () => {
        expect(searchesAreNeeded([{ signature: "one", alternatives: [rounded("rounded")] }], it => it)).toBe(true);
    });

    const config = { target_output: { recipe: "iron-gear-wheel", items_per_second: 9.97 } } as Config;
    const ranked = (items_per_second: number, rounded_clock: Partial<RoundedClock> | undefined) => {
        const assessment: ClockAssessment = { holds: true, items_per_second, wake_ups_per_minute: 13.4, start_dependence: null,
            backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 2 } };
        return rankingOf({ assessment, verdict: clockVerdictOf(assessment), ranking_window_count: 4, deadlock_risks: [],
            result: { belt_pickup_slack_left_out: false, stability_check: {} },
            ...(rounded_clock && { rounded: { period_ticks: 2888, runs_fast: items_per_second / 9.97 - 1, within_machines: true, tried_on_its_period: true, ...rounded_clock } }),
        } as unknown as Omit<ClockAlternative, "ranking">, config);
    };
    const fast = 480 * 60 / 2888;

    it("meets the target rate at most 0.1% fast, within the machines, tried on its own period, and says how fast", () => {
        expect(ranked(fast, {})).toMatchObject({ meets_target_rate: true, runs_fast: expect.closeTo(0.00023, 5) });
        expect(ranked(9.97 * 1.000999, {})).toMatchObject({ meets_target_rate: true });
    });

    it("does not meet it more than 0.1% fast, beyond the machines, untried on its own period, or as an exact clock off the rate", () => {
        expect(ranked(9.97 * 1.0011, {})).toMatchObject({ meets_target_rate: false });
        expect(ranked(fast, { within_machines: false })).toMatchObject({ meets_target_rate: false });
        expect(ranked(fast, { tried_on_its_period: false })).toMatchObject({ meets_target_rate: false });
        expect(ranked(fast, undefined)).toMatchObject({ meets_target_rate: false });
        expect(ranked(fast, undefined).runs_fast).toBeUndefined();
        expect(ranked(9.97, undefined)).toMatchObject({ meets_target_rate: true });
        expect(ranked(9.97, undefined).runs_fast).toBeUndefined();
    });

    it("is stable above the target rate only as a clock of its exact period, never rounded", () => {
        expect(ranked(9.97 * 1.02, undefined)).toMatchObject({ meets_target_rate: false, stable_above_target: true });
        expect(ranked(9.97 * 1.0011, {}).stable_above_target).toBeUndefined();
        expect(ranked(9.97, undefined).stable_above_target).toBeUndefined();
        expect(ranked(9.97 * 0.98, undefined).stable_above_target).toBeUndefined();
    });

    it("runs on its windows rounded as its blueprint counts them", () => {
        expect(windowsRoundedTo({ "inserter:1": [{ start: 0, end: 30 }, { start: 2870, end: 2888 }, { start: 2888, end: 2888 }] }, 2888))
            .toEqual({ "inserter:1": [{ start: 0, end: 30 }, { start: 2870, end: 2887 }] });
    });
});

describe("searchesAreNeeded", () => {
    const needed = (clocks: (Ranked | null)[]): boolean =>
        searchesAreNeeded(clocks.map(it => it && { signature: it.id, alternatives: [it] }), it => it);

    it("is not, once a clock made without a search meets the target rate for the belt asked", () => {
        expect(needed([clock("unstable", { meets_target_rate: false }), null, clock("stable", { cost: c(9000) })])).toBe(false);
    });

    it("is, when no clock made without a search meets the target rate", () => {
        expect(needed([clock("unstable", { meets_target_rate: false }), clock("no-recovery", { meets_target_rate: false })])).toBe(true);
    });

    // military science: its one stable clock leaves belt pickup slack out, on a config that does not say the input belts are backed up
    it("is, when the only clock that meets the target rate is not made for the belt asked", () => {
        expect(needed([clock("slack", { meets_target_rate: false }), clock("no-slack", { matches_belt_choice: false })])).toBe(true);
    });

    it("is, when every clock made without a search failed", () => {
        expect(needed([null, null])).toBe(true);
    });

    // the subtick clock of a period of part ticks and the same clock rounded come from one run
    it("looks at every clock of a run", () => {
        const subtick = clock("subtick");
        const rounded = clock("rounded", { meets_target_rate: false, rate_off_target: 0.2 });
        expect(searchesAreNeeded([{ signature: "one", alternatives: [rounded, subtick] }], it => it)).toBe(false);
    });
});

describe("searchesAreNeeded", () => {
    it("counts the clock made with shared windows as on offer: no search is needed where it can be selected as stable", () => {
        const separate = clock("separate", { meets_target_rate: false });
        expect(searchesAreNeeded([{ signature: "one", alternatives: [separate] }], it => it)).toBe(true);
        expect(searchesAreNeeded([{ signature: "one", alternatives: [separate], also: [{ signature: "one-shared", alternatives: [clock("shared")] }] }], it => it)).toBe(false);
    });
});

describe("searchesToRun", () => {
    const SEARCHES = [{ id: "derived" }, { id: "uneven-output" }, { id: "shifted-swings" }, { id: "full-hand" }];
    const toRun = (clocks: Ranked[], period: number) =>
        searchesToRun(clocks.map(it => ({ signature: it.id, alternatives: [it] })), it => it, SEARCHES, period).map(it => it.id);

    it("runs every search where no clock made without one can be selected as stable", () => {
        expect(toRun([clock("unstable", { meets_target_rate: false })], 5000)).toEqual(["derived", "uneven-output", "shifted-swings", "full-hand"]);
    });

    it("runs the two that can improve on a stable clock that pays at least the floor for its wake-ups, on a period of at most 480 ticks", () => {
        expect(toRun([clock("stable", { cost: c(1975) })], 144)).toEqual(["derived", "shifted-swings"]);
        expect(toRun([clock("stable", { cost: c(1975) })], 480)).toEqual(["derived", "shifted-swings"]);
    });

    it("runs none past a stable clock whose wake-ups cost less than the floor, or on a longer period", () => {
        expect(toRun([clock("stable", { cost: c(0) })], 144)).toEqual([]);
        expect(toRun([clock("stable", { cost: c(0.004) })], 144)).toEqual([]);
        // 197.5 input wake-ups a minute are 4.7 ns a tick: fewer could not beat it by the floor
        expect(toRun([clock("stable", { cost: c(500, 197.5 * 85 / 3600) })], 144)).toEqual([]);
        expect(toRun([clock("stable", { cost: c(500, costTieFloor(500)) })], 144)).toEqual(["derived", "shifted-swings"]);
        expect(toRun([clock("stable", { cost: c(1975) })], 481)).toEqual([]);
    });

    it("judges the clock the selection ends on so far, not another stable one", () => {
        expect(toRun([clock("more", { cost: c(300) }), clock("none", { cost: c(0) })], 144)).toEqual([]);
    });
});

// decided 2026-10-31: robustness is a gate, the priced cost ranks the clocks that pass it with ties under the floor, the
// periods to recover part tied clocks, and the wake-ups are reported, not ranked
describe("the ranking rule", () => {
    it("ranks only the clocks that hold and recover by their cost: a far cheaper one that does not recover is not among them", () => {
        expect(selectedOf([
            clock("no-recovery", { meets_target_rate: false, cost: c(10) }),
            clock("dearer", { cost: c(90_000) }),
        ])).toBe("dearer");
    });

    it("ties two costs closer than the floor, and selects of them the one that recovers in fewer periods", () => {
        const floor = costTieFloor(1000);
        expect(floor).toBe(39);
        expect(selectedOf([
            clock("cheaper", { cost: c(1000), recovery_periods: 30 }),
            clock("sooner", { cost: c(1000 + floor - 1), recovery_periods: 4 }),
        ])).toBe("sooner");
        expect(selectedOf([
            clock("cheaper", { cost: c(1000), recovery_periods: 30 }),
            clock("dearer", { cost: c(1000 + floor + 1), recovery_periods: 4 }),
        ])).toBe("cheaper");
    });

    it("ties against the cheapest clock: a third clock within the floor of the second but not the first does not tie", () => {
        expect(selectedOf([
            clock("cheapest", { cost: c(1000), recovery_periods: 30 }),
            clock("tied", { cost: c(1030), recovery_periods: 20 }),
            clock("beyond", { cost: c(1060), recovery_periods: 1 }),
        ])).toBe("tied");
    });

    it("takes the floor as 0.5% of the cheaper cost where that is above 39 ns", () => {
        expect(costTieFloor(20_000)).toBe(100);
        expect(selectedOf([
            clock("cheaper", { cost: c(20_000), recovery_periods: 9 }),
            clock("sooner", { cost: c(20_090), recovery_periods: 2 }),
        ])).toBe("sooner");
    });

    it("does not let raw wake-ups decide between two clocks whose costs tie", () => {
        expect(selectedOf([
            clock("more-wake-ups", { wake_ups_per_minute: 600, cost: c(2000), recovery_periods: 3 }),
            clock("fewer-wake-ups", { wake_ups_per_minute: 20, cost: c(2010), recovery_periods: 5 }),
        ])).toBe("more-wake-ups");
        expect(selectedOf([
            clock("first", { wake_ups_per_minute: 600, cost: c(2000), recovery_periods: 3, window_count: 4 }),
            clock("fewer-wake-ups", { wake_ups_per_minute: 20, cost: c(2000), recovery_periods: 3, window_count: 4 }),
        ])).toBe("first");
    });
});

describe("clockCost", () => {
    const count = (overrides: Partial<InserterCount>): InserterCount => ({
        inserter_id: "inserter:1", pickup_kind: "machine", drop_kind: "machine",
        input_wake_ups_per_minute: 0, output_wake_ups_per_minute: 0, working_ticks_per_minute: 0,
        waiting_for_items: { end: "source", kind: "machine", ticks_per_minute: 0 },
        waiting_for_space: { end: "sink", kind: "machine", ticks_per_minute: 0 },
        grabs_per_minute: 0, swings_per_minute: 0, part_hand_swings_per_minute: 0, extra_grabs_per_minute: 0,
        switch_ons_per_minute: 0, switch_offs_per_minute: 0, switch_ons_at_rest_per_minute: 0, switch_ons_moving_per_minute: 0,
        network_width: 0, ...overrides,
    });
    const counters = (inserters: InserterCount[], deciders: number | null = 0): InserterCounters =>
        ({ ticks: 3600, wired_inserters: 0, unwired_inserters: 0, copies: 1, deciders, inserters });

    it("prices each wake-up, belt wait, switch-on, wire and decider of one copy, ns a tick", () => {
        const cost = clockCost(counters([
            // a wired belt pickup into a machine: 36 input wake-ups, 720 waiting ticks and 12 switch-ons a minute
            count({ pickup_kind: "belt", input_wake_ups_per_minute: 36, switch_ons_per_minute: 12, network_width: 3,
                waiting_for_items: { end: "source", kind: "belt", ticks_per_minute: 720 }, extra_grabs_per_minute: 50 }),
            // an unwired taker onto a belt: 72 output wake-ups a minute, of a machine starting half a craft a tick
            count({ drop_kind: "belt", output_wake_ups_per_minute: 72, source_craft_starts_per_tick: 0.5 }),
            // a wired taker into a chest, of a machine starting 1.5 crafts a tick: the busy price
            count({ drop_kind: "chest", output_wake_ups_per_minute: 36, network_width: 3, switch_ons_per_minute: 6, source_craft_starts_per_tick: 1.5 }),
        ], 2), 144)!;
        expect(cost.input_wake_ups).toBeCloseTo(36 * 85 / 3600, 9);
        expect(cost.output_wake_ups).toBeCloseTo((72 * 308 + 36 * 152.3) / 3600, 9);
        // a belt pickup's every waiting tick, its hands not priced (extra grabs are not)
        expect(cost.belt_waits).toBeCloseTo(720 * 135.8 / 3600, 9);
        expect(cost.windows).toBeCloseTo(18 * 146.9 / 3600, 9);
        expect(cost.wires).toBeCloseTo(3.08 + 2.29, 9);
        expect(cost.deciders).toBe(62);
        expect(cost.ns_per_tick).toBeCloseTo(cost.input_wake_ups + cost.output_wake_ups + cost.belt_waits + cost.windows + cost.wires + cost.deciders, 9);
    });

    it("scales the cold start's wake-ups to the mean over the starts the clock is ranked by", () => {
        const of = (wake_ups: number) => clockCost(counters([count({ input_wake_ups_per_minute: 30, output_wake_ups_per_minute: 30 })]), wake_ups)!;
        expect(of(120).input_wake_ups).toBeCloseTo(2 * of(60).input_wake_ups, 9);
        expect(of(120).output_wake_ups).toBeCloseTo(2 * of(60).output_wake_ups, 9);
        expect(clockCost(counters([count({})]), 36)!.input_wake_ups).toBeCloseTo(36 * 85 / 3600, 9);
    });

    it("has none where the wake-ups were not counted", () => {
        expect(clockCost(undefined, 10)).toBeNull();
        expect(clockCost(counters([count({})]), null)).toBeNull();
    });

    it("is what rankingOf puts in the ranking, from the counters of the clock's as-built check", () => {
        const assessment: ClockAssessment = { holds: true, items_per_second: 1, wake_ups_per_minute: 36, start_dependence: null,
            backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 2 } };
        const as_built = { counters: counters([count({ input_wake_ups_per_minute: 36 })]) };
        const ranking = rankingOf({ assessment, verdict: clockVerdictOf(assessment), ranking_window_count: 1, deadlock_risks: [],
            result: { belt_pickup_slack_left_out: false, stability_check: { as_built } } } as unknown as Omit<ClockAlternative, "ranking">,
        { target_output: { recipe: "iron-gear-wheel", items_per_second: 1 } } as Config);
        expect(ranking.cost).toEqual(clockCost(as_built.counters, 36));
        expect(ranking.wake_ups_per_minute).toBe(36);
    });
});
