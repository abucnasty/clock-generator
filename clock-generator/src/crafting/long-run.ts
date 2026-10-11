/**
 * How the long run of a clock is counted: what the output inserters drop, in bins of whole ticks that each expect
 * exactly what they are compared with.
 *
 * A whole period is its own bin. A fractional period (90.947 ticks = 1728/19) is not: inserters act on whole ticks,
 * so the build repeats only every `scale` periods (1728 ticks), which is also what the subtick clock of its
 * blueprint counts and what a recording of it is cut into. Bins of the rounded-down period (90 ticks) hold less than
 * a period's output (570 of 576), and bins of the true period put a drop that falls on their edge on either side of
 * it from one period to the next, all output inserters at once.
 */

/** A fractional period in whole ticks: `scale` periods last `period_ticks` ticks */
export interface PeriodRepeat {
    period_ticks: number;
    scale: number;
}

/** The first 1/n of the long run carries its start-up and is not judged */
export const LONG_RUN_SETTLE_SHARE = 3;
/** The long run is lengthened up to this many ticks so the judged part holds one whole repeat of a fractional period */
export const LONG_RUN_MAX_TICKS = 108_000;

export interface LongRunVerdict {
    keeps_up: boolean;
    /** Ticks in a bin; null when the judged span is compared as a whole (no repeat in whole ticks fits the run) */
    bin_ticks: number | null;
    /** Clock periods in a bin */
    periods_per_bin: number;
    /** Tick of the run the first judged bin starts at */
    first_judged_tick: number;
    /** Items the output inserters dropped in each judged bin */
    judged: number[];
    expected_per_bin: number;
    /** Judged bins more than the tolerance off what a bin expects, by index into `judged` */
    off_bins: { index: number; items: number }[];
    total: number;
    expected_total: number;
    /** The judged span as a whole is further off than the tolerance */
    span_off: boolean;
    /** Items a clock period moved on average over the judged span, rounded */
    output_items_per_period: number;
}

/** Whole ticks after which a build on a clock of this period repeats, or null when no small whole number of periods is whole */
function binOf(period: number, repeat: PeriodRepeat | null): { ticks: number; periods: number } | null {
    if (Number.isInteger(period)) {
        return { ticks: period, periods: 1 };
    }
    return repeat === null ? null : { ticks: repeat.period_ticks, periods: repeat.scale };
}

/**
 * Periods to run so that the part judged, after the first third, holds at least one whole repeat of a fractional
 * period. `base_periods` is kept when it is enough or when the longer run would pass `max_periods` or LONG_RUN_MAX_TICKS:
 * the judged part is then compared as one span (see judgeLongRun).
 *
 * Known limit: one repeat is all that is asked for. A repeat of more than half the judged periods (41 to 79 periods
 * in the usual run of 120, and every repeat the run is lengthened for) is judged as that single repeat, so a
 * drift shows only as that one bin being more than a hand off. No sample has such a repeat.
 */
export function longRunPeriods(period: number, repeat: PeriodRepeat | null, base_periods: number, max_periods: number): number {
    const bin = binOf(period, repeat);
    if (bin === null || bin.periods === 1) {
        return base_periods;
    }
    // two thirds of the run are judged; one more period covers the tick the judged part starts late by
    const needed = Math.ceil(bin.periods * LONG_RUN_SETTLE_SHARE / (LONG_RUN_SETTLE_SHARE - 1)) + 1;
    if (needed <= base_periods) {
        return base_periods;
    }
    return needed <= max_periods && needed * period <= LONG_RUN_MAX_TICKS ? needed : base_periods;
}

/**
 * Judges a long run by what its output inserters dropped.
 *
 * @param held what each output inserter held after each tick of the run; a fall from one tick to the next is a drop
 * @param ticks ticks of the run
 * @param expected_per_period items a clock period is expected to move
 * @param hand the largest hand of an output inserter: a bin, and the judged span as a whole, may be this far off
 */
export function judgeLongRun(
    held: readonly (readonly number[])[],
    ticks: number,
    period: number,
    repeat: PeriodRepeat | null,
    expected_per_period: number,
    hand: number,
): LongRunVerdict {
    const run_periods = Math.floor(ticks / period);
    // the first third of the run carries its start-up; at least the last period is judged
    const settle_periods = Math.min(Math.floor(run_periods / LONG_RUN_SETTLE_SHARE), Math.max(0, run_periods - 1));
    const first_judged_tick = Math.ceil(settle_periods * period - 1e-9);

    const whole = binOf(period, repeat);
    const bin_count = whole === null ? 0 : Math.floor((ticks - first_judged_tick) / whole.ticks);
    // without a whole repeat inside the judged part, the part is compared as one span: the periods run after the
    // settled ones, which the ticks left hold but for the fraction of a tick the run and its start are rounded up by
    const bin = whole !== null && bin_count > 0 ? whole : null;
    const bin_ticks = bin?.ticks ?? ticks - first_judged_tick;
    const periods_per_bin = bin?.periods ?? run_periods - settle_periods;
    const judged = new Array<number>(bin === null ? 1 : bin_count).fill(0);
    for (const series of held) {
        for (let t = Math.max(1, first_judged_tick); t < ticks; t++) {
            if (series[t] < series[t - 1]) {
                const index = Math.floor((t - first_judged_tick) / bin_ticks);
                if (index < judged.length) {
                    judged[index] += series[t - 1] - series[t];
                }
            }
        }
    }

    const expected_per_bin = expected_per_period * periods_per_bin;
    // A span that is no whole repeat is cut at both ends where it falls, through the drops of every output inserter,
    // so it may be a hand of each of them off. Known limit: a cut that falls well hides as much again, so a clock
    // that is short by just under two hands of every output inserter over the span can pass. No sample gets here.
    const tolerance = bin === null ? hand * Math.max(1, held.length) : hand;
    const off_bins = judged.map((items, index) => ({ index, items })).filter(it => Math.abs(it.items - expected_per_bin) > tolerance);
    const total = judged.reduce((sum, items) => sum + items, 0);
    const expected_total = expected_per_bin * judged.length;
    const span_off = Math.abs(total - expected_total) > tolerance;
    const judged_periods = periods_per_bin * judged.length;
    return {
        keeps_up: off_bins.length === 0 && !span_off,
        bin_ticks: bin === null ? null : bin_ticks,
        periods_per_bin,
        first_judged_tick,
        judged,
        expected_per_bin,
        off_bins,
        total,
        expected_total,
        span_off,
        output_items_per_period: judged_periods > 0 ? Math.round(total / judged_periods) : expected_per_period,
    };
}
