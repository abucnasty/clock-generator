import { subtickClockForWindowCycle } from "../../common/subtick-window-cycle";
import type { EnableControlOverrideConfig } from "../../config/schema";
import { AlwaysEnabledControl, clockRepeatFacts, EnableControl } from "../../simulation/controls/enable-control";

/** The control a run put an inserter or drill on, with the config's override of that entity */
export interface InstalledControl {
    control: EnableControl;
    override: EnableControlOverrideConfig | undefined;
}

/**
 * Why the warm-up's stop on a repeated state is not armed: some control reads what the state key does not hold, so equal
 * keys do not prove that the next ticks are equal.
 * - `latched`: a CONDITIONAL control with a latch: the latch is not in the key.
 * - `planning control`: a control the plan makes (AUTO) that is not a clock: it keeps counts of its own (hands allowed
 *   so far, a span), a latch, or a clock of its own inside a condition, none of them in the key.
 * - `inexact clock`: a clock of p/q ticks worked out in floats, whose answers drift from one window cycle to the next.
 * - `no whole-tick repeat`: a window cycle (of the run or of a clock) with no whole number of ticks it repeats in.
 * - `repeat past the warm-up`: every clock together repeats only after more ticks than the warm-up runs.
 */
export type UnarmedReason = "latched" | "planning control" | "inexact clock" | "no whole-tick repeat" | "repeat past the warm-up";

/**
 * Where the warm-up may stop on a repeated state. Armed: at boundaries `bin_ticks` apart, counted from the warm-up's
 * start, every clock of the run stands where it stood at the last one, and every other control answers from what the
 * state key holds; so equal keys at two such boundaries mean the run repeats from the first for good. Boundaries before
 * `keyed_from_ticks` are not keyed: a clock leaves the ticks after its start dark, and the key does not hold that.
 */
export type WarmUpRepeat =
    | { armed: true; bin_ticks: number; keyed_from_ticks: number }
    | { armed: false; reason: UnarmedReason };

/** The whole ticks a window cycle repeats in: itself, or p for a window cycle of p/q ticks; null where there are none */
function wholeTicksOf(window_cycle_ticks: number): number | null {
    if (Number.isInteger(window_cycle_ticks)) {
        return window_cycle_ticks > 0 ? window_cycle_ticks : null;
    }
    return subtickClockForWindowCycle(window_cycle_ticks)?.window_cycle_ticks ?? null;
}

function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}

/**
 * Whether the warm-up of a run on these controls can stop on a repeated state, and on what boundaries (see `WarmUpRepeat`).
 * The bin is the whole-tick repeat of the window cycle merged with that of every clock. A control that is always on or
 * never on reads nothing. An unlatched CONDITIONAL control reads only entity states the key holds (an inventory, the
 * hand, crafting and bonus progress, a machine's status) and constants of the build. Any other control is not armed.
 */
export function warmUpRepeatOf(window_cycle_ticks: number, controls: readonly InstalledControl[], warm_up_ticks: number): WarmUpRepeat {
    let bin = wholeTicksOf(window_cycle_ticks);
    if (bin === null) {
        return { armed: false, reason: "no whole-tick repeat" };
    }
    let keyed_from_ticks = 0;
    for (const { control, override } of controls) {
        if (control === AlwaysEnabledControl || control === EnableControl.never) {
            continue;
        }
        const clock = clockRepeatFacts(control);
        if (clock !== null) {
            if (!Number.isInteger(clock.window_cycle_ticks) && !clock.exact_subtick_positions) {
                return { armed: false, reason: "inexact clock" };
            }
            const whole = wholeTicksOf(clock.window_cycle_ticks);
            if (whole === null) {
                return { armed: false, reason: "no whole-tick repeat" };
            }
            bin = bin / gcd(bin, whole) * whole;
            if (bin > warm_up_ticks) {
                return { armed: false, reason: "repeat past the warm-up" };
            }
            keyed_from_ticks = Math.max(keyed_from_ticks, clock.start_latency_ticks);
            continue;
        }
        if (override?.mode === "CONDITIONAL") {
            if (override.latch !== undefined) {
                return { armed: false, reason: "latched" };
            }
            continue;
        }
        return { armed: false, reason: "planning control" };
    }
    if (bin > warm_up_ticks) {
        return { armed: false, reason: "repeat past the warm-up" };
    }
    return { armed: true, bin_ticks: bin, keyed_from_ticks };
}
