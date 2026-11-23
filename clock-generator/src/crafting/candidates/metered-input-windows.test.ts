import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { quiet } from "../generate-blueprint-test-helpers";
import { unclockedRun, type UnclockedRun } from "../plan/unclocked-run";
import type { AsBuiltRun } from "../trial";
import { outputServiceWindow } from "./metered-output-windows";
import {
    chooseInputWindows, inputServiceWindows, meteredInputWindows, pickClusters, type InputJointStage, type InputWindowJudge, type InputWindowProposal,
} from "./metered-input-windows";

describe("the windows of a belt-fed input from its picks", () => {
    // a legendary stack inserter: rotation 3 ticks, so the next pickup test 8 ticks after a full pickup
    const RETURN = 8;
    const picks = (...runs: [number, number, number][]) => new Map(runs.flatMap(([from, to, items]) =>
        Array.from({ length: to - from + 1 }, (_, i) => [from + i, items] as [number, number])));

    it("splits the picks into clusters where they lie further apart than the arm's return, across the wrap of the interval", () => {
        expect(pickClusters([42, 43, 44, 45, 53, 54, 55, 56, 13, 14, 15, 16], 108, RETURN)).toEqual([[13, 14, 15, 16], [42, 43, 44, 45, 53, 54, 55, 56]]);
        expect(pickClusters([104, 105, 106, 107, 0, 1, 50], 108, RETURN)).toEqual([[104, 105, 106, 107, 0, 1], [50]]);
        // one tick more than the return apart: two clusters
        expect(pickClusters([10, 19], 108, RETURN)).toEqual([[10], [19]]);
        expect(pickClusters([10, 18], 108, RETURN)).toEqual([[10, 18]]);
    });

    it("counts the items of both lanes of the belt in one cluster", () => {
        // a hand of processing units at 10-13 and one of flying robot frames at 21-24, one return apart
        const both = picks([10, 13, 4], [21, 24, 4]);
        expect(inputServiceWindows(both, new Set([13, 24]), 108, 216, RETURN, "main_cluster"))
            .toEqual([{ start: 9, end: 26 }, { start: 117, end: 134 }]);
    });

    it("keeps each form: the main cluster, each cluster, all clusters", () => {
        const observed = picks([13, 16, 4], [42, 45, 4], [53, 56, 4]);
        const full = new Set([16, 45, 56]);
        expect(inputServiceWindows(observed, full, 108, 324, RETURN, "main_cluster"))
            .toEqual([{ start: 41, end: 58 }, { start: 149, end: 166 }, { start: 257, end: 274 }]);
        expect(inputServiceWindows(observed, full, 108, 216, RETURN, "each_cluster"))
            .toEqual([{ start: 12, end: 18 }, { start: 41, end: 58 }, { start: 120, end: 126 }, { start: 149, end: 166 }]);
        expect(inputServiceWindows(observed, full, 108, 216, RETURN, "all_clusters")).toEqual([{ start: 12, end: 58 }, { start: 120, end: 166 }]);
    });

    it("pads as the output step pads, and wraps a window across the interval", () => {
        const observed = picks([42, 45, 4], [53, 56, 4]);
        const full = new Set([45, 56]);
        expect(inputServiceWindows(observed, full, 108, 324, RETURN, "main_cluster")).toEqual(outputServiceWindow(new Set(observed.keys()), full, 108, 324));
        // a cluster over the wrap: one window that ends in the next interval
        expect(inputServiceWindows(picks([105, 107, 4], [0, 0, 4]), new Set([0]), 108, 216, RETURN, "main_cluster"))
            .toEqual([{ start: 0, end: 2 }, { start: 104, end: 107 }, { start: 108, end: 110 }, { start: 212, end: 215 }]);
        // the main cluster is the one with the most items; of equal ones, the first in the interval
        expect(inputServiceWindows(picks([10, 10, 16], [60, 60, 16]), new Set([10, 60]), 108, 108, RETURN, "main_cluster")).toEqual([{ start: 9, end: 12 }]);
        expect(inputServiceWindows(picks([10, 10, 8], [60, 61, 8]), new Set([61]), 108, 108, RETURN, "main_cluster")).toEqual([{ start: 59, end: 63 }]);
    });

    it("gives no window where the padded picks leave no tick of the interval closed", () => {
        const every = picks([0, 107, 1]);
        expect(inputServiceWindows(every, new Set([7]), 108, 108, RETURN, "all_clusters")).toBeNull();
        expect(inputServiceWindows(new Map(), new Set(), 108, 108, RETURN, "main_cluster")).toBeNull();
    });
});

describe("the belt-fed inputs the step proposes windows for, and those it retains", () => {
    let plan: UnclockedRun;
    let always: UnclockedRun;
    beforeAll(async () => {
        const config = await loadConfigFromFile(path.join(__dirname, "..", "fixtures", "utility-science-320-metered-takers.json"));
        const overrides = { terminal_swing_count: 6, lcm: 1, derive_clock_windows: false };
        plan = unclockedRun({ ...config, overrides }, { logger: quiet });
        always = unclockedRun({ ...config, overrides, inserters: config.inserters.map(arm => arm.id === 12
            ? { ...arm, overrides: { ...arm.overrides, enable_control: { mode: "ALWAYS" } } } : arm) }, { logger: quiet });
    });

    // the second foundry's taker into assembler 6, in turns 108 apart; input 12 from the belt into the same assembler
    const takers = new Set(["inserter:14"]);
    const turns = [18, 126, 234].map(start => ({ start, end: start + 1 }));
    const whole = [{ start: 0, end: 323 }];
    // three hands of 16 a window cycle, each picked in four ticks and put in four ticks later, every 108 ticks
    const hands = (count = 3) => Array.from({ length: 324 }, (_, tick) => {
        const at = tick % 108, k = Math.floor(tick / 108);
        if (k >= count) return 0;
        return at >= 43 && at <= 46 ? 4 * (at - 42) : at > 46 && at < 50 ? 16 : 0;
    });
    const runOf = (held: number[], check: Partial<AsBuiltRun["check"]> = {}) => ({
        stock: { inserters: [{ inserter_id: "inserter:12", held }] },
        check: { holds: true, actual_output_items: 576, start_phases_checked: 1, long_run_proven: true, first_judged_tick: 0,
            clock_tick_at_first_judged: 0, long_run_cycle_window_cycles: 1, ...check },
    }) as unknown as Pick<AsBuiltRun, "stock" | "check">;

    it("proposes one window each service interval from the observed picks", () => {
        const { proposals, decisions, witnesses } = meteredInputWindows(plan, { "inserter:12": whole, "inserter:14": turns }, takers, runOf(hands()));
        expect(decisions["inserter:12"]).toBeUndefined();
        expect(witnesses).toEqual({ "inserter:12": { service_ticks: 108, observed_ticks: 324, items_taken: 48 } });
        // the picks at the raw command's positions 42 to 45 (one update and the circuit latency before the sample)
        expect(proposals).toEqual([{ form: "main_cluster", changes: { "inserter:12": [{ start: 41, end: 47 }, { start: 149, end: 155 }, { start: 257, end: 263 }] } }]);
    });

    it("retains an input the config always enables", () => {
        const { proposals, decisions } = meteredInputWindows(always, { "inserter:12": whole, "inserter:14": turns }, takers, runOf(hands()));
        expect(proposals).toEqual([]);
        expect(decisions["inserter:12"]).toEqual({ kind: "retained", reason: "always_enabled" });
    });

    it("retains an input whose machine no metered taker feeds, or two do", () => {
        const none = meteredInputWindows(plan, { "inserter:12": whole }, new Set(["inserter:16"]), runOf(hands()));
        expect(none.decisions["inserter:12"]).toEqual({ kind: "retained", reason: "no_single_metered_taker" });
        const two = meteredInputWindows(plan, { "inserter:12": whole, "inserter:14": turns }, new Set(["inserter:14", "inserter:12"]), runOf(hands()));
        expect(two.decisions["inserter:12"]).toEqual({ kind: "retained", reason: "no_single_metered_taker" });
        expect([none.proposals, two.proposals]).toEqual([[], []]);
    });

    it("keeps an input that has windows already", () => {
        const { proposals, decisions } = meteredInputWindows(plan, { "inserter:12": [{ start: 14, end: 41 }], "inserter:14": turns }, takers, runOf(hands()));
        expect(proposals).toEqual([]);
        expect(decisions["inserter:12"]).toEqual({ kind: "already_bounded" });
    });

    it("retains an input without a proven long run to read", () => {
        const { proposals, decisions } = meteredInputWindows(plan, { "inserter:12": whole, "inserter:14": turns }, takers, runOf(hands(), { long_run_proven: false }));
        expect(proposals).toEqual([]);
        expect(decisions["inserter:12"]).toEqual({ kind: "retained", reason: "no_stock_witness" });
    });

    it("retains an input whose picks are not the hands the plan gives it", () => {
        const { proposals, decisions } = meteredInputWindows(plan, { "inserter:12": whole, "inserter:14": turns }, takers, runOf(hands(2)));
        expect(proposals).toEqual([]);
        expect(decisions["inserter:12"]).toEqual({ kind: "retained", reason: "service_not_balanced" });
    });
});

describe("the choice of a proposal", () => {
    const first: InputWindowProposal = { form: "main_cluster", changes: { "inserter:12": [{ start: 41, end: 58 }] } };
    const second: InputWindowProposal = { form: "each_cluster", changes: { "inserter:12": [{ start: 12, end: 18 }, { start: 41, end: 58 }] } };
    const witnesses = { "inserter:12": { service_ticks: 108, observed_ticks: 5184, items_taken: 768 } };
    type Seen = { holds?: boolean; wake_ups?: number | null; stage?: InputJointStage | null; whole?: InputJointStage | null; one_copy?: number | null; copies?: number | null };
    /** A judge over the clock as it is (no changes) and the proposals, by their form */
    function judge(current: Seen, of: Partial<Record<string, Seen>>): InputWindowJudge & { asked: string[] } {
        const asked: string[] = [];
        const seen = (changes: object): Seen => {
            if (Object.keys(changes).length === 0) return current;
            const proposal = [first, second].find(it => it.changes === changes)!;
            return of[proposal.form]!;
        };
        const name = (changes: object) => Object.keys(changes).length === 0 ? "current" : [first, second].find(it => it.changes === changes)!.form;
        return {
            asked,
            longRun: changes => { asked.push(`long run ${name(changes)}`); const it = seen(changes); return { holds: it.holds ?? true, wake_ups: it.wake_ups ?? null, stage: it.stage ?? null }; },
            wholeCheck: changes => { asked.push(`whole ${name(changes)}`); return seen(changes).whole ?? null; },
            recovery: changes => { const it = seen(changes); return { one_copy: it.one_copy === undefined ? 20 : it.one_copy, copies: it.copies === undefined ? 23 : it.copies }; },
        };
    }
    const now: Seen = { wake_ups: 1620.45, one_copy: 20, copies: 23 };

    it("codes a proposal that does not hold to the long run, never judging it further", () => {
        const j = judge(now, { main_cluster: { holds: false, stage: "first_window_cycle" } });
        const { taken, decisions } = chooseInputWindows([first], witnesses, j);
        expect(taken).toBeNull();
        expect(decisions).toEqual({ "inserter:12": { kind: "retained", reason: "joint_check_failed", stage: "first_window_cycle" } });
        expect(j.asked).not.toContain("whole main_cluster");
    });

    it("refuses equal or more wake-ups, to a thousandth", () => {
        for (const wake_ups of [1620.4504, 1620.45, 1700]) {
            const j = judge(now, { main_cluster: { wake_ups } });
            expect(chooseInputWindows([first], witnesses, j)).toEqual({ taken: null, decisions: { "inserter:12": { kind: "retained", reason: "no_fewer_wake_ups" } } });
            expect(j.asked).not.toContain("whole main_cluster");
        }
    });

    it("codes a proposal whose whole check fails at the stage that fails", () => {
        const j = judge(now, { main_cluster: { wake_ups: 964.77, whole: "pickup_phase" } });
        expect(chooseInputWindows([first], witnesses, j).decisions).toEqual({ "inserter:12": { kind: "retained", reason: "joint_check_failed", stage: "pickup_phase" } });
        const copies = judge(now, { main_cluster: { wake_ups: 964.77, whole: "copies" } });
        expect(chooseInputWindows([first], witnesses, copies).decisions["inserter:12"]).toEqual({ kind: "retained", reason: "joint_check_failed", stage: "copies" });
    });

    it("refuses a slower recovery on one copy or on the copies", () => {
        for (const worse of [{ one_copy: 21 }, { copies: 24 }]) {
            const j = judge(now, { main_cluster: { wake_ups: 964.77, ...worse } });
            expect(chooseInputWindows([first], witnesses, j)).toEqual({ taken: null, decisions: { "inserter:12": { kind: "retained", reason: "recovery_worse" } } });
        }
        // as fast, or faster, passes
        expect(chooseInputWindows([first], witnesses, judge(now, { main_cluster: { wake_ups: 964.77, one_copy: 19, copies: 23 } })).taken).toBe(first);
    });

    it("reads a recovery that is not counted: on both sides it passes, on the proposal only it is worse, on the clock only it passes", () => {
        const choose = (mine: Seen, theirs: Seen) => chooseInputWindows([first], witnesses, judge({ ...now, ...theirs }, { main_cluster: { wake_ups: 964.77, ...mine } }));
        expect(choose({ one_copy: null }, { one_copy: null }).taken).toBe(first);
        expect(choose({ copies: null }, { copies: null }).taken).toBe(first);
        expect(choose({ one_copy: null }, {}).decisions["inserter:12"]).toEqual({ kind: "retained", reason: "recovery_worse" });
        expect(choose({ copies: null }, {}).decisions["inserter:12"]).toEqual({ kind: "retained", reason: "recovery_worse" });
        expect(choose({ one_copy: 40 }, { one_copy: null }).taken).toBe(first);
        expect(choose({ copies: 40 }, { copies: null }).taken).toBe(first);
    });

    it("gives an input refused in several forms the code of its proposal of the lowest cost", () => {
        // the each-cluster form is cheaper and fails its whole check; the main-cluster form has more wake-ups than the clock
        const j = judge(now, { main_cluster: { wake_ups: 1700 }, each_cluster: { wake_ups: 1000, whole: "margin" } });
        expect(chooseInputWindows([first, second], witnesses, j).decisions["inserter:12"]).toEqual({ kind: "retained", reason: "joint_check_failed", stage: "margin" });
        // one that does not hold to the long run costs the most
        const k = judge(now, { main_cluster: { holds: false, stage: "long_run" }, each_cluster: { wake_ups: 1700 } });
        expect(chooseInputWindows([first, second], witnesses, k).decisions["inserter:12"]).toEqual({ kind: "retained", reason: "no_fewer_wake_ups" });
    });

    it("takes the passing proposal of the lowest cost, of equal costs the earlier form, and judges no other", () => {
        const j = judge(now, { main_cluster: { wake_ups: 964.77 }, each_cluster: { wake_ups: 950 } });
        const { taken, decisions } = chooseInputWindows([first, second], witnesses, j);
        expect(taken).toBe(second);
        expect(decisions).toEqual({ "inserter:12": { kind: "bounded", form: "each_cluster", service_ticks: 108, observed_ticks: 5184, items_taken: 768 } });
        expect(j.asked.filter(it => it.startsWith("whole"))).toEqual(["whole each_cluster"]);
        const tie = judge(now, { main_cluster: { wake_ups: 964.77 }, each_cluster: { wake_ups: 964.7704 } });
        expect(chooseInputWindows([first, second], witnesses, tie).taken).toBe(first);
        // the cheaper one fails its whole check: the next is taken
        const next = judge(now, { main_cluster: { wake_ups: 964.77 }, each_cluster: { wake_ups: 950, whole: "loss" } });
        expect(chooseInputWindows([first, second], witnesses, next).taken).toBe(first);
    });
});
