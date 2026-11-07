/** A fractional period as p/q ticks with small integers: the count of a subtick clock and the units of its position */
export interface SubtickWindowCycle {
    /** p: the whole ticks the subtick clock counts, q periods */
    window_cycle_ticks: number;
    /** q: how many units of the clock's position make one tick */
    scale: number;
}

const MAX_SUBTICK_SCALE = 1000;

/** A fractional period as p/q ticks with small integers (e.g. 550.9565... = 12672/23), or null */
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

/**
 * The whole values a decider is open for, of a window with these bounds: a fractional bound (from a fractional
 * period's wrap) is rounded inward, as the exported deciders' constants are. Null when no whole value is inside.
 */
export function wholeBounds(start: number, end: number): [number, number] | null {
    const whole_start = Math.ceil(start - 1e-9);
    const whole_end = Math.floor(end + 1e-9);
    return whole_start <= whole_end ? [whole_start, whole_end] : null;
}
