import type { Ratio } from "../../entities/traits/ratio";
import { subtickClockForWindowCycle } from "../../common/subtick-window-cycle";
import type { EnableControlOverrideConfig } from "../../config/schema";
import { controlRepeatOf, ControlRepeat, EnableControl } from "../../simulation/controls/enable-control";

/** The control a run put an inserter or drill on, with the config's override of that entity */
export interface InstalledControl {
    control: EnableControl;
    override: EnableControlOverrideConfig | undefined;
}

/**
 * Why the warm-up's stop on a repeated state is not armed: some control reads what no key holds, so equal keys do not
 * prove that the next ticks are equal.
 * - `planning control`: a control that keeps what no key holds (a function control made without its `LambdaRepeat`).
 * - `inexact clock`: a clock of p/q ticks worked out in floats, or a control that reads the tick in spans of a
 *   fraction of a tick, whose answers drift from one window cycle to the next.
 * - `no whole-tick repeat`: a window cycle (of the run or of a clock) with no whole number of ticks it repeats in.
 * - `repeat past the warm-up`: every clock and every control that reads the tick together repeat only after more
 *   ticks than the warm-up runs.
 */
export type UnarmedReason = "planning control" | "inexact clock" | "no whole-tick repeat" | "repeat past the warm-up";

/**
 * Where the warm-up may stop on a repeated state. Armed: at boundaries `bin_ticks` apart, counted from the warm-up's
 * start, every clock of the run stands where it stood at the last one, every control that reads the tick reads it at
 * the same place in its repeat, and every other part of a control answers from what the state key and the controls'
 * key (`controlsKeyOf`) hold; so equal keys at two such boundaries mean the run repeats from the first for good.
 * Boundaries before `keyed_from_ticks` are not keyed: a clock leaves the ticks after its start dark, and the key does
 * not hold that.
 */
export type WarmUpRepeat =
    | { armed: true; bin_ticks: number; keyed_from_ticks: number }
    | { armed: false; reason: UnarmedReason };

/** The whole ticks a window cycle repeats in: itself, or p for a window cycle of p/q ticks; null where there are none */
function wholeTicksOf(window_cycle_ticks: number, exact?: Ratio): number | null {
    if (Number.isInteger(window_cycle_ticks)) {
        return window_cycle_ticks > 0 ? window_cycle_ticks : null;
    }
    return subtickClockForWindowCycle(window_cycle_ticks, exact)?.window_cycle_ticks ?? null;
}

function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}

/**
 * Whether the warm-up of a run on these controls can stop on a repeated state, and on what boundaries (see `WarmUpRepeat`).
 * The bin is the whole-tick repeat of the window cycle merged with that of every clock inside the controls and the
 * span of every control that reads the tick. A control that keeps what no key holds is not armed (`controlRepeatOf`).
 */
export function warmUpRepeatOf(window_cycle_ticks: number, controls: readonly InstalledControl[], warm_up_ticks: number, exact?: Ratio): WarmUpRepeat {
    let bin = wholeTicksOf(window_cycle_ticks, exact);
    if (bin === null) {
        return { armed: false, reason: "no whole-tick repeat" };
    }
    let keyed_from_ticks = 0;
    const merge = (whole: number): boolean => {
        bin = bin! / gcd(bin!, whole) * whole;
        return bin <= warm_up_ticks;
    };
    for (const { control } of controls) {
        const repeat = controlRepeatOf(control);
        if (repeat === null) {
            return { armed: false, reason: "planning control" };
        }
        for (const clock of repeat.clocks) {
            if (!Number.isInteger(clock.window_cycle_ticks) && !clock.exact_subtick_positions) {
                return { armed: false, reason: "inexact clock" };
            }
            const whole = wholeTicksOf(clock.window_cycle_ticks, clock.exact_ticks);
            if (whole === null) {
                return { armed: false, reason: "no whole-tick repeat" };
            }
            if (!merge(whole)) {
                return { armed: false, reason: "repeat past the warm-up" };
            }
            keyed_from_ticks = Math.max(keyed_from_ticks, clock.start_latency_ticks);
        }
        for (const period of repeat.period_ticks) {
            // a span of a fraction of a tick is worked out in floats, which need not repeat in whole ticks
            if (!Number.isInteger(period) || period <= 0) {
                return { armed: false, reason: "inexact clock" };
            }
            if (!merge(period)) {
                return { armed: false, reason: "repeat past the warm-up" };
            }
        }
    }
    if (bin > warm_up_ticks) {
        return { armed: false, reason: "repeat past the warm-up" };
    }
    return { armed: true, bin_ticks: bin, keyed_from_ticks };
}

/** What the controls keep between asks (`ControlRepeat`) in installed order; only for controls `warmUpRepeatOf` armed */
function repeatsOf(controls: readonly InstalledControl[]): ControlRepeat[] {
    return controls.map(({ control }) => {
        const repeat = controlRepeatOf(control);
        if (repeat === null) {
            throw new Error("A control keeps what no key holds: the warm-up's stop is not armed on it");
        }
        return repeat;
    });
}

/**
 * The key of what the controls keep between asks, one line, a field for each control in installed order: the warm-up's
 * key is the simulation's (`simulationStateKey`) and this line. Only for controls `warmUpRepeatOf` armed.
 */
export function controlsKeyOf(controls: readonly InstalledControl[]): () => string {
    const repeats = repeatsOf(controls);
    return () => repeats.map(repeat => repeat.key()).join("|");
}

/**
 * Moves what the controls count in ticks of the run by the ticks the warm-up left out at its stop, a whole number of
 * repeats, so they stand where the full warm-up would have left them (`LambdaRepeat.skip`).
 */
export function skipRepeatedTicks(controls: readonly InstalledControl[], ticks: number): void {
    if (ticks > 0) {
        repeatsOf(controls).forEach(repeat => repeat.skip(ticks));
    }
}
