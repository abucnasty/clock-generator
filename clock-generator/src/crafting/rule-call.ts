import { RuleCountGroup, RuleCountRun } from "./rule-count";
import { TrueStartStanding, worseStanding } from "./true-start-standing";

/**
 * The clock-or-unwired call of the inserter cost series, from how many wake-ups a clock removes from an inserter.
 *
 * This is advice about update time only. There are two counts of w and a set of thresholds for each, all in this one
 * place: change them here and nowhere else.
 * - "true starts", the call: version A of the series' productivity recount. An input's sink half counts the crafts its
 *   machine truly starts, since a productivity payout wakes no input (docs/mechanics, D7 a1).
 * - "original", the series' original count (CLOSING-2), kept beside it for comparison: its sink half infers a start
 *   from products_finished, which counts payouts.
 * Both are compared on the unrounded w, against the figures as their pages write them.
 */

/** Which count of w a call is made on */
export type RuleCount = "true starts" | "original";

export interface RuleThresholds {
    /** Below this, leave unwired, outside the band */
    unwired_firm: number;
    /** From `unwired_firm` up to this (exclusive), leave unwired, marginally; from this, clock */
    clock_lower: number;
    /** Up to and including this, clock marginally; above it, clock outside the band */
    clock_firm: number;
    /** The page the figures are from, and its sha256 */
    page: string;
    sha256: string;
}

export const RULE_THRESHOLDS: Readonly<Record<RuleCount, RuleThresholds>> = {
    // section 6, version A ("True A"), revised after audit and re-audit 1 on 2026-10-15
    "true starts": {
        unwired_firm: 53.0,
        clock_lower: 158.6,
        clock_firm: 175.7,
        page: "factorio-benchmarks benchmarks/2026-10-12-inserter-cost-2.1.21/closing/evidence/productivity-recount-1.md",
        sha256: "153fa62a39fa086136a738cb033cfbc326fdb3bc17921f441283ee29146ae003",
    },
    "original": {
        unwired_firm: 63.5,
        clock_lower: 158.6,
        clock_firm: 207.6,
        page: "factorio-benchmarks benchmarks/2026-10-12-inserter-cost-2.1.21/closing/CLOSING-2-RESULT.md",
        sha256: "39a567ad8bef3f0415743e3ae54a0da3d3251c226d6d331a2a0f91d8fcc36ede",
    },
};

/** What the call covers and what it is not, which every result carries */
export const RULE_CALL_CAVEATS = [
    "The rule was measured on saves of 91,000 to 606,000 entities. Below that size it is not known, and the generator does not know the size of the save the build goes into.",
    "It is advice about update time only. It is never a reason to drop a clock a build needs for stable output.",
    "The call is made in true starts because of the mechanism, not a better fit: a productivity payout does not wake an input waiting for space (docs/mechanics, D7 a1: measured on one build, at +175%; a check on a second design of the same machine type is running). In true starts the band is 3.31 times wide against 3.27 in the original count, and the two held-out measurements keep their verdicts (51.28 leave unwired, 170.17 a marginal clock, both right). The thresholds in true starts were set afterwards on the same timed groups, so they are a prediction still to be judged on fresh saves.",
    "A firm call is one outside the band, not a certain one. Outside the band the call was right in every timed case that showed a sign and was never shown wrong, but several timed groups outside it showed no sign (in true starts 9, 8 of them on one utility science design), and the evidence is thinner near the band's edges. Inside the band the call is the cheaper one on expected cost, from one held-out measurement.",
] as const;

export type RuleCallKind = "leave unwired" | "clock";

export interface RuleCall {
    call: RuleCallKind;
    /** True for a call outside the marginal band, false for one inside it */
    firm: boolean;
    /** The region of w the call falls in, as its page's figures name it, e.g. "53 to 158.6" */
    region: string;
    /** The w it was made for */
    w: number;
    /** The count it was made on */
    count: RuleCount;
}

/** The call for a wired inserter that a clock spares `w` wake-ups a minute (unrounded), on the given count */
export function ruleCallOf(w: number, count: RuleCount = "true starts"): RuleCall {
    const { unwired_firm, clock_lower, clock_firm } = RULE_THRESHOLDS[count];
    if (w < unwired_firm) {
        return { call: "leave unwired", firm: true, region: `below ${unwired_firm.toFixed(1)}`, w, count };
    }
    if (w < clock_lower) {
        return { call: "leave unwired", firm: false, region: `${unwired_firm.toFixed(1)} to ${clock_lower.toFixed(1)}`, w, count };
    }
    if (w <= clock_firm) {
        return { call: "clock", firm: false, region: `${clock_lower.toFixed(1)} to ${clock_firm.toFixed(1)}`, w, count };
    }
    return { call: "clock", firm: true, region: `above ${clock_firm.toFixed(1)}`, w, count };
}

/** One group of inserters, unwired against clocked */
export interface RuleRemovalGroup {
    key: string;
    role: string;
    items: string;
    recipes: string;
    inserters_unwired: number;
    inserters_clocked: number;
    wired_unwired: number;
    wired_clocked: number;
    /** The clock wires more of this group than the unwired run has: the group the call is for */
    newly_wired: boolean;
    /** Wake-ups a minute for each inserter of the group in the unwired run; 0 when the group is absent there */
    w_unwired: number;
    /** The same in the clocked run; 0 when the group is absent there */
    w_clocked: number;
    /** `w_unwired - w_clocked`, for a newly wired group; null for a group not wired (reported as "not wired", no call) */
    w_removed: number | null;
    /** The group's call; null when it is not wired */
    call: RuleCall | null;
    status: "newly wired" | "not wired";
    /** How far the true starts of the group's sinks can be trusted, the worse of the two runs; null where not inferred */
    true_start_standing: TrueStartStanding | null;
}

export interface RuleRemoval {
    groups: RuleRemovalGroup[];
    /** Inserters the clocked run wires beyond the unwired run's, over the newly wired groups */
    newly_wired_inserters: number;
    /** Wake-ups a minute removed over ALL groups, wired or not (the numerator of the pooled figure) */
    removed_per_minute: number;
    /** The pooled w removed for a wired inserter of the design: `removed_per_minute / newly_wired_inserters`; null without any */
    w_removed_pooled: number | null;
    /** The call for the design as a whole, from the pooled figure; null without a newly wired inserter */
    call: RuleCall | null;
    /** The count the removal and the calls are made on */
    count: RuleCount;
    caveats: readonly string[];
}

/**
 * The series' removed() (gen_groups.py, the generator reading), for the unwired run and the clocked run of one build,
 * on the count given (true starts by default, the call's count).
 *
 * Per group (the same key in either run): a group the clock newly wires (more wired inserters in the clocked run) has
 * `w removed = a.w / a.n / U.minutes - b.w / b.n / C.minutes` for each inserter, a the unwired group, b the clocked
 * one, 0 for a side where the group is absent. The pooled figure sums `a.w / U.minutes - b.w / C.minutes` over ALL
 * groups, newly wired or not, and divides by the inserters newly wired: that is the "w removed for a wired inserter"
 * of the design. A group not newly wired is reported with its unwired w and no call.
 */
export function removedBetween(unwired_run: RuleCountRun, clocked_run: RuleCountRun, count: RuleCount = "true starts"): RuleRemoval {
    const wakeUpsOf = (group: RuleCountGroup) => count === "true starts" ? group.true_wake_ups : group.wake_ups;
    const by_key = (run: RuleCountRun) => new Map<string, RuleCountGroup>(run.groups.map(group => [group.key, group]));
    const unwired = by_key(unwired_run);
    const clocked = by_key(clocked_run);
    const keys = [...new Set([...unwired.keys(), ...clocked.keys()])];
    let removed_per_minute = 0;
    let newly_wired_inserters = 0;
    const groups: RuleRemovalGroup[] = [];
    for (const key of keys) {
        const a = unwired.get(key);
        const b = clocked.get(key);
        const a_rate = a === undefined || a.inserters === 0 ? 0 : wakeUpsOf(a) / unwired_run.minutes;
        const b_rate = b === undefined || b.inserters === 0 ? 0 : wakeUpsOf(b) / clocked_run.minutes;
        removed_per_minute += a_rate - b_rate;
        const w_unwired = a === undefined || a.inserters === 0 ? 0 : a_rate / a.inserters;
        const w_clocked = b === undefined || b.inserters === 0 ? 0 : b_rate / b.inserters;
        const named = (a ?? b)!;
        const wired_unwired = a?.wired ?? 0;
        const wired_clocked = b?.wired ?? 0;
        const newly_wired = wired_clocked > wired_unwired;
        if (newly_wired) {
            newly_wired_inserters += wired_clocked - wired_unwired;
        }
        const w_removed = newly_wired ? w_unwired - w_clocked : null;
        groups.push({
            key, role: named.role, items: named.items, recipes: named.recipes,
            inserters_unwired: a?.inserters ?? 0, inserters_clocked: b?.inserters ?? 0, wired_unwired, wired_clocked,
            newly_wired, w_unwired, w_clocked, w_removed,
            call: w_removed === null ? null : ruleCallOf(w_removed, count),
            status: newly_wired ? "newly wired" : "not wired",
            true_start_standing: worseStanding(a?.true_start_standing ?? null, b?.true_start_standing ?? null),
        });
    }
    const w_removed_pooled = newly_wired_inserters === 0 ? null : removed_per_minute / newly_wired_inserters;
    return {
        groups, newly_wired_inserters, removed_per_minute, w_removed_pooled,
        call: w_removed_pooled === null ? null : ruleCallOf(w_removed_pooled, count),
        count, caveats: RULE_CALL_CAVEATS,
    };
}
