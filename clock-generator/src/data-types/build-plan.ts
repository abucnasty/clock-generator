/**
 * The plan of a build (planBuild, crafting/planner/plan-build.ts): what the planner decides by arithmetic before any
 * simulation, from the planner facts, the planner graph and the feasibility pass, each decision with the terms it was
 * made from. Plain, JSON-safe data; this module imports only types, so a page can take them from the light entry.
 *
 * - the groups: the connected parts of the condensed graph once the SINK and the sources of no known bound are taken
 *   out; two groups share no node;
 * - per group, the main-period choices (the output swing counts the alternatives are listed for), each kept or pruned
 *   by a rule, and the duty of each machine group in it;
 * - the composition of the group periods into the one main period;
 * - for a target that counts an item destroyed, whether its results get windows of their own.
 *
 * Only the result windows' decision is read by a generation yet; the rest is recorded.
 */
import type { FactsRatio } from "./planner-facts";
import type { PlannerGraph } from "./planner-graph";
import type { ResultWindowsPlan } from "../crafting/result-windows";

/** Why a source vertex is no part of any group: it brings what the build takes from outside, with no bound known */
export type UnboundedSourceKind = "nothing-drops-on" | "infinity-supply";

/** A container or lane port taken out before the groups are found */
export interface UnboundedSource {
    readonly vertex: string;
    readonly kind: UnboundedSourceKind;
}

/** Where a main-period choice comes from in today's lists of output swing counts */
export type PeriodListing =
    /** the count the planning run starts from, as its prepare step finds it (or the config forces it) */
    | "planned"
    /** a count between the planned one and the main one, tried because the planned period is over the limit */
    | "backed-off"
    /** the count of the main clock: the planned one, or the first below it whose period is under the limit */
    | "main"
    /** a count above the main one, offered as an alternative */
    | "higher"
    /** a count below the main one, offered as an alternative */
    | "lower"
    /** the main clock with fractional swings switched the other way */
    | "fractional";

/** P-limit: a period over the most ticks one simulated run goes on for cannot be simulated */
export interface PeriodLimitTerms {
    readonly period_ticks: number;
    readonly limit_ticks: number;
}

interface PeriodChoiceHead {
    /** Output swings a cycle; for a target that counts an item destroyed, the hands brought into a machine a cycle */
    readonly swings: number;
    /** The swings as an exact fraction, where fractional swings are on and they are not whole */
    readonly swings_exact?: FactsRatio;
    readonly fractional: boolean;
    readonly listed_as: PeriodListing;
}

interface PeriodChoiceBase extends PeriodChoiceHead {
    /** Ticks of one crafting cycle at this count, exact */
    readonly cycle_ticks: FactsRatio;
    /** Cycles of the group's period: the config's own lcm, else the lcm of the denominators of its edges' hands a cycle */
    readonly cycles: number;
    /** The group's period: cycle_ticks x cycles */
    readonly period_ticks: number;
}

export interface KeptPeriodChoice extends PeriodChoiceBase {
    readonly kept: true;
}

export interface PrunedPeriodChoice extends PeriodChoiceBase {
    readonly pruned: { readonly rule: "P-limit"; readonly terms: PeriodLimitTerms };
}

/** An alternative's count whose cycle today's cycle plan refuses to make, with its reason: it has no period */
export interface RefusedPeriodChoice extends Omit<PeriodChoiceHead, "swings"> {
    /** The count asked for; null where the cycle plan refused the swings before it had a count (fractional swings) */
    readonly swings: number | null;
    readonly pruned: { readonly rule: "cycle-refused"; readonly terms: { readonly reason: string } };
}

export type PeriodChoice = KeptPeriodChoice | PrunedPeriodChoice | RefusedPeriodChoice;

/** The duty of a machine group (feasibility/duty.ts) whose machines are in the group, exact */
export interface PlanDuty {
    /** The machine group's key, as the feasibility demand names it */
    readonly producer: string;
    /** Its machines (or drills) in this group, by vertex */
    readonly members: readonly string[];
    readonly crafts_needed: FactsRatio;
    readonly crafts_capacity: FactsRatio;
    /** crafts_needed / crafts_capacity */
    readonly duty: FactsRatio;
}

export interface PlanGroup {
    readonly key: string;
    /** Its entries of the graph's order (`PlannerGraph.order`): a vertex outside every loop by its key, a loop by its key */
    readonly members: readonly string[];
    /** The edges that carry an item into or out of its members, in edge order */
    readonly edges: readonly string[];
    readonly periods: readonly PeriodChoice[];
    readonly duty: readonly PlanDuty[];
}

/** What is done where the main period is over the limit */
export type OverLimitAction =
    | { readonly action: "none" }
    /** today's swing backoff: the next lower count whose period is under the limit (Small batches is tried first where it applies) */
    | { readonly action: "swing-backoff"; readonly rule: "P-limit"; readonly terms: OverLimitTerms }
    /** no count can be backed off to (a forced count, fractional swings, a destroyed target, or none under the limit) */
    | { readonly action: "refused"; readonly rule: "P-limit"; readonly terms: OverLimitTerms };

export interface OverLimitTerms {
    readonly requested_swings: number;
    readonly limit_ticks: number;
    /** The main period of each count tried, from the requested one down */
    readonly tried: readonly { readonly swings: number; readonly period_ticks: number }[];
}

export interface PlanComposition {
    /** The main clock's count */
    readonly swings: number;
    readonly fractional: boolean;
    /**
     * What today's lists of other counts start from (planner/periods.ts, swingCountsListed): the output swings the main
     * run reports and the planned count, and the main period up to which higher counts are listed; absent where no other
     * count is listed (a target that counts an item destroyed)
     */
    readonly listed_from?: { readonly swings: number; readonly planned: number; readonly higher_up_to_ticks: number };
    /** The main period: cycle_ticks x effective_lcm */
    readonly main_period: { readonly ticks: number; readonly exact: FactsRatio };
    readonly lcm_terms: {
        readonly cycle_ticks: FactsRatio;
        /** The cycles of each group's period at the main count */
        readonly group_cycles: readonly { readonly group: string; readonly cycles: number }[];
        /** Items whose hands are left out of the lcm: the config's, and results carried from one window to the next */
        readonly ignored_items: readonly string[];
        /** The lcm of the cycles of every hand a cycle of the build, the groups' among them */
        readonly computed_lcm: number;
        /** The config's own lcm (`overrides.lcm`) */
        readonly override_lcm: number | null;
        readonly effective_lcm: number;
    };
    readonly over_limit_action: OverLimitAction;
}

/** The arithmetic of a destroyed target's decision (planner/result-windows.ts) */
export interface ResultWindowsTerms {
    readonly item: string;
    /** The machines that destroy it, by number */
    readonly machines: readonly number[];
    readonly hand: number;
    readonly ticks_per_hand: FactsRatio;
    /** The fewest hands a cycle that last whole ticks */
    readonly base_hands: number;
    /** The hands a cycle the config sets */
    readonly forced: number | null;
    /** Ticks of base_hands */
    readonly cycle_ticks: number;
    /** The takers' hands come out whole in a period the container holds */
    readonly whole_hands_fit: boolean;
    /** Every machine's results can be given windows; null where whole hands fit and it is not asked */
    readonly windows_feasible: boolean | null;
    readonly longest_period_ticks: number;
}

export type ResultWindowsDecision =
    | { readonly kind: "whole-hands"; readonly hands: number; readonly terms: ResultWindowsTerms }
    | {
        readonly kind: "result-windows";
        /** Hands a cycle: base_hands x cycles; the cycle is the whole period */
        readonly hands: number;
        readonly cycles: number;
        readonly terms: ResultWindowsTerms;
        readonly plans: readonly ResultWindowsPlan[];
    };

export interface BuildPlan {
    readonly schema: 1;
    readonly target: PlannerGraph["target"];
    readonly unbounded_sources: readonly UnboundedSource[];
    readonly groups: readonly PlanGroup[];
    /** Null where the build has no cycle to plan (it is refused before) */
    readonly composition: PlanComposition | null;
    /** For a target that counts an item destroyed; null for every other */
    readonly result_windows: ResultWindowsDecision | null;
}
