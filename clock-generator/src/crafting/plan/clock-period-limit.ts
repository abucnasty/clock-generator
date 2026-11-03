import { SubtickPeriod, subtickClockForPeriod } from "../../common/subtick-period";
import { DEFAULT_INSERTER_DISPATCH } from "../../simulation/dispatch";

/**
 * The most ticks one simulated run goes on for. A guard, not a limit on test time: a config that passes validation
 * but deadlocks something in the simulator, or that it cannot simulate at all, must not keep it running for ever.
 */
export const MAX_SIMULATION_TICKS = 500_000;

/**
 * Whether a clock of a p/q-tick period is checked over its whole exported counter (p ticks, q periods), which one run
 * must then hold: under the new dispatch (simulation/dispatch.ts) only. Read once, from the environment, as the dispatch is.
 */
export const WHOLE_COUNTER_CHECKS: boolean = DEFAULT_INSERTER_DISPATCH !== "configured-order";

/**
 * The whole counter a clock of this period is checked over (`WHOLE_COUNTER_CHECKS`): its p/q where the period is
 * fractional and p is under MAX_SIMULATION_TICKS. Null for a whole-tick period, with the checks off, and for a counter
 * one run cannot hold (`counterOverLimitOf`), whose clock keeps the sampled checks of one period.
 */
export function wholeCounterOf(period: number): SubtickPeriod | null {
    if (!WHOLE_COUNTER_CHECKS) return null;
    const counter = subtickClockForPeriod(period);
    return counter !== null && counter.period_ticks < MAX_SIMULATION_TICKS ? counter : null;
}

/** The ticks of a fractional period's counter where whole-counter checks are on and one run cannot hold it; else null */
export function counterOverLimitOf(period: number): number | null {
    if (!WHOLE_COUNTER_CHECKS) return null;
    const counter = subtickClockForPeriod(period);
    return counter !== null && counter.period_ticks >= MAX_SIMULATION_TICKS ? counter.period_ticks : null;
}

/** Arithmetic only: no inventories, controls, registry or other live simulation state. */
export interface WholeSwingArithmeticSnapshot {
    readonly config_json: string;
    readonly terminal_swing_count: number;
}

export interface SwingPeriodRejection {
    terminal_swing_count: number;
    base_cycle_ticks: number;
    computed_lcm: number;
    effective_lcm: number;
    period_ticks: number;
    limit_ticks: number;
}

/** Only a finite positive period at or above the existing limit is retryable by automatic whole-swing planning. */
export class ClockPeriodLimitError extends Error {
    readonly rejection: Readonly<SwingPeriodRejection>;
    readonly arithmetic?: Readonly<WholeSwingArithmeticSnapshot>;

    constructor(rejection: SwingPeriodRejection, arithmetic?: WholeSwingArithmeticSnapshot) {
        if (!Number.isFinite(rejection.period_ticks) || rejection.period_ticks <= 0 || !Number.isFinite(rejection.limit_ticks)
            || rejection.limit_ticks <= 0 || rejection.period_ticks < rejection.limit_ticks) {
            throw new RangeError('A period-limit refusal needs a positive finite period at or above its limit.');
        }
        super(`Clock period of ${rejection.period_ticks} ticks exceeds maximum allowed ${rejection.limit_ticks} ticks`);
        this.name = 'ClockPeriodLimitError';
        this.rejection = Object.freeze({ ...rejection });
        this.arithmetic = arithmetic === undefined ? undefined : Object.freeze({ ...arithmetic });
    }
}

/** Kept apart from simulated attempts: arithmetic rejection supplies no output or hold verdict. */
export interface SwingPeriodPruning {
    requested_terminal_swing_count: number;
    rejections: SwingPeriodRejection[];
}
