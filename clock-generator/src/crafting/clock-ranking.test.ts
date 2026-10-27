import { describe, it, expect } from "vitest";
import { combineClockAlternativeRuns, rankingOf, searchesAreNeeded, type ClockAlternative, type ClockAlternativeRun, type ClockRanking } from "./generate-blueprint";
import { clockVerdictOf, windowsRoundedTo, type ClockAssessment } from "./trial";
import type { RoundedClock } from "./rank";
import type { Config } from "../config";

type Ranked = ClockRanking & { id: string };

const clock = (id: string, ranking: Partial<ClockRanking> = {}): Ranked => ({
    id,
    meets_target_rate: true,
    rate_off_target: 0,
    holds_expected_output: true,
    matches_belt_choice: true,
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

    it("selects a clock that keeps belt pickup slack over one with fewer wake-ups that leaves it out", () => {
        expect(selectedOf([
            clock("slack", { wake_ups_per_minute: 80 }),
            clock("no-slack", { wake_ups_per_minute: 30, matches_belt_choice: false }),
        ])).toBe("slack");
    });

    it("selects a clock without belt pickup slack when no clock with it meets the target rate", () => {
        expect(selectedOf([
            clock("slack", { meets_target_rate: false }),
            clock("no-slack", { matches_belt_choice: false }),
        ])).toBe("no-slack");
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
            clock("nearest", { meets_target_rate: false, rate_off_target: -5.69, window_count: 40, matches_belt_choice: false }),
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

// the car paste at 80.78/s: a clock whose losses could not be tried (its period has no whole-tick repeat) was taken as
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

    const config = { target_output: { recipe: "iron-plate", items_per_second: 80 } } as Config;
    const assessment = (overrides: Partial<ClockAssessment>): ClockAssessment =>
        ({ holds: true, backpressure_loss: null, items_per_second: 80, wake_ups_per_minute: 200, start_dependence: null, ...overrides });
    const ranked = (overrides: Partial<ClockAssessment>, deadlock = false): ClockRanking => {
        const clock_assessment = assessment(overrides);
        return rankingOf({ assessment: clock_assessment, verdict: clockVerdictOf(clock_assessment), ranking_window_count: 4,
            deadlock_risks: deadlock ? [{}] : [], result: { belt_pickup_slack_left_out: false } } as unknown as Omit<ClockAlternative, "ranking">, config);
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
});

// Atlan cell 29: the 2,888-tick clock of a 2,888.666-tick period runs 0.02% fast, and held and recovered in the game (#332)
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

    const config = { target_output: { recipe: "iron-gear-wheel", items_per_second: 9.97 } } as Config;
    const ranked = (items_per_second: number, rounded_clock: Partial<RoundedClock> | undefined) => {
        const assessment: ClockAssessment = { holds: true, items_per_second, wake_ups_per_minute: 13.4, start_dependence: null,
            backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 2 } };
        return rankingOf({ assessment, verdict: clockVerdictOf(assessment), ranking_window_count: 4, deadlock_risks: [],
            result: { belt_pickup_slack_left_out: false },
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

    it("runs on its windows rounded as its blueprint counts them", () => {
        expect(windowsRoundedTo({ "inserter:1": [{ start: 0, end: 30 }, { start: 2870, end: 2888 }, { start: 2888, end: 2888 }] }, 2888))
            .toEqual({ "inserter:1": [{ start: 0, end: 30 }, { start: 2870, end: 2887 }] });
    });
});

describe("searchesAreNeeded", () => {
    const needed = (clocks: (Ranked | null)[]): boolean =>
        searchesAreNeeded(clocks.map(it => it && { signature: it.id, alternatives: [it] }), it => it);

    it("is not, once a clock made without a search meets the target rate for the belt asked", () => {
        expect(needed([clock("unstable", { meets_target_rate: false }), null, clock("stable", { wake_ups_per_minute: 900 })])).toBe(false);
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
