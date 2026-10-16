import { describe, expect, it } from "vitest";
import { removedBetween, RULE_CALL_CAVEATS, RULE_THRESHOLDS, ruleCallOf } from "./rule-call";
import { RuleCountGroup, RuleCountRun } from "./rule-count";

/** A group of a run, with the figures removedBetween reads */
function group(key: string, inserters: number, wired: number, wake_ups: number, true_wake_ups: number = wake_ups): RuleCountGroup {
    const [role, items, recipes] = key.split(" | ");
    return {
        key, role, items, recipes, inserters, wired, source_wake_ups: wake_ups, sink_wake_ups: 0, pickups: 0, wake_ups,
        wake_ups_per_minute: 0, true_sink_wake_ups: 0, true_pickups: 0, true_wake_ups, true_wake_ups_per_minute: 0, true_start_standing: null,
    };
}

function run(minutes: number, groups: RuleCountGroup[]): RuleCountRun {
    return { ticks: minutes * 3600, minutes, inserters: [], groups, start_rule_fallback: [], true_start_unknown: [] };
}

describe("ruleCallOf, on the series' original count", () => {
    it("leaves unwired, firmly, below 63.5", () => {
        expect(ruleCallOf(63.4999, "original")).toMatchObject({ call: "leave unwired", firm: true, region: "below 63.5" });
        expect(ruleCallOf(-5, "original")).toMatchObject({ call: "leave unwired", firm: true, region: "below 63.5" });
    });

    it("leaves unwired, marginally, from 63.5 up to but not including 158.6", () => {
        expect(ruleCallOf(63.5, "original")).toMatchObject({ call: "leave unwired", firm: false, region: "63.5 to 158.6" });
        expect(ruleCallOf(158.5999, "original")).toMatchObject({ call: "leave unwired", firm: false, region: "63.5 to 158.6" });
    });

    it("clocks, marginally, from 158.6 up to and including 207.6", () => {
        expect(ruleCallOf(158.6, "original")).toMatchObject({ call: "clock", firm: false, region: "158.6 to 207.6" });
        expect(ruleCallOf(207.6, "original")).toMatchObject({ call: "clock", firm: false, region: "158.6 to 207.6" });
    });

    it("clocks, firmly, above 207.6", () => {
        expect(ruleCallOf(207.6001, "original")).toMatchObject({ call: "clock", firm: true, region: "above 207.6" });
    });

    it("compares the unrounded figure, and the caveats say what the call covers", () => {
        expect(RULE_CALL_CAVEATS.join(" ")).toMatch(/91,000 to 606,000 entities/);
        expect(RULE_CALL_CAVEATS.join(" ")).toMatch(/update time only/);
        // 63.5 rounds up from 63.49; the call is made on 63.49
        expect(ruleCallOf(63.49, "original").region).toBe("below 63.5");
    });
});

describe("ruleCallOf, in true starts (the call)", () => {
    it("is the default count, with the recount's thresholds", () => {
        expect(RULE_THRESHOLDS["true starts"]).toMatchObject({ unwired_firm: 53.0, clock_lower: 158.6, clock_firm: 175.7 });
        expect(ruleCallOf(100).count).toBe("true starts");
    });

    it("leaves unwired below 158.6, firmly below 53.0, and clocks from 158.6, firmly above 175.7", () => {
        expect(ruleCallOf(52.9999)).toMatchObject({ call: "leave unwired", firm: true, region: "below 53.0" });
        expect(ruleCallOf(53)).toMatchObject({ call: "leave unwired", firm: false, region: "53.0 to 158.6" });
        expect(ruleCallOf(158.5999)).toMatchObject({ call: "leave unwired", firm: false, region: "53.0 to 158.6" });
        expect(ruleCallOf(158.6)).toMatchObject({ call: "clock", firm: false, region: "158.6 to 175.7" });
        expect(ruleCallOf(175.7)).toMatchObject({ call: "clock", firm: false, region: "158.6 to 175.7" });
        expect(ruleCallOf(175.7001)).toMatchObject({ call: "clock", firm: true, region: "above 175.7" });
    });

    it("says why the call is in true starts, and that its thresholds are still a prediction", () => {
        const text = RULE_CALL_CAVEATS.join(" ");
        expect(text).toMatch(/D7 a1: confirmed on two designs/);
        expect(text).toMatch(/51.28 leave unwired, 170.17 a marginal clock/);
        expect(text).toMatch(/prediction/);
    });
});

describe("removedBetween", () => {
    const A = "belt to machine | gear |  > gear";
    const B = "machine to belt | gear | gear > ";
    const C = "chest to machine | iron |  > gear";

    it("gives w removed for each inserter of a newly wired group, over each run's own minutes", () => {
        // A: 4 inserters, 2 minutes, 800 wake-ups unwired = 100 a minute each; clocked 2 wired, 3 minutes, 90 wake-ups = 10 each
        const unwired = run(2, [group(A, 4, 0, 800)]);
        const clocked = run(3, [group(A, 4, 2, 120)]);
        const removed = removedBetween(unwired, clocked, "original");
        expect(removed.groups).toHaveLength(1);
        expect(removed.groups[0]).toMatchObject({
            status: "newly wired", newly_wired: true, w_unwired: 100, w_clocked: 10, w_removed: 90, inserters_unwired: 4, inserters_clocked: 4,
        });
        expect(removed.groups[0].call).toMatchObject({ call: "leave unwired", firm: false, region: "63.5 to 158.6" });
        expect(removed.newly_wired_inserters).toBe(2);
    });

    it("pools every group's removal over the inserters newly wired, a group not wired included", () => {
        // A wired in the clocked run (2 inserters); B not wired but its wake-ups fall too; C only in the unwired run
        const unwired = run(2, [group(A, 2, 0, 600), group(B, 2, 0, 200), group(C, 1, 0, 100)]);
        const clocked = run(1, [group(A, 2, 2, 20), group(B, 2, 0, 40)]);
        const removed = removedBetween(unwired, clocked, "original");
        // A: 600/2 - 20/1 = 280; B: 200/2 - 40/1 = 60; C: 100/2 - 0 = 50; total 390 over 2 newly wired
        expect(removed.removed_per_minute).toBe(390);
        expect(removed.w_removed_pooled).toBe(195);
        expect(removed.call).toMatchObject({ call: "clock", firm: false, region: "158.6 to 207.6", w: 195 });
        expect(removed.caveats).toBe(RULE_CALL_CAVEATS);
    });

    it("reports a group the clock does not newly wire as not wired, with its unwired w and no call", () => {
        const unwired = run(2, [group(A, 2, 0, 600), group(B, 2, 0, 200)]);
        const clocked = run(2, [group(A, 2, 2, 20), group(B, 2, 0, 200)]);
        const not_wired = removedBetween(unwired, clocked, "original").groups.find(it => it.key === B)!;
        expect(not_wired).toMatchObject({ status: "not wired", newly_wired: false, w_unwired: 50, w_removed: null, call: null });
    });

    it("takes a group absent from one run as 0 on that side", () => {
        const unwired = run(1, [group(C, 1, 0, 100)]);
        const clocked = run(1, [group(A, 2, 2, 40)]);
        const removed = removedBetween(unwired, clocked, "original");
        const c = removed.groups.find(it => it.key === C)!;
        const a = removed.groups.find(it => it.key === A)!;
        expect(c).toMatchObject({ status: "not wired", w_unwired: 100, w_clocked: 0, w_removed: null });
        // a newly wired group absent from the unwired run: 0 - 20
        expect(a).toMatchObject({ status: "newly wired", w_unwired: 0, w_clocked: 20, w_removed: -20 });
        expect(removed.removed_per_minute).toBe(100 - 40);
    });

    it("has no pooled figure and no call when the clock wires nothing", () => {
        const removed = removedBetween(run(1, [group(A, 2, 0, 10)]), run(1, [group(A, 2, 0, 10)]), "original");
        expect(removed.w_removed_pooled).toBeNull();
        expect(removed.call).toBeNull();
    });
});

describe("removedBetween, in true starts", () => {
    it("removes the true-start wake-ups by default and the original ones when asked", () => {
        const A = "machine to machine | plastic | plastic > lds";
        const unwired = run(1, [group(A, 2, 0, 2400, 1000)]);
        const clocked = run(1, [group(A, 2, 2, 200, 100)]);
        expect(removedBetween(unwired, clocked)).toMatchObject({ count: "true starts", w_removed_pooled: 450 });
        expect(removedBetween(unwired, clocked).call).toMatchObject({ call: "clock", firm: true, region: "above 175.7" });
        expect(removedBetween(unwired, clocked, "original")).toMatchObject({ count: "original", w_removed_pooled: 1100 });
    });
});
