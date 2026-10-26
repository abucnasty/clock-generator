import type { BackpressureLossVerdict } from "./backpressure-loss";
import type { StartDependence } from "./start-dependence";
import type { Config } from "../config";

/** Derived scheduling policy, distinct from user overrides and legacy final-taker aggregate counts. */
export interface PrimitiveGroupedPolicy {
    strategy: "primitive-grouped";
    trigger: "initial-period-limit";
    requested_terminal_swing_count: number;
    terminal_swing_count: number;
    grouped_cycles: number;
    construction_key: string;
    options: { share_windows: false; feeder_offset: number; surplus_guard: boolean };
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
export function verificationTerminalCountOf(result: { used_terminal_swing_count: number; primitive_grouped?: PrimitiveGroupedPolicy }): number {
    return result.primitive_grouped?.terminal_swing_count ?? result.used_terminal_swing_count;
}

export function verificationPlanningConfigOf(config: Config, result: { used_terminal_swing_count: number; primitive_grouped?: PrimitiveGroupedPolicy }): Config {
    return { ...config, overrides: { ...config.overrides, terminal_swing_count: verificationTerminalCountOf(result),
        ...(result.primitive_grouped === undefined ? {} : { lcm: result.primitive_grouped.grouped_cycles }) } };
}
