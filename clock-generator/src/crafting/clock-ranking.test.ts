import { describe, it, expect } from "vitest";
import { combineClockAlternativeRuns, rankingOf, searchesAreNeeded, type ClockAlternative, type ClockAlternativeRun, type ClockRanking } from "./generate-blueprint";
import { clockVerdictOf, windowsRoundedTo, type ClockAssessment } from "./trial";
import { noSearchCanBeat, searchesToRun, type RoundedClock } from "./rank";
import type { Config } from "../config";

type Ranked = ClockRanking & { id: string };

const clock = (id: string, ranking: Partial<ClockRanking> = {}): Ranked => ({
    id,
    meets_target_rate: true,
    rate_off_target: 0,
    holds_expected_output: true,
    wake_ups_per_minute: 100,
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
            { signature: "a", alternatives: [clock("a", { wake_ups_per_minute: 80 })], also: [shared("a-shared", { wake_ups_per_minute: 20 }, "a-shared")] },
            // the same clock again, with its shared one: listed once
            { signature: "a", alternatives: [clock("a-again")], also: [shared("a-shared-again", {}, "a-shared")] },
            { signature: "b", alternatives: [clock("b", { wake_ups_per_minute: 50 })] },
        ];
        const { alternatives, selected_index } = combineClockAlternativeRuns(runs, it => it);
        expect(alternatives.map(it => it.id)).toEqual(["a", "a-shared", "b"]);
        expect(alternatives[selected_index].id).toBe("a-shared");
    });

    it("picks between a clock and its shared one as between any two: the one that keeps the rate and recovers, then the fewest wake-ups, not the fewest deciders", () => {
        const pair = (separate: Partial<ClockRanking>, shared: Partial<ClockRanking>): string => {
            const runs: ClockAlternativeRun<Ranked>[] = [
                { signature: "a", alternatives: [clock("a", separate)], also: [{ signature: "a-shared", alternatives: [clock("a-shared", shared)] }] },
            ];
            const { alternatives, selected_index } = combineClockAlternativeRuns(runs, it => it);
            return alternatives[selected_index].id;
        };
        // shared windows keep some inserters enabled longer, so they wake more: the separate clock stays selected
        expect(pair({ wake_ups_per_minute: 840 }, { wake_ups_per_minute: 1490 })).toBe("a");
        // where the separate windows do not keep the rate and recover, the shared clock is selected whatever its wake-ups
        expect(pair({ wake_ups_per_minute: 40, meets_target_rate: false }, { wake_ups_per_minute: 70 })).toBe("a-shared");
    });

    it("selects the clock with the fewest wake-ups among those that meet the target rate", () => {
        expect(selectedOf([
            clock("first", { wake_ups_per_minute: 80 }),
            clock("more-windows", { wake_ups_per_minute: 30, window_count: 25 }),
            clock("off-target", { wake_ups_per_minute: 0, meets_target_rate: false }),
        ])).toBe("more-windows");
    });

    // the time a pickup from a flowing lane takes is the simulation's, so no clock ranks behind another for the belt it takes from
    it("gives a clock's ranking no key for the belt its windows take from", () => {
        const ranking = (verdict: "stable" | "unstable", belt: "moving" | "backed_up") => rankingOf({ verdict, deadlock_risks: [],
            assessment: { items_per_second: 10, wake_ups_per_minute: 30, holds: verdict === "stable", disturbance_trial: {} },
            ranking_window_count: 4, belt: { kind: belt } } as unknown as Omit<ClockAlternative, "ranking">,
            { setpoint: { items_per_second: 10 } } as Config);
        expect(ranking("stable", "moving")).toEqual(ranking("stable", "backed_up"));
        expect(Object.keys(ranking("stable", "moving")).sort()).toEqual(["holds_expected_output", "meets_target_rate", "rate_off_target",
            "recovery_untried", "recovery_window_cycles", "signals_per_minute", "wake_ups_per_minute", "window_count"]);
    });

    // the list of clocks shows each clock's signals a minute from its assessment: the ranking reads the same figure
    it("ranks a clock by the signals a minute of its assessment, null where they were not counted", () => {
        const ranking = (signals_per_minute: number | null | undefined) => rankingOf({ verdict: "stable", deadlock_risks: [],
            assessment: { items_per_second: 10, wake_ups_per_minute: 30, holds: true, disturbance_trial: {},
                ...(signals_per_minute !== undefined && { signals_per_minute }) },
            ranking_window_count: 4 } as unknown as Omit<ClockAlternative, "ranking">,
            { setpoint: { items_per_second: 10 } } as Config);
        expect(ranking(138.4).signals_per_minute).toBe(138.4);
        expect(ranking(null).signals_per_minute).toBeNull();
        expect(ranking(undefined).signals_per_minute).toBeNull();
    });

    // a build with Pitch Pickups of 1 swing and Takt Batches of 2 swings, both at 452 wakeups a minute: 138 signals a
    // minute against 100, where the 1-swing clock recovered in 6 window cycles against 10
    it("selects, of clocks equal on wake-ups, the one with fewer signals a minute, before the window cycles to recover", () => {
        expect(selectedOf([
            clock("more-signals", { wake_ups_per_minute: 452, signals_per_minute: 138, recovery_window_cycles: 6, window_count: 4 }),
            clock("fewer-signals", { wake_ups_per_minute: 452, signals_per_minute: 100, recovery_window_cycles: 10, window_count: 8 }),
        ])).toBe("fewer-signals");
    });

    it("does not let fewer signals overturn fewer wake-ups", () => {
        expect(selectedOf([
            clock("fewer-signals", { wake_ups_per_minute: 452.002, signals_per_minute: 10 }),
            clock("fewer-wake-ups", { wake_ups_per_minute: 452, signals_per_minute: 900 }),
        ])).toBe("fewer-wake-ups");
    });

    it("compares the signals to a thousandth, as the wake-ups", () => {
        expect(selectedOf([
            clock("first", { signals_per_minute: 100.0004, recovery_window_cycles: 9 }),
            clock("sooner", { signals_per_minute: 100, recovery_window_cycles: 3 }),
        ])).toBe("sooner");
    });

    it("ranks a clock whose signals were not counted after one whose were, and as one with none where neither was", () => {
        expect(selectedOf([
            clock("not-counted", { signals_per_minute: null, recovery_window_cycles: 1, window_count: 1 }),
            clock("counted", { signals_per_minute: 5000, recovery_window_cycles: 30, window_count: 30 }),
        ])).toBe("counted");
        // a ranking kept from before the signals ranked has no figure: it ranks as one not counted
        expect(selectedOf([
            clock("kept", { recovery_window_cycles: 1 }),
            clock("counted", { signals_per_minute: 5000, recovery_window_cycles: 30 }),
        ])).toBe("counted");
        expect(selectedOf([
            clock("kept-slow", { recovery_window_cycles: 30 }),
            clock("not-counted-sooner", { signals_per_minute: null, recovery_window_cycles: 2 }),
        ])).toBe("not-counted-sooner");
    });

    it("leaves a tie on wake-ups and signals to the window cycles to recover, then the windows, then the first listed", () => {
        expect(selectedOf([
            clock("slow", { signals_per_minute: 100, recovery_window_cycles: 10, window_count: 2 }),
            clock("sooner", { signals_per_minute: 100.0004, recovery_window_cycles: 6, window_count: 9 }),
        ])).toBe("sooner");
        expect(selectedOf([
            clock("more-windows", { signals_per_minute: 100, recovery_window_cycles: 6, window_count: 9 }),
            clock("fewer-windows", { signals_per_minute: 100, recovery_window_cycles: 6, window_count: 2 }),
        ])).toBe("fewer-windows");
        expect(selectedOf([
            clock("first", { signals_per_minute: 100, recovery_window_cycles: 6, window_count: 2 }),
            clock("second", { signals_per_minute: 100, recovery_window_cycles: 6, window_count: 2 }),
        ])).toBe("first");
    });

    it("selects the fewest windows among clocks with the same wake-ups, and the first listed among equals", () => {
        expect(selectedOf([
            clock("first", { window_count: 12 }),
            clock("fewer-windows", { window_count: 9, wake_ups_per_minute: 100.0004 }),
            clock("same", { window_count: 9 }),
        ])).toBe("fewer-windows");
    });

    it("ranks a clock whose wake-ups were not counted after one whose were", () => {
        expect(selectedOf([
            clock("not-counted", { wake_ups_per_minute: null, window_count: 1 }),
            clock("counted", { wake_ups_per_minute: 500 }),
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
            clock("nearest", { meets_target_rate: false, rate_off_target: -5.69, window_count: 40 }),
            clock("between", { meets_target_rate: false, rate_off_target: -8.57, window_count: 60 }),
        ])).toBe("nearest");
    });

    // the metallurgic science sample: the full-hand subtick clock holds 45 a second and does not get back from a loss
    // of tungsten ore; the plain 1-swing clock at the same rate fails the long run, with fewer wake-ups
    it("selects, of two clocks equally near a target rate no clock meets, the one that holds its expected output", () => {
        expect(selectedOf([
            clock("drifts", { meets_target_rate: false, rate_off_target: 0, holds_expected_output: false, wake_ups_per_minute: 30 }),
            clock("holds", { meets_target_rate: false, rate_off_target: 0, wake_ups_per_minute: 80 }),
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
            clock("unstable-near", { meets_target_rate: false, rate_off_target: -0.18, holds_expected_output: false, wake_ups_per_minute: 49 }),
            clock("stable-far-over", { meets_target_rate: false, stable_above_target: true, rate_off_target: 4, wake_ups_per_minute: 100 }),
            clock("stable-over", { meets_target_rate: false, stable_above_target: true, rate_off_target: 1.87, wake_ups_per_minute: 420 }),
        ])).toBe("stable-over");
    });

    it("selects a clock that meets the target rate before one stable over it", () => {
        expect(selectedOf([
            clock("stable-over", { meets_target_rate: false, stable_above_target: true, rate_off_target: 0.5, wake_ups_per_minute: 1 }),
            clock("untried", { recovery_untried: true, wake_ups_per_minute: 900 }),
        ])).toBe("untried");
    });

    // the container wagons: even hands and the batched clock both at 0 wake-ups; even hands is back from a loss sooner
    it("selects, of clocks equal on wake-ups, the one that gets back from a loss in fewer periods, before the fewest windows", () => {
        expect(selectedOf([
            clock("slow", { wake_ups_per_minute: 0, recovery_window_cycles: 33, window_count: 2 }),
            clock("fast", { wake_ups_per_minute: 0, recovery_window_cycles: 3, window_count: 9 }),
        ])).toBe("fast");
        expect(selectedOf([
            clock("untried", { wake_ups_per_minute: 0, recovery_window_cycles: null, window_count: 2 }),
            clock("tried", { wake_ups_per_minute: 0, recovery_window_cycles: 40, window_count: 9 }),
        ])).toBe("tried");
        expect(selectedOf([
            clock("fewer-wake-ups", { wake_ups_per_minute: 10, recovery_window_cycles: 40 }),
            clock("sooner", { wake_ups_per_minute: 11, recovery_window_cycles: 1 }),
        ])).toBe("fewer-wake-ups");
    });

    it("does not look at how near a clock is to the target rate while one meets it", () => {
        expect(selectedOf([
            clock("meets", { wake_ups_per_minute: 500 }),
            clock("near", { meets_target_rate: false, rate_off_target: 0.01, wake_ups_per_minute: 0 }),
        ])).toBe("meets");
    });

    it("lists runs with the same windows once", () => {
        const runs: ClockAlternativeRun<Ranked>[] = [
            { signature: "a", alternatives: [clock("first")] },
            { signature: "a", alternatives: [clock("duplicate", { wake_ups_per_minute: 0 })] },
        ];
        const { alternatives, selected_index } = combineClockAlternativeRuns([...runs, null], it => it);
        expect(alternatives.map(it => it.id)).toEqual(["first"]);
        expect(selected_index).toBe(0);
    });
});

describe("the order of combineClockAlternativeRuns", () => {
    /** The ids from first to last in the order, each clock a run of its own, and the selected id */
    const ordered = (runs: (ClockAlternativeRun<Ranked> | null)[]) => {
        const { alternatives, selected_index, order } = combineClockAlternativeRuns(runs, it => it);
        return { ids: order.map(index => alternatives[index].id), selected: alternatives[selected_index]?.id };
    };
    const orderOf = (clocks: Ranked[]) => ordered(clocks.map(it => ({ signature: it.id, alternatives: [it] })));

    it.each<[string, Ranked[], string[]]>([
        ["by the tier first: exact and tried, rounded, recovery not tried, stable over the setpoint, the rest", [
            clock("rest", { meets_target_rate: false, rate_off_target: -0.001, wake_ups_per_minute: 0 }),
            clock("stable-over", { meets_target_rate: false, stable_above_target: true, rate_off_target: 2, wake_ups_per_minute: 1 }),
            clock("untried", { recovery_untried: true, wake_ups_per_minute: 2 }),
            clock("rounded", { runs_fast: 0.0002, wake_ups_per_minute: 3 }),
            clock("exact", { wake_ups_per_minute: 900 }),
        ], ["exact", "rounded", "untried", "stable-over", "rest"]],
        ["then the distance from the setpoint, to a thousandth, above as far as below", [
            clock("far", { meets_target_rate: false, rate_off_target: -3 }),
            clock("over", { meets_target_rate: false, rate_off_target: 2 }),
            clock("near", { meets_target_rate: false, rate_off_target: 0.4 }),
            clock("near-too", { meets_target_rate: false, rate_off_target: -0.4004 }),
        ], ["near", "near-too", "over", "far"]],
        ["then whether it holds its output", [
            clock("drifts", { meets_target_rate: false, holds_expected_output: false, wake_ups_per_minute: 1 }),
            clock("holds", { meets_target_rate: false, wake_ups_per_minute: 80 }),
        ], ["holds", "drifts"]],
        ["then the wakeups to a thousandth, a count before none", [
            clock("not-counted", { wake_ups_per_minute: null, window_count: 1 }),
            clock("more", { wake_ups_per_minute: 12 }),
            clock("fewer", { wake_ups_per_minute: 8, window_count: 30 }),
            clock("fewer-too", { wake_ups_per_minute: 8.0004, window_count: 20 }),
        ], ["fewer-too", "fewer", "more", "not-counted"]],
        ["then the signals a minute to a thousandth, a count before none", [
            clock("not-counted", { signals_per_minute: null, recovery_window_cycles: 1, window_count: 1 }),
            clock("more", { signals_per_minute: 138, recovery_window_cycles: 6 }),
            clock("fewer", { signals_per_minute: 100, recovery_window_cycles: 10, window_count: 30 }),
            clock("fewer-too", { signals_per_minute: 100.0004, recovery_window_cycles: 10, window_count: 20 }),
        ], ["fewer-too", "fewer", "more", "not-counted"]],
        ["then the window cycles to recover after a stop, a count before none", [
            clock("untimed", { wake_ups_per_minute: 0, recovery_window_cycles: null, window_count: 1 }),
            clock("slow", { wake_ups_per_minute: 0, recovery_window_cycles: 33, window_count: 2 }),
            clock("fast", { wake_ups_per_minute: 0, recovery_window_cycles: 3, window_count: 9 }),
        ], ["fast", "slow", "untimed"]],
        ["then the enable windows", [
            clock("more-windows", { window_count: 12 }),
            clock("fewer-windows", { window_count: 9 }),
        ], ["fewer-windows", "more-windows"]],
        ["and the made order where they tie on every key", [
            clock("first"), clock("second", { wake_ups_per_minute: 100.0004 }), clock("third"),
        ], ["first", "second", "third"]],
    ])("orders %s", (_, clocks, ids) => {
        const { ids: order, selected } = orderOf(clocks);
        expect(order).toEqual(ids);
        // the first in the order is the selected clock
        expect(selected).toBe(ids[0]);
    });

    it("orders every clock of the combined runs once, a run of shared windows and a deeper search's run among them", () => {
        const runs: (ClockAlternativeRun<Ranked> | null)[] = [
            { signature: "a", alternatives: [clock("a", { wake_ups_per_minute: 80 })], also: [{ signature: "a-shared", alternatives: [clock("a-shared", { wake_ups_per_minute: 60 })] }] },
            null,
            { signature: "a", alternatives: [clock("a-again", { wake_ups_per_minute: 0 })] },
            { signature: "b", alternatives: [clock("b", { wake_ups_per_minute: 50 }), clock("b-rounded", { runs_fast: 0.0002, wake_ups_per_minute: 1 })] },
        ];
        expect(ordered(runs)).toEqual({ ids: ["b", "a-shared", "a", "b-rounded"], selected: "b" });
        // a deeper search adds a run: the positions are of all the clocks together, not of each run
        const deeper = [...runs, { signature: "c", alternatives: [clock("c", { wake_ups_per_minute: 55 })] }];
        expect(ordered(deeper)).toEqual({ ids: ["b", "c", "a-shared", "a", "b-rounded"], selected: "b" });
    });

    it("is empty with no clock", () => {
        expect(combineClockAlternativeRuns<Ranked>([null], it => it)).toEqual({ alternatives: [], selected_index: 0, order: [] });
    });
});

// the car paste at 80.78/s: a clock whose losses could not be tried (its window cycle has no whole-tick repeat) was taken as
// stable and beat every clock that was tried (U11)
describe("a clock whose recovery could not be tried", () => {
    const untried = (id: string, ranking: Partial<ClockRanking> = {}) => clock(id, { recovery_untried: true, ...ranking });
    const no_recovery = (id: string, ranking: Partial<ClockRanking> = {}) => clock(id, { meets_target_rate: false, ...ranking });

    it("ranks below a clock tried and getting back, whatever their wake-ups", () => {
        expect(selectedOf([untried("untried", { wake_ups_per_minute: 1 }), clock("recovers", { wake_ups_per_minute: 900 })])).toBe("recovers");
        expect(selectedOf([clock("recovers", { wake_ups_per_minute: 900 }), untried("untried", { wake_ups_per_minute: 1 })])).toBe("recovers");
    });

    it("ranks above a clock tried and not getting back at the target rate, whatever their wake-ups", () => {
        expect(selectedOf([no_recovery("no-recovery", { wake_ups_per_minute: 1 }), untried("untried", { wake_ups_per_minute: 900 })])).toBe("untried");
        expect(selectedOf([untried("untried", { wake_ups_per_minute: 900 }), no_recovery("no-recovery", { wake_ups_per_minute: 1 })])).toBe("untried");
    });

    it("is ranked among clocks like it by their wake-ups", () => {
        expect(selectedOf([untried("more", { wake_ups_per_minute: 500 }), untried("fewer", { wake_ups_per_minute: 50 }),
            no_recovery("no-recovery", { wake_ups_per_minute: 0 })])).toBe("fewer");
    });

    it("leaves the searches to run: it is not a clock the selection can end on as stable", () => {
        expect(searchesAreNeeded([{ signature: "one", alternatives: [untried("untried")] }], it => it)).toBe(true);
        expect(searchesAreNeeded([{ signature: "one", alternatives: [untried("untried"), clock("recovers")] }], it => it)).toBe(false);
    });

    const config = { setpoint: { recipe: "iron-plate", items_per_second: 80 } } as Config;
    const assessment = (overrides: Partial<ClockAssessment>): ClockAssessment =>
        ({ holds: true, disturbance_trial: null, items_per_second: 80, wake_ups_per_minute: 200, start_dependence: null, ...overrides });
    const ranked = (overrides: Partial<ClockAssessment>, deadlock = false): ClockRanking => {
        const clock_assessment = assessment(overrides);
        return rankingOf({ assessment: clock_assessment, verdict: clockVerdictOf(clock_assessment), ranking_window_count: 4,
            deadlock_risks: deadlock ? [{}] : [] } as unknown as Omit<ClockAlternative, "ranking">, config);
    };
    const NOT_TRIED = "A clock of 47.537 ticks does not repeat in whole ticks, so its output cannot be counted by the period";

    it("is a clock that holds the target rate with no loss verdict and the reason the trials did not run", () => {
        expect(clockVerdictOf(assessment({ disturbance_trial_not_tried: NOT_TRIED }))).toBe("stable");
        expect(ranked({ disturbance_trial_not_tried: NOT_TRIED })).toMatchObject({ meets_target_rate: true, recovery_untried: true });
        expect(ranked({ disturbance_trial: { survives: true, broken_by: [], recovered_after_window_cycles: 3 } }))
            .toMatchObject({ meets_target_rate: true, recovery_untried: false });
        expect(ranked({ holds: false })).toMatchObject({ meets_target_rate: false, recovery_untried: false });
    });

    it("is not one off the target rate, which ranks by its rate, nor one on a build with a deadlock risk, where the trials do not decide", () => {
        expect(ranked({ disturbance_trial_not_tried: NOT_TRIED, items_per_second: 81.7 })).toMatchObject({ meets_target_rate: false, recovery_untried: false });
        expect(ranked({ disturbance_trial_not_tried: NOT_TRIED }, true)).toMatchObject({ meets_target_rate: true, recovery_untried: false });
    });

    it("is not stable above the target rate, which needs its recovery tried and passed, or on a build with a deadlock risk its output held", () => {
        const recovers = { survives: true, broken_by: [], recovered_after_window_cycles: 3 };
        expect(ranked({ disturbance_trial: recovers, items_per_second: 81.7 }).stable_above_target).toBe(true);
        expect(ranked({ disturbance_trial_not_tried: NOT_TRIED, items_per_second: 81.7 }).stable_above_target).toBeUndefined();
        expect(ranked({ disturbance_trial: { ...recovers, survives: false, broken_by: ["coal stops arriving"] }, items_per_second: 81.7 }).stable_above_target).toBeUndefined();
        expect(ranked({ holds: false, items_per_second: 81.7 }).stable_above_target).toBeUndefined();
        expect(ranked({ disturbance_trial_not_tried: NOT_TRIED, items_per_second: 81.7 }, true).stable_above_target).toBe(true);
    });
});

// an iron gear wheel build at 9.97 a second: the 2,888-tick clock of a 2,888.666-tick window cycle runs 0.02% fast, and held and recovered in the game (#332)
describe("a clock rounded down to whole ticks", () => {
    const rounded = (id: string, ranking: Partial<ClockRanking> = {}) => clock(id, { runs_fast: 0.0002, ...ranking });

    it("ranks below a clock that meets the target rate exactly, whatever their wake-ups", () => {
        expect(selectedOf([rounded("rounded", { wake_ups_per_minute: 1 }), clock("exact", { wake_ups_per_minute: 900 })])).toBe("exact");
    });

    it("ranks above a clock whose recovery could not be tried and one that does not meet the target rate", () => {
        expect(selectedOf([clock("untried", { recovery_untried: true, wake_ups_per_minute: 1 }), rounded("rounded", { wake_ups_per_minute: 900 })])).toBe("rounded");
        expect(selectedOf([clock("no-recovery", { meets_target_rate: false, wake_ups_per_minute: 0 }), rounded("rounded", { wake_ups_per_minute: 900 })])).toBe("rounded");
    });

    it("leaves the searches to run for a clock of exactly the target rate", () => {
        expect(searchesAreNeeded([{ signature: "one", alternatives: [rounded("rounded")] }], it => it)).toBe(true);
    });

    const config = { setpoint: { recipe: "iron-gear-wheel", items_per_second: 9.97 } } as Config;
    const ranked = (items_per_second: number, rounded_clock: Partial<RoundedClock> | undefined) => {
        const assessment: ClockAssessment = { holds: true, items_per_second, wake_ups_per_minute: 13.4, start_dependence: null,
            disturbance_trial: { survives: true, broken_by: [], recovered_after_window_cycles: 2 } };
        return rankingOf({ assessment, verdict: clockVerdictOf(assessment), ranking_window_count: 4, deadlock_risks: [],
            ...(rounded_clock && { rounded: { window_cycle_ticks: 2888, runs_fast: items_per_second / 9.97 - 1, within_machines: true, tried_on_its_window_cycle: true, ...rounded_clock } }),
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
        expect(ranked(fast, { tried_on_its_window_cycle: false })).toMatchObject({ meets_target_rate: false });
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

    it("is not, once a clock made without a search meets the target rate", () => {
        expect(needed([clock("unstable", { meets_target_rate: false }), null, clock("stable", { wake_ups_per_minute: 900 })])).toBe(false);
    });

    it("is, when no clock made without a search meets the target rate", () => {
        expect(needed([clock("unstable", { meets_target_rate: false }), clock("no-recovery", { meets_target_rate: false })])).toBe(true);
    });


    it("is, when every clock made without a search failed", () => {
        expect(needed([null, null])).toBe(true);
    });

    // the subtick clock of a window cycle of part ticks and the same clock rounded come from one run
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
    const toRun = (clocks: Ranked[], window_cycle_ticks: number) =>
        searchesToRun(clocks.map(it => ({ signature: it.id, alternatives: [it] })), it => it, SEARCHES, window_cycle_ticks).map(it => it.id);

    it("runs every search where no clock made without one can be selected as stable", () => {
        expect(toRun([clock("unstable", { meets_target_rate: false })], 5000)).toEqual(["derived", "uneven-output", "shifted-swings", "full-hand"]);
    });

    it("runs the two that can improve on a stable clock with wake-ups, on a period of at most 480 ticks", () => {
        expect(toRun([clock("stable", { wake_ups_per_minute: 197.5 })], 144)).toEqual(["derived", "shifted-swings"]);
        expect(toRun([clock("stable", { wake_ups_per_minute: 197.5 })], 480)).toEqual(["derived", "shifted-swings"]);
    });

    it("runs none past a stable clock of no wake-ups, or on a longer period", () => {
        expect(toRun([clock("stable", { wake_ups_per_minute: 0 })], 144)).toEqual([]);
        expect(toRun([clock("stable", { wake_ups_per_minute: 0.0004 })], 144)).toEqual([]);
        expect(toRun([clock("stable", { wake_ups_per_minute: 197.5 })], 481)).toEqual([]);
    });

    it("judges the clock the selection ends on so far, not another stable one", () => {
        expect(toRun([clock("more", { wake_ups_per_minute: 30 }), clock("none", { wake_ups_per_minute: 0 })], 144)).toEqual([]);
    });
});

describe("noSearchCanBeat", () => {
    it("holds for a cost of no wakeups, also one that rounds to none at a thousandth", () => {
        expect(noSearchCanBeat({ wake_ups_per_minute: 0 })).toBe(true);
        expect(noSearchCanBeat({ wake_ups_per_minute: 0.0004 })).toBe(true);
    });

    it("does not hold for any cost a thousandth or more, nor for a cost not counted", () => {
        expect(noSearchCanBeat({ wake_ups_per_minute: 0.001 })).toBe(false);
        expect(noSearchCanBeat({ wake_ups_per_minute: 197.5 })).toBe(false);
        expect(noSearchCanBeat({ wake_ups_per_minute: null })).toBe(false);
    });

    // the rule reads wakeups alone: the windows and the window cycles to get back from a loss of the selected clock do not enter
    it("is the condition that ends the searches, whatever the other keys of the selected clock", () => {
        const SEARCHES = [{ id: "derived" }, { id: "shifted-swings" }];
        const toRun = (selected: Ranked) => searchesToRun([{ signature: selected.id, alternatives: [selected] }], it => it, SEARCHES, 144).map(it => it.id);
        expect(toRun(clock("none", { wake_ups_per_minute: 0, window_count: 40 }))).toEqual([]);
        expect(toRun(clock("some", { wake_ups_per_minute: 0.001, window_count: 1 }))).toEqual(["derived", "shifted-swings"]);
    });
});
