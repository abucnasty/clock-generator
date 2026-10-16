/**
 * A machine's true craft starts, read from what the inserter cost series' extractor dumps hold of it. A port of the
 * series' method (factorio-benchmarks, benchmarks/2026-10-12-inserter-cost-2.1.21,
 * closing/evidence/productivity-recount-1/common.py: `true_events` with `_simulate`, and `truth` of recording_check.py),
 * with its default rule for a craft of a tick or less ("fixed"), and nothing of its other two.
 *
 * Why it is needed. A dump holds, per tick, the machine's status and its `products_finished`. `products_finished`
 * rises when a craft finishes AND when a productivity payout is made, so a rise alone does not tell a craft from a
 * payout, and the status turning to working does not tell a start when the machine goes on working from one craft to
 * the next. A machine's crafting progress is deterministic, though: a tick of work adds `delta = crafting_speed / (60 *
 * recipe energy)`, and a craft is finished when the progress reaches 1, which pays out at once (a rise of
 * `products_finished`) and starts the next craft when ingredients allow:
 * - a start from rest (the status turns to working from shortage, full output, disabled and so on): the progress is
 *   `delta` after the tick;
 * - while working on both samples: the progress adds `delta`, and crossing 1 finishes a craft and starts the next.
 * The one unknown is the phase of a craft already running on the first sample. It is fitted over the first run of
 * working ticks: every finish the progress predicts must show as a rise, and a rise of 2 or more on a tick of steady
 * work holds a craft when at most one payout a tick is possible (`delta * pb < 1`). A finish predicted a tick away
 * from a rise (a float rounding at an exact integer) is moved to the neighbouring rise, which is counted as a
 * `resync`; one with no rise to move to is a `miss`.
 *
 * Index `t` is sample `t` of a dump; index 0 never holds a start, since a start needs the sample before it.
 */

/** The game's `defines.entity_status` values of a machine the method tells apart */
export const STATUS_WORKING = 1;
export const STATUS_FULL_OUTPUT = 29;

/** The slack at which a progress reaching 1 counts as finished, as float arithmetic leaves exact integers a hair under */
const EPSILON = 1e-7;
/** The phase fit looks at no more than this many ticks of the first working run in its coarse stage */
const COARSE_TICKS = 3000;
/** Step of the coarse stage over the phase, and half the window around each minimum in the fine stage */
const COARSE_STEP = 1e-4;
const FINE_STEP = 2e-6;
/** A coarse stage with more minima than this is weakly constrained (few ticks that are not rises): it is not refined */
const MAX_COARSE_MINIMA = 400;
/** Phases of the fine stage closer than this make one interval of feasible phases; the coarse stage's, this */
const FINE_GAP = 3e-6;
const COARSE_GAP = 1.5e-4;
/** No more candidate phases than this are simulated; more are thinned evenly */
const MAX_CANDIDATES = 20;
/** A resync costs one and a miss this many, when tied phases are compared */
const MISS_COST = 3;

/** What the fit and the simulation found, for the record */
export interface TrueStartsDiagnostics {
    /** Finishes the progress put a tick away from the rise of `products_finished`, moved to the rise (float rounding) */
    resync: number;
    /** Finishes the progress predicted where no rise of `products_finished` is near */
    miss: number;
    /** Candidate phases of the craft running on the first sample (distinct finish ticks that fit equally), 0 when none */
    phase_ties: number;
    /** Finishes missing a rise, plus rises of 2 or more not explained, that the best phase leaves over the first working run */
    phase_viol: number;
    /** Phases simulated: the candidates, 1 when the first sample is not working (and 0 for a craft of a tick or less) */
    phase_runs: number;
    /** Present, as 1, when the phase was fitted on the coarse stage only (weakly constrained) */
    phase_coarse?: number;
}

export interface TrueStarts {
    /** A craft began on the tick (its ingredients were consumed), per index; index 0 is false */
    start: boolean[];
    /** A craft finished on the tick (a rise of `products_finished` that holds a craft, not a payout alone), per index */
    craft_out: boolean[];
    diag: TrueStartsDiagnostics;
}

/**
 * numpy's `np.arange(start, stop, step)` of floats, value for value: its length is the ceiling of
 * `(stop - start) / step`, its second value `start + step`, and the rest `start + i * ((start + step) - start)`.
 */
function arange(start: number, stop: number, step: number): number[] {
    const length = Math.ceil((stop - start) / step);
    const values: number[] = [];
    if (length <= 0) {
        return values;
    }
    values.push(start);
    if (length > 1) {
        values.push(start + step);
    }
    const delta = length > 1 ? values[1] - start : 0;
    for (let i = 2; i < length; i++) {
        values.push(start + i * delta);
    }
    return values;
}

/** numpy's `x % 1.0` of floats: the fraction, never negative */
function modOne(x: number): number {
    const r = x % 1;
    return r !== 0 && r < 0 ? r + 1 : r;
}

/** The sorted distinct values */
function uniqueSorted(values: number[]): number[] {
    const sorted = Float64Array.from(values).sort();
    const out: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i === 0 || sorted[i] !== sorted[i - 1]) {
            out.push(sorted[i]);
        }
    }
    return out;
}

/**
 * The violations of each phase over the first `length` ticks of a run of work: ticks the progress finishes a craft on
 * (the whole part of `phase + delta * t` grows) that show no rise, and, where `two` holds, ticks that hold a craft by a
 * rise of 2 or more that the progress does not finish.
 */
function violations(
    phases: readonly number[], length: number, delta: number, rise: readonly boolean[], two: readonly boolean[],
): number[] {
    return phases.map(phase => {
        let count = 0;
        let previous = Math.floor(phase + delta * 0 + EPSILON);
        for (let t = 1; t < length; t++) {
            const current = Math.floor(phase + delta * t + EPSILON);
            const wrapped = current > previous;
            previous = current;
            if (wrapped && !rise[t]) {
                count++;
            }
            if (two[t] && !wrapped) {
                count++;
            }
        }
        return count;
    });
}

/** The smallest of a list that is not empty */
function minimum(values: readonly number[]): number {
    let smallest = values[0];
    for (const value of values) {
        smallest = Math.min(smallest, value);
    }
    return smallest;
}

/** The progress of one phase simulated over the whole dump: the starts, the crafts out, and what had to be resynced */
function simulate(
    phase: number, statuses: ArrayLike<number>, working: readonly boolean[], work2: readonly boolean[],
    from_rest: readonly boolean[], rise: readonly boolean[], delta: number, n: number,
): { start: boolean[]; craft_out: boolean[]; resync: number; miss: number } {
    const start = new Array<boolean>(n).fill(false);
    const craft_out = new Array<boolean>(n).fill(false);
    let resync = 0;
    let miss = 0;
    let progress = phase;
    // a craft that finished as the machine left work with its output held: it is paid out on the resume
    let pending = statuses[0] === STATUS_FULL_OUTPUT && phase >= 1 - EPSILON;
    for (let t = 1; t < n; t++) {
        if (from_rest[t]) {
            start[t] = true;
            progress = delta;
            if (rise[t] && pending) {
                craft_out[t] = true;
            }
            pending = false;
            continue;
        }
        if (work2[t]) {
            progress += delta;
            if (progress >= 1 - EPSILON) {
                if (rise[t]) {
                    craft_out[t] = true;
                    start[t] = true;
                    progress -= 1;
                } else if (t + 1 < n && rise[t + 1] && work2[t + 1]) {
                    // the finish lands a tick later (rounding at an exact integer)
                    progress -= delta;
                    resync++;
                } else if (rise[t - 1] && !start[t - 1] && !from_rest[t - 1]) {
                    start[t - 1] = true;
                    craft_out[t - 1] = true;
                    progress -= 1;
                    resync++;
                } else {
                    craft_out[t] = true;
                    start[t] = true;
                    progress -= 1;
                    miss++;
                }
                if (progress < 0) {
                    progress = 0.0;
                }
            }
            continue;
        }
        if (working[t - 1] && !working[t]) {
            // leaving work: a craft may finish on this tick without a new start
            progress += delta;
            if (progress >= 1 - EPSILON) {
                if (rise[t]) {
                    craft_out[t] = true;
                } else {
                    pending = true;
                }
            }
            progress = 0.0;
        }
    }
    return { start, craft_out, resync, miss };
}

/**
 * The phase of the craft running on the first sample, and the candidates the fit leaves: the middle of each interval of
 * phases (at most `MAX_CANDIDATES`, thinned evenly) that violate the rises least. A coarse stage over the phase finds
 * the minima; when they are few enough a fine stage around each of them refines them.
 */
function fitPhase(
    length: number, delta: number, rise: readonly boolean[], two: readonly boolean[], diag: TrueStartsDiagnostics,
): number[] {
    const coarse = arange(0, 1, COARSE_STEP);
    const coarse_violations = violations(coarse, Math.min(length, COARSE_TICKS), delta, rise, two);
    const coarse_best = minimum(coarse_violations);
    const minima = coarse.filter((_, i) => coarse_violations[i] === coarse_best);
    let best: number[];
    let gap: number;
    if (minima.length <= MAX_COARSE_MINIMA) {
        const around: number[] = [];
        for (const x of minima) {
            around.push(...arange(x - COARSE_STEP, x + COARSE_STEP, FINE_STEP));
        }
        const fine = uniqueSorted(around).map(modOne);
        const fine_violations = violations(fine, length, delta, rise, two);
        const fine_best = minimum(fine_violations);
        best = fine.filter((_, i) => fine_violations[i] === fine_best);
        gap = FINE_GAP;
        diag.phase_viol = fine_best;
    } else {
        // weakly constrained (few ticks that are not rises): coarse intervals only, flagged
        best = minima;
        gap = COARSE_GAP;
        diag.phase_viol = coarse_best;
        diag.phase_coarse = 1;
    }
    // contiguous feasible intervals: the middle of each is a candidate
    best = Array.from(Float64Array.from(best).sort());
    let groups: number[][] = [];
    let current: number[] = [];
    for (let i = 0; i < best.length; i++) {
        if (i > 0 && best[i] - best[i - 1] > gap) {
            groups.push(current);
            current = [];
        }
        current.push(best[i]);
    }
    groups.push(current);
    if (groups.length > MAX_CANDIDATES) {
        // numpy's np.linspace(0, len - 1, 20).astype(int)
        const step = (groups.length - 1) / (MAX_CANDIDATES - 1);
        const picked = groups;
        groups = [];
        for (let i = 0; i < MAX_CANDIDATES; i++) {
            groups.push(picked[Math.trunc(i === MAX_CANDIDATES - 1 ? picked.length - 1 : i * step)]);
        }
    }
    diag.phase_ties = groups.length;
    return groups.map(g => (g[0] + g[g.length - 1]) / 2);
}

/**
 * The true starts of a machine from its status codes and its `products_finished`, one value each for the `n` samples
 * of a dump (`true_events` of the series' common.py, rule "fixed" for the machines whose craft takes a tick or less).
 *
 * @param status_codes the machine's `defines.entity_status` per sample; only working (1) and full output (29) are read
 * @param products_finished the machine's `products_finished` per sample: crafts and productivity payouts
 * @param delta the crafting progress a working tick adds: crafting speed / (60 * recipe energy)
 * @param pb the productivity bonus (the entity's effects plus the recipe's, capped at the recipe's maximum)
 * @param n the number of samples
 *
 * - A craft of a tick or less (`delta >= 1`): a craft starts on every tick the machine shows working, and on every rise
 *   not preceded by a working sample (a craft begun and finished inside the tick, between two full-output samples).
 *   Every rise holds a craft.
 * - A shorter one: the progress is simulated from the first sample. When that is working, its phase is fitted (see the
 *   top of this file); the candidates that tie are all simulated and the one with the fewest resyncs plus three times
 *   the misses is kept, the first on a tie.
 */
export function trueStartsOfDump(
    status_codes: ArrayLike<number>, products_finished: ArrayLike<number>, delta: number, pb: number, n: number,
): TrueStarts {
    const rise = new Array<boolean>(n).fill(false);
    const step = new Array<number>(n).fill(0);
    const working = new Array<boolean>(n);
    for (let t = 0; t < n; t++) {
        working[t] = status_codes[t] === STATUS_WORKING;
        if (t >= 1) {
            rise[t] = products_finished[t] > products_finished[t - 1];
            step[t] = products_finished[t] - products_finished[t - 1];
        }
    }
    // working on both samples: progress added; working on this one only: a start from rest
    const work2 = new Array<boolean>(n).fill(false);
    const from_rest = new Array<boolean>(n).fill(false);
    for (let t = 1; t < n; t++) {
        work2[t] = working[t] && working[t - 1];
        from_rest[t] = working[t] && !working[t - 1];
    }
    const diag: TrueStartsDiagnostics = { resync: 0, miss: 0, phase_ties: 0, phase_viol: 0, phase_runs: 0 };
    if (delta >= 1) {
        const start = new Array<boolean>(n).fill(false);
        for (let t = 1; t < n; t++) {
            start[t] = working[t] || (rise[t] && !working[t - 1]);
        }
        const craft_out = rise.slice();
        craft_out[0] = false;
        return { start, craft_out, diag };
    }
    let candidates = [0.0];
    if (working[0]) {
        // the phase of a craft running on sample 0: fitted over the first working run
        let length = 1;
        while (length < n && work2[length]) {
            length++;
        }
        const two = work2.map((steady, t) => delta * pb < 1 && step[t] >= 2 && steady);
        candidates = fitPhase(length, delta, rise, two, diag);
    }
    let best: { score: number; run: ReturnType<typeof simulate> } | null = null;
    for (const phase of candidates) {
        // tied phases (distinct finish ticks): keep the one the whole dump fits best
        const run = simulate(phase, status_codes, working, work2, from_rest, rise, delta, n);
        const score = run.resync + MISS_COST * run.miss;
        if (best === null || score < best.score) {
            best = { score, run };
        }
    }
    diag.resync = best!.run.resync;
    diag.miss = best!.run.miss;
    diag.phase_runs = candidates.length;
    return { start: best!.run.start, craft_out: best!.run.craft_out, diag };
}

/**
 * The true starts read from a machine's crafting progress, which a recording of the game logs every tick (`truth` of the
 * series' recording_check.py). With a craft of a tick or less (`delta >= 1`) the progress left strictly between 0 and 1
 * after a tick means a craft began in it. Otherwise it is a start from rest (the progress was 0 or the craft was pending
 * at 1 and is now strictly between) or a wrap while working (the progress fell).
 */
export function trueStartsOfProgress(crafting_progress: ArrayLike<number>, delta: number, n: number): boolean[] {
    const start = new Array<boolean>(n).fill(false);
    for (let t = 1; t < n; t++) {
        const inside = crafting_progress[t] > 0 && crafting_progress[t] < 1;
        if (delta >= 1) {
            start[t] = inside;
        } else {
            const before = crafting_progress[t - 1];
            start[t] = inside && (crafting_progress[t] < before || before === 0 || before >= 1);
        }
    }
    return start;
}
