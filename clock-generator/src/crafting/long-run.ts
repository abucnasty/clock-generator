/**
 * How the long run of a clock is counted: what the output inserters drop, in bins of whole ticks that each expect
 * exactly what they are compared with.
 *
 * A whole window cycle is its own bin. A fractional window cycle (90.947 ticks = 1728/19) is not: inserters act on whole ticks,
 * so the build repeats only every `scale` window cycles (1728 ticks), which is also what the subtick clock of its
 * blueprint counts and what a recording of it is cut into. Bins of the rounded-down window cycle (90 ticks) hold less than
 * a window cycle's output (570 of 576), and bins of the true window cycle put a drop that falls on their edge on either side of
 * it from one window cycle to the next, all output inserters at once.
 */

/** A fractional window cycle in whole ticks: `scale` window cycles last `window_cycle_ticks` ticks */
export interface WindowCycleRepeat {
    window_cycle_ticks: number;
    scale: number;
}

/** A first observation covers a complete exported counter; per-period tolerance never excuses missing total output. */
export function judgeCounterSpan(output_items: number, expected_per_window_cycle: number, repeat: WindowCycleRepeat, tolerance_per_window_cycle: number) {
    const expected = expected_per_window_cycle * repeat.scale;
    return {
        holds: output_items >= expected && Math.abs(output_items - expected) <= tolerance_per_window_cycle * repeat.scale,
        output_items_per_window_cycle: output_items / repeat.scale,
        observation_span: { ticks: repeat.window_cycle_ticks, window_cycles: repeat.scale, output_items },
    };
}

/**
 * The judged bins of a sampled long run that make whole repeats of its output: where the items of the bins repeat
 * exactly every L bins over the whole judged span (L at most half of it, so the span shows two repeats), the first
 * whole number of L-bin repeats; else every bin. An output that repeats every L bins moves the same total in any L
 * bins in a row, so a span of whole repeats measures its amount whatever bin it starts at, where a span cut through a
 * repeat may start on its lean bins: three bins of 17, 16 and 15 judged over 80 bins from the 16 move 1279 of 1280.
 * A sample that never repeats in its bins is judged on all of them.
 */
export function wholeOutputRepeats(judged: readonly number[]): { bins: number; total: number } {
    for (let length = 1; length <= judged.length / 2; length++) {
        if (judged.every((items, index) => index < length || items === judged[index - length])) {
            const bins = judged.length - judged.length % length;
            return { bins, total: judged.slice(0, bins).reduce((sum, items) => sum + items, 0) };
        }
    }
    return { bins: judged.length, total: judged.reduce((sum, items) => sum + items, 0) };
}

/** The first 1/n of the long run carries its start-up and is not judged */
export const LONG_RUN_SETTLE_SHARE = 3;
/**
 * The long run is lengthened up to this many ticks: so the judged part holds one whole repeat of a fractional window cycle, and,
 * under the strict target amount, so a sample short by a hand or less can prove its repeat (trial.ts)
 */
export const LONG_RUN_MAX_TICKS = 108_000;

interface LongRunVerdict {
    keeps_up: boolean;
    /** Ticks in a bin; null when the judged span is compared as a whole (no repeat in whole ticks fits the run) */
    bin_ticks: number | null;
    /** Clock window cycles in a bin */
    window_cycles_per_bin: number;
    /** Tick of the run the first judged bin starts at */
    first_judged_tick: number;
    /** Items the output inserters dropped in each judged bin */
    judged: number[];
    expected_per_bin: number;
    /** Items a bin, and the judged span as a whole, may be off what it expects */
    tolerance: number;
    /** Judged bins more than the tolerance off what a bin expects, by index into `judged` */
    off_bins: { index: number; items: number }[];
    total: number;
    expected_total: number;
    /** The judged span as a whole is further off than the tolerance */
    span_off: boolean;
    /** Items a window cycle moved on average over the judged span, not rounded: a reader that prints it rounds it for display */
    output_items_per_window_cycle: number;
}

/** Whole ticks after which a build on a clock of this window cycle repeats, or null when no small whole number of window cycles is whole */
function binOf(window_cycle_ticks: number, repeat: WindowCycleRepeat | null): { ticks: number; window_cycles: number } | null {
    if (Number.isInteger(window_cycle_ticks)) {
        return { ticks: window_cycle_ticks, window_cycles: 1 };
    }
    return repeat === null ? null : { ticks: repeat.window_cycle_ticks, window_cycles: repeat.scale };
}

/**
 * Window cycles to run so that the part judged, after the first third, holds at least one whole repeat of a fractional
 * window cycle. `base_window_cycles` is kept when it is enough or when the longer run would pass `max_window_cycles` or LONG_RUN_MAX_TICKS:
 * the judged part is then compared as one span (see judgeLongRun).
 *
 * Known limit: one repeat is all that is asked for. A repeat of more than half the judged window cycles (41 to 79 window cycles
 * in the usual run of 120, and every repeat the run is lengthened for) is judged as that single repeat, so a
 * drift shows only as that one bin being more than a hand off. No sample has such a repeat.
 */
export function longRunWindowCycles(window_cycle_ticks: number, repeat: WindowCycleRepeat | null, base_window_cycles: number, max_window_cycles: number): number {
    const bin = binOf(window_cycle_ticks, repeat);
    if (bin === null || bin.window_cycles === 1) {
        return base_window_cycles;
    }
    // two thirds of the run are judged; one more window cycle covers the tick the judged part starts late by
    const needed = Math.ceil(bin.window_cycles * LONG_RUN_SETTLE_SHARE / (LONG_RUN_SETTLE_SHARE - 1)) + 1;
    if (needed <= base_window_cycles) {
        return base_window_cycles;
    }
    return needed <= max_window_cycles && needed * window_cycle_ticks <= LONG_RUN_MAX_TICKS ? needed : base_window_cycles;
}

/**
 * Judges a long run that repeats: the state at the boundary of bin `from_bin + cycle_bins` equals the state at
 * `from_bin`, so the bins between them are what the build does forever, and the verdict is a proof, not a sample.
 * Every bin of the cycle has to be within `hand` of what a bin expects, as in judgeLongRun, and the cycle as a whole
 * has to be exactly at its expected output: a cycle off by even one item drifts without bound.
 *
 * @param held what each output inserter held after each tick of the run; a fall from one tick to the next is a drop
 * @param ticks ticks of the run: the repeating boundary's, so the judged bins are exactly the cycle
 */
export function judgeProvenCycle(
    held: readonly (readonly number[])[],
    ticks: number,
    repeat: { bin_ticks: number; window_cycles_per_bin: number; from_bin: number; cycle_bins: number },
    expected_per_window_cycle: number,
    hand: number,
): LongRunVerdict {
    const first_judged_tick = repeat.from_bin * repeat.bin_ticks;
    const judged = new Array<number>(repeat.cycle_bins).fill(0);
    for (const series of held) {
        for (let t = Math.max(1, first_judged_tick); t < ticks; t++) {
            if (series[t] < series[t - 1]) {
                const index = Math.floor((t - first_judged_tick) / repeat.bin_ticks);
                if (index < judged.length) {
                    judged[index] += series[t - 1] - series[t];
                }
            }
        }
    }
    const expected_per_bin = expected_per_window_cycle * repeat.window_cycles_per_bin;
    const off_bins = judged.map((items, index) => ({ index, items })).filter(it => Math.abs(it.items - expected_per_bin) > hand);
    const total = judged.reduce((sum, items) => sum + items, 0);
    const expected_total = expected_per_bin * judged.length;
    // the cycle repeats forever: any shortfall or surplus in it is a drift that never ends
    const span_off = total !== expected_total;
    const judged_window_cycles = repeat.window_cycles_per_bin * judged.length;
    return {
        keeps_up: off_bins.length === 0 && !span_off,
        bin_ticks: repeat.bin_ticks,
        window_cycles_per_bin: repeat.window_cycles_per_bin,
        first_judged_tick,
        judged,
        expected_per_bin,
        tolerance: hand,
        off_bins,
        total,
        expected_total,
        span_off,
        output_items_per_window_cycle: judged_window_cycles > 0 ? total / judged_window_cycles : expected_per_window_cycle,
    };
}

/**
 * Judges a long run by what its output inserters dropped.
 *
 * @param held what each output inserter held after each tick of the run; a fall from one tick to the next is a drop
 * @param ticks ticks of the run
 * @param expected_per_window_cycle items a window cycle is expected to move
 * @param hand the largest hand of an output inserter: a bin, and the judged span as a whole, may be this far off
 */
export function judgeLongRun(
    held: readonly (readonly number[])[],
    ticks: number,
    window_cycle_ticks: number,
    repeat: WindowCycleRepeat | null,
    expected_per_window_cycle: number,
    hand: number,
): LongRunVerdict {
    const run_window_cycles = Math.floor(ticks / window_cycle_ticks);
    // the first third of the run carries its start-up; at least the last window cycle is judged
    const settle_window_cycles = Math.min(Math.floor(run_window_cycles / LONG_RUN_SETTLE_SHARE), Math.max(0, run_window_cycles - 1));
    const first_judged_tick = Math.ceil(settle_window_cycles * window_cycle_ticks - 1e-9);

    const whole = binOf(window_cycle_ticks, repeat);
    const bin_count = whole === null ? 0 : Math.floor((ticks - first_judged_tick) / whole.ticks);
    // without a whole repeat inside the judged part, the part is compared as one span: the window cycles run after the
    // settled ones, which the ticks left hold but for the fraction of a tick the run and its start are rounded up by
    const bin = whole !== null && bin_count > 0 ? whole : null;
    const bin_ticks = bin?.ticks ?? ticks - first_judged_tick;
    const window_cycles_per_bin = bin?.window_cycles ?? run_window_cycles - settle_window_cycles;
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

    const expected_per_bin = expected_per_window_cycle * window_cycles_per_bin;
    // A span that is no whole repeat is cut at both ends where it falls, through the drops of every output inserter,
    // so it may be a hand of each of them off. Known limit: a cut that falls well hides as much again, so a clock
    // that is short by just under two hands of every output inserter over the span can pass. No sample gets here.
    const tolerance = bin === null ? hand * Math.max(1, held.length) : hand;
    const off_bins = judged.map((items, index) => ({ index, items })).filter(it => Math.abs(it.items - expected_per_bin) > tolerance);
    const total = judged.reduce((sum, items) => sum + items, 0);
    const expected_total = expected_per_bin * judged.length;
    const span_off = Math.abs(total - expected_total) > tolerance;
    const judged_window_cycles = window_cycles_per_bin * judged.length;
    return {
        keeps_up: off_bins.length === 0 && !span_off,
        bin_ticks: bin === null ? null : bin_ticks,
        window_cycles_per_bin,
        first_judged_tick,
        judged,
        expected_per_bin,
        tolerance,
        off_bins,
        total,
        expected_total,
        span_off,
        output_items_per_window_cycle: judged_window_cycles > 0 ? total / judged_window_cycles : expected_per_window_cycle,
    };
}

/**
 * The most judged bins whose outputs a reason keeps one by one: the judged part of the usual long run, two thirds of its
 * 120 window cycles (LONG_RUN_SETTLE_SHARE), so that every sampled long run of the usual length keeps them all. A
 * longer judged part (a proven repeat of more bins, or a run made longer) keeps its highest and its lowest bin.
 */
export const OUTPUT_REASON_MAX_BINS = 80;

/** One judged bin: its place in the judged part, from 0, and the items the output inserters dropped in it */
export interface BinOutput {
    at: number;
    items: number;
}

/**
 * The numbers of a long run whose mean output is the expected output while one or more of its bins are off it by more
 * than the tolerance. The items are those the output inserters of the build that the long run simulates dropped: one
 * copy's (the result's rates multiply them by the copies).
 */
export interface OscillationFacts {
    /** Items a bin expects */
    expected: number;
    /** Window cycles in a bin: 1, or the repeat in whole ticks of a fractional window cycle */
    window_cycles_per_bin: number;
    /** Items a bin may be off what it expects */
    tolerance: number;
    /** Bins in the judged part */
    bins: number;
    /** The items of each judged bin, in order; absent where the judged part has more than OUTPUT_REASON_MAX_BINS bins */
    made?: number[];
    /** Where `made` is absent: the highest and the lowest bin (the first of each where several tie) */
    cut?: { highest: BinOutput; lowest: BinOutput };
    /** The judged bins are the proven repeat of the run (see judgeProvenCycle), not a sample */
    proven: boolean;
    /** Window cycles in that repeat; null where the run is a sample */
    repeat_window_cycles: number | null;
}

/**
 * Why the output of a clock is off its expected output where no rate says it, as a code (a closed list) and its numbers:
 * - `oscillation`: the long run failed, its mean output is the expected output, and one or more of its bins are off it by
 *   more than the long run's tolerance.
 */
export type OutputReason = { code: "oscillation"; data: OscillationFacts };

/**
 * The reason of a long run's verdict whose mean output is its expected output, to within `mean_tolerance` items a
 * window cycle, while one or more of its bins are off it by more than its tolerance; undefined for any other verdict (one
 * that keeps up, or whose mean is off). A bin off by more than the tolerance fails the long run, so a verdict with a
 * reason never keeps up. `repeat_window_cycles` is the length of the proven repeat, null for a sample.
 */
export function outputReasonOf(verdict: LongRunVerdict, mean_tolerance: number, repeat_window_cycles: number | null): OutputReason | undefined {
    if (verdict.off_bins.length === 0) return undefined;
    const expected_per_window_cycle = verdict.expected_per_bin / verdict.window_cycles_per_bin;
    if (Math.abs(verdict.output_items_per_window_cycle - expected_per_window_cycle) > mean_tolerance) return undefined;
    const bins = verdict.judged.length;
    const facts: OscillationFacts = { expected: verdict.expected_per_bin, window_cycles_per_bin: verdict.window_cycles_per_bin, tolerance: verdict.tolerance,
        bins, proven: repeat_window_cycles !== null, repeat_window_cycles };
    if (bins <= OUTPUT_REASON_MAX_BINS) return { code: "oscillation", data: { ...facts, made: [...verdict.judged] } };
    let highest = 0, lowest = 0;
    verdict.judged.forEach((items, index) => {
        if (items > verdict.judged[highest]) highest = index;
        if (items < verdict.judged[lowest]) lowest = index;
    });
    return { code: "oscillation", data: { ...facts, cut: { highest: { at: highest, items: verdict.judged[highest] }, lowest: { at: lowest, items: verdict.judged[lowest] } } } };
}
