import { SubtickWindowCycle, subtickClockForWindowCycle } from "../../common/subtick-window-cycle";

/**
 * The most ticks one simulated run goes on for: a simulator budget, not a proof. A guard, not a limit on test time: a
 * config that passes validation but deadlocks something in the simulator, or that it cannot simulate at all, must not
 * keep it running for ever. The P-limit rule of the period planner prunes the periods that reach it; nothing about the
 * game makes a longer period wrong.
 */
export const SIMULATION_BUDGET_TICKS = 500_000;

/**
 * The whole counter a clock of this period is checked over (p ticks, q periods), which one run must then hold: its p/q
 * where the period is fractional and p is under SIMULATION_BUDGET_TICKS. Null for a whole-tick period, and for a counter
 * one run cannot hold (`counterOverLimitOf`), whose clock keeps the sampled checks of one period.
 */
export function wholeCounterOf(window_cycle_ticks: number): SubtickWindowCycle | null {
    const counter = subtickClockForWindowCycle(window_cycle_ticks);
    return counter !== null && counter.window_cycle_ticks < SIMULATION_BUDGET_TICKS ? counter : null;
}

/** The ticks of a fractional period's counter where one run cannot hold it; else null */
export function counterOverLimitOf(window_cycle_ticks: number): number | null {
    const counter = subtickClockForWindowCycle(window_cycle_ticks);
    return counter !== null && counter.window_cycle_ticks >= SIMULATION_BUDGET_TICKS ? counter.window_cycle_ticks : null;
}

/** Arithmetic only: no inventories, controls, registry or other live simulation state. */
export interface WholeSwingArithmeticSnapshot {
    readonly config_json: string;
    readonly terminal_swing_count: number;
}

export interface SwingWindowCycleRejection {
    terminal_swing_count: number;
    base_cycle_ticks: number;
    computed_lcm: number;
    effective_lcm: number;
    window_cycle_ticks: number;
    limit_ticks: number;
}

/** Only a finite positive period at or above the existing limit is retryable by automatic whole-swing planning. */
export class ClockWindowCycleLimitError extends Error {
    readonly rejection: Readonly<SwingWindowCycleRejection>;
    readonly arithmetic?: Readonly<WholeSwingArithmeticSnapshot>;

    constructor(rejection: SwingWindowCycleRejection, arithmetic?: WholeSwingArithmeticSnapshot) {
        if (!Number.isFinite(rejection.window_cycle_ticks) || rejection.window_cycle_ticks <= 0 || !Number.isFinite(rejection.limit_ticks)
            || rejection.limit_ticks <= 0 || rejection.window_cycle_ticks < rejection.limit_ticks) {
            throw new RangeError('A period-limit refusal needs a positive finite period at or above its limit.');
        }
        super(`Clock period of ${rejection.window_cycle_ticks} ticks exceeds maximum allowed ${rejection.limit_ticks} ticks`);
        this.name = 'ClockPeriodLimitError';
        this.rejection = Object.freeze({ ...rejection });
        this.arithmetic = arithmetic === undefined ? undefined : Object.freeze({ ...arithmetic });
    }
}

/** Kept apart from simulated attempts: arithmetic rejection supplies no output or hold verdict. */
export interface SwingWindowCyclePruning {
    requested_terminal_swing_count: number;
    rejections: SwingWindowCycleRejection[];
}
