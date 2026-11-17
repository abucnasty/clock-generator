/** A fractional window cycle as p/q ticks with small integers: the count of a subtick clock and the units of its position */
export interface SubtickWindowCycle {
    /** p: the whole ticks the subtick clock counts, q window cycles */
    window_cycle_ticks: number;
    /** q: how many units of the clock's position make one tick */
    scale: number;
}

const MAX_SUBTICK_SCALE = 1000;

/** A fractional window cycle as p/q ticks with small integers (e.g. 550.9565... = 12672/23), or null */
export function subtickClockForWindowCycle(window_cycle_ticks: number): SubtickWindowCycle | null {
    if (Number.isInteger(window_cycle_ticks)) {
        return null;
    }
    for (let q = 2; q <= MAX_SUBTICK_SCALE; q++) {
        const p = Math.round(window_cycle_ticks * q);
        // the multiply combinator outputs up to p * q, which must fit a 32-bit signal
        if (Math.abs(p / q - window_cycle_ticks) < 1e-6 && p * q < 2 ** 31) {
            return { window_cycle_ticks: p, scale: q };
        }
    }
    return null;
}

/** A span of whole ticks a fractional window cycle is judged on in place of the whole ticks its subtick clock repeats in */
export interface JudgedPeriod {
    /** P: whole ticks */
    ticks: number;
    /** The window cycles P lasts, not a whole number: P over the window cycle */
    window_cycles: number;
    /** The whole window cycles P stands for, whose output a span of P holds: P over the window cycle, rounded */
    whole_window_cycles: number;
}

/**
 * One window cycle rounded to the nearest whole tick, P (90.947 ticks: 91; 213.333: 213): the shorter period a subtick clock
 * can be judged on in place of the whole ticks its subtick clock repeats in (1,728 and 640). Null for a whole-tick window
 * cycle, which is its own period, and for a fractional one with no subtick clock.
 */
export function roundedPeriodOf(window_cycle_ticks: number): JudgedPeriod | null {
    if (subtickClockForWindowCycle(window_cycle_ticks) === null) {
        return null;
    }
    const ticks = Math.max(1, Math.round(window_cycle_ticks));
    return { ticks, window_cycles: ticks / window_cycle_ticks, whole_window_cycles: Math.max(1, Math.round(ticks / window_cycle_ticks)) };
}

/**
 * The whole values a decider is open for, of a window with these bounds: a fractional bound (from a fractional
 * window cycle's wrap) is rounded inward, as the exported deciders' constants are. Null when no whole value is inside.
 */
export function wholeBounds(start: number, end: number): [number, number] | null {
    const whole_start = Math.ceil(start - 1e-9);
    const whole_end = Math.floor(end + 1e-9);
    return whole_start <= whole_end ? [whole_start, whole_end] : null;
}
