import type { BackpressureLossVerdict } from "./backpressure-loss";
import type { StartDependence } from "./start-dependence";
import type { Config } from "../config";
import { plannedTerminalSwingCount } from "./sequence/cycle/crafting-cycle";
import type { BlueprintGenerationResult } from "./plan/plan-run";

/** Only the actual primitive primary may seed this internal, serializable secondary count policy. */
export interface SecondaryPlanningCount {
    source: "primitive-primary";
    terminal_swing_count: number;
}

/** Each secondary retains its own final plan's count and LCM, never the primitive's completed verification. */
export interface SecondaryPlanningProvenance extends SecondaryPlanningCount {
    effective_lcm: number;
}

/** A newly introduced provenance bug is not an ordinary unsupported candidate. */
export class SecondaryPlanningInvariantError extends Error {
    constructor(message: string) { super(message); this.name = "SecondaryPlanningInvariantError"; }
}

export function secondaryPlanningCountOf(config: Config, context: { secondary_planning?: SecondaryPlanningCount }): SecondaryPlanningCount | undefined {
    // A stale context cannot replace an explicit caller policy. Internal family overrides are applied afterwards.
    const policy = config.overrides?.terminal_swing_count === undefined && config.overrides?.lcm === undefined
        && config.overrides?.use_fractional_swings !== true && config.target_output.counts !== "destroyed"
        ? context.secondary_planning : undefined;
    if (policy !== undefined && (policy.source !== "primitive-primary" || !Number.isFinite(policy.terminal_swing_count) || policy.terminal_swing_count <= 0)) {
        throw new SecondaryPlanningInvariantError("secondary context has no valid derived count");
    }
    return policy;
}

export function withSecondaryPlanningProvenance<T extends BlueprintGenerationResult>(result: T): T {
    const count = plannedTerminalSwingCount(result.crafting_cycle_plan);
    if (count === undefined || !Number.isFinite(count) || count <= 0) throw new SecondaryPlanningInvariantError("secondary result has no actual planner count");
    if (!Number.isFinite(result.used_lcm) || result.used_lcm <= 0) throw new SecondaryPlanningInvariantError("secondary result has no actual LCM");
    if (result.primitive_grouped !== undefined) throw new SecondaryPlanningInvariantError("a secondary result cannot borrow primitive verification");
    return { ...result, secondary_planning: { source: "primitive-primary", terminal_swing_count: count, effective_lcm: result.used_lcm } };
}

/** Derived scheduling policy, distinct from user overrides and legacy final-taker aggregate counts. */
export interface PrimitiveGroupedPolicy {
    strategy: "primitive-grouped";
    /** Tried because the first plan's period is too long, or because no planned count held */
    trigger: "initial-period-limit" | "no-count-holds";
    requested_terminal_swing_count: number;
    terminal_swing_count: number;
    grouped_cycles: number;
    construction_key: string;
    options: { share_windows: false; feeder_offset: number; surplus_guard: boolean; output_room?: boolean };
    /** Optional loop refinement cannot change a composition after its margin gate. */
    loop_refinement: false;
    /** Only the exact assessed composition may reuse these completed checks. */
    verification?: {
        signature: string;
        backpressure_loss: BackpressureLossVerdict;
        start_dependence: StartDependence | null;
    };
}

export interface PrimitiveGroupedAttemptReport {
    strategy: "primitive-grouped";
    eligibility: "separate-windows-only";
    outcome: "accepted" | "inapplicable" | "failed";
    reason?: string;
    attempts: { construction_key: string; stage: "margin" | "as-built" | "recovery" | "starts" | "accepted"; reason?: string }[];
}

/** Preserve the historical reporting alias; only the new policy supplies a different verification unit. */
interface VerificationPlanningResult {
    used_terminal_swing_count: number;
    primitive_grouped?: PrimitiveGroupedPolicy;
    secondary_planning?: SecondaryPlanningProvenance;
}

export function verificationTerminalCountOf(result: VerificationPlanningResult): number {
    return result.primitive_grouped?.terminal_swing_count ?? result.secondary_planning?.terminal_swing_count ?? result.used_terminal_swing_count;
}

export function verificationPlanningConfigOf(config: Config, result: VerificationPlanningResult): Config {
    const cycles = result.primitive_grouped?.grouped_cycles ?? result.secondary_planning?.effective_lcm;
    return { ...config, overrides: { ...config.overrides, terminal_swing_count: verificationTerminalCountOf(result),
        ...(cycles === undefined ? {} : { lcm: cycles }) } };
}
