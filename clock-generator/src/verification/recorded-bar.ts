import type { RecordedMachine } from "./recording";

/** How fast a machine's crafting and productivity bars fill: its crafts per tick, and how far one craft fills the productivity bar */
export interface BarRates {
    readonly crafts_per_tick: number;
    readonly bonus_per_craft: number;
}

/** A recorded machine's productivity bar at its first sample: the value, and the sample it was worked back from (0: as recorded) */
export type BarAtFirstSample =
    | { readonly bar: number; readonly from_sample: number }
    | { readonly bar: null; readonly reason: string };

const SAMPLES_SEARCHED = 600;
const WHOLE_CRAFTS_TOLERANCE = 0.01;
const BAR_TOLERANCE = 0.001;

/**
 * The productivity bar of a recorded machine at its first sample. The game reports a full bar as 1 and keeps what is over
 * it: the bar pays at the start of the next tick or after a finished craft, so a machine of high productivity holds more
 * than a whole bar between payouts (recorded: an electromagnetic plant at +175% shows 1, then 0.4713 a tick later after
 * filling 0.3193 and paying 1, so it held 1.152). A start from the shown 1 loses what is over it, and the bar stays that
 * far behind the game's for good.
 *
 * Where the first sample shows a full bar, its value is worked back from the first later sample n that shows less than 1,
 * over w ticks in which the machine works at its full rate, every other tick leaving it as it was:
 * bar(0) = bar(n) - w x crafts_per_tick x bonus_per_craft + payouts, where the payouts are the products finished less
 * the crafts finished (c(0) + w x crafts_per_tick - c(n), a whole number). Null where that does not hold: the bar shows
 * full for too long, a tick that is not working moves the machine, or its crafting does not follow its full rate.
 */
export function barAtFirstSample(samples: RecordedMachine["samples"], rates: BarRates): BarAtFirstSample {
    const bars = samples.bonus_progress;
    if (bars.length === 0) {
        return { bar: null, reason: "no sample" };
    }
    if (bars[0] < 1 || rates.bonus_per_craft <= 0) {
        return { bar: bars[0], from_sample: 0 };
    }
    const last = Math.min(bars.length - 1, SAMPLES_SEARCHED);
    let n = 1;
    while (n <= last && bars[n] >= 1) {
        n++;
    }
    if (n > last) {
        return { bar: null, reason: `the bar shows full in samples 0 to ${last}` };
    }
    const working = workingTicks(samples, n);
    if (typeof working === "string") {
        return { bar: null, reason: working };
    }
    const progress = samples.crafting_progress;
    const crafts = progress[0] + working * rates.crafts_per_tick - progress[n];
    const whole_crafts = Math.round(crafts);
    if (Math.abs(crafts - whole_crafts) > WHOLE_CRAFTS_TOLERANCE) {
        return { bar: null, reason: `the crafting progress of samples 0 to ${n} does not follow the full rate (${crafts.toFixed(4)} crafts)` };
    }
    const payouts = samples.products_finished[n] - samples.products_finished[0] - whole_crafts;
    const bar = bars[n] - working * rates.crafts_per_tick * rates.bonus_per_craft + payouts;
    if (bar < 1 - BAR_TOLERANCE) {
        return { bar: null, reason: `worked back from sample ${n} the bar would be ${bar.toFixed(4)}, below the full bar shown` };
    }
    return { bar: Math.round(bar * 10000) / 10000, from_sample: n };
}

/**
 * The ticks from sample 0 to sample `last` in which the machine works, each a whole tick at its full rate; every other
 * tick must leave its bars and products finished as they were (a machine that stands still). Else why not, as a text.
 */
function workingTicks(samples: RecordedMachine["samples"], last: number): number | string {
    const status = samples.status;
    let current = "";
    let next = 0;
    let working = 0;
    for (let sample = 0; sample <= last; sample++) {
        while (next < status.length && status[next][0] <= sample) {
            current = status[next][1];
            next++;
        }
        if (sample === 0) {
            continue;
        }
        if (current === "working") {
            working++;
            continue;
        }
        const before = sample - 1;
        if (samples.crafting_progress[sample] !== samples.crafting_progress[before] || samples.bonus_progress[sample] !== samples.bonus_progress[before]
            || samples.products_finished[sample] !== samples.products_finished[before]) {
            return `the bar shows full at sample 0 and the machine, ${current === "" ? "unrecorded" : current} at sample ${sample}, moves its bars or finishes products there, before its bar shows less than 1 at sample ${last}`;
        }
    }
    return working;
}
