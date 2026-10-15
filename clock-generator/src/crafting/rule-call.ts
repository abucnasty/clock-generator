import { RuleCountGroup, RuleCountRun } from "./rule-count";

/**
 * The clock-or-unwired call of the inserter cost series, from how many wake-ups a clock removes from an inserter.
 *
 * This is advice about update time only. The thresholds are the series' closing page, in one place: change them here
 * and nowhere else.
 */

/**
 * Where the figures come from: factorio-benchmarks, benchmarks/2026-10-12-inserter-cost-2.1.21/closing/
 * CLOSING-2-RESULT.md (sha256 39a567ad8bef3f0415743e3ae54a0da3d3251c226d6d331a2a0f91d8fcc36ede). The rule is
 * compared on the unrounded w, against the figures as the page writes them.
 */
export const RULE_CALL_SOURCE = {
    page: "factorio-benchmarks benchmarks/2026-10-12-inserter-cost-2.1.21/closing/CLOSING-2-RESULT.md",
    sha256: "39a567ad8bef3f0415743e3ae54a0da3d3251c226d6d331a2a0f91d8fcc36ede",
} as const;

/**
 * Wake-ups a minute a clock removes from one wired inserter (w removed), at which the call changes. Below `unwired_firm`
 * leave it unwired, outside the band; up to `clock_lower` leave it unwired, marginally; up to and including
 * `clock_firm` clock it, marginally; above that clock it, outside the band. "Firm" means outside the band, not certain.
 */
export const RULE_CALL_THRESHOLDS = {
    unwired_firm: 63.5,
    clock_lower: 158.6,
    clock_firm: 207.6,
} as const;

/** What the rule covers and what it is not, which every result carries */
export const RULE_CALL_CAVEATS = [
    "The rule was measured on saves of 91,000 to 606,000 entities. Below that size it is not known, and the generator does not know the size of the save the build goes into.",
    "It is advice about update time only. It is never a reason to drop a clock a build needs for stable output.",
    "A firm call is one outside the band (63.5 to 207.6), not a certain one. Outside the band the call was right in every timed case that showed a sign, and was never shown wrong; but 7 timed groups outside the band showed no sign (all on one utility science design, whose pooled 215 a minute calls \"clock\"), and the evidence is thinner near the band's edges. Inside the band the call is the cheaper one on expected cost, from one held-out measurement.",
] as const;

export type RuleCallKind = "leave unwired" | "clock";

export interface RuleCall {
    call: RuleCallKind;
    /** True for a call well outside the marginal band, false for one inside it */
    firm: boolean;
    /** The region of w the call falls in, as the closing page names it */
    region: "below 63.5" | "63.5 to 158.6" | "158.6 to 207.6" | "above 207.6";
    /** The w it was made for */
    w: number;
    /** The page the thresholds are from */
    source: typeof RULE_CALL_SOURCE;
    caveats: readonly string[];
}

/** The call for a wired inserter that a clock spares `w` wake-ups a minute (unrounded) */
export function ruleCallOf(w: number): RuleCall {
    const { unwired_firm, clock_lower, clock_firm } = RULE_CALL_THRESHOLDS;
    const caveats = RULE_CALL_CAVEATS;
    const source = RULE_CALL_SOURCE;
    if (w < unwired_firm) {
        return { call: "leave unwired", firm: true, region: "below 63.5", w, source, caveats };
    }
    if (w < clock_lower) {
        return { call: "leave unwired", firm: false, region: "63.5 to 158.6", w, source, caveats };
    }
    if (w <= clock_firm) {
        return { call: "clock", firm: false, region: "158.6 to 207.6", w, source, caveats };
    }
    return { call: "clock", firm: true, region: "above 207.6", w, source, caveats };
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
    caveats: readonly string[];
}

/**
 * The series' removed() (gen_groups.py, the generator reading), for the unwired run and the clocked run of one build.
 *
 * Per group (the same key in either run): a group the clock newly wires (more wired inserters in the clocked run) has
 * `w removed = a.w / a.n / U.minutes - b.w / b.n / C.minutes` for each inserter, a the unwired group, b the clocked
 * one, 0 for a side where the group is absent. The pooled figure sums `a.w / U.minutes - b.w / C.minutes` over ALL
 * groups, newly wired or not, and divides by the inserters newly wired: that is the "w removed for a wired inserter"
 * of the design. A group not newly wired is reported with its unwired w and no call.
 */
export function removedBetween(unwired_run: RuleCountRun, clocked_run: RuleCountRun): RuleRemoval {
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
        const a_rate = a === undefined || a.inserters === 0 ? 0 : a.wake_ups / unwired_run.minutes;
        const b_rate = b === undefined || b.inserters === 0 ? 0 : b.wake_ups / clocked_run.minutes;
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
            call: w_removed === null ? null : ruleCallOf(w_removed),
            status: newly_wired ? "newly wired" : "not wired",
        });
    }
    const w_removed_pooled = newly_wired_inserters === 0 ? null : removed_per_minute / newly_wired_inserters;
    return {
        groups, newly_wired_inserters, removed_per_minute, w_removed_pooled,
        call: w_removed_pooled === null ? null : ruleCallOf(w_removed_pooled),
        caveats: RULE_CALL_CAVEATS,
    };
}
