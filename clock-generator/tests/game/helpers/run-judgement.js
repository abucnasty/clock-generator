// @ts-check
// The judgement of a game run under the protocol timed in game ticks. helpers/lua/steady.lua records (per final machine, the
// products finished and the output stock, every 60 ticks and at every tick of a whole clock cycle from steady state on, and at
// each step of the run); this module judges that record. The game tests (tests/game/builds/clock-controls.ts) and the scripts
// that start the game for a check (scripts/game-run.js) use it alike, so a rule that only judges differently needs no new
// recording: change it here.

/**
 * @typedef {{t: number, p: number[], s?: number[], low?: number, at?: string}} SeriesRow
 * @typedef {{judged_by: "finals" | "count", seconds: SeriesRow[], cycles: SeriesRow[], marks: SeriesRow[]}} RunSeries
 * @typedef {{kind: string, start: number, drop?: number, release?: number, recovered?: number}} Disturbance
 * @typedef {{
 *   window: number, expected: number, steady?: number, result?: string, ended?: number, error?: string,
 *   baseline?: {start: number, ticks: number, min: number, max: number},
 *   disturbances: Disturbance[] | Record<string, never>,
 *   tail?: {from: number, ticks: number},
 *   finals?: {unit_number: number, recipe: string, worth: number}[] | Record<string, never>,
 *   series?: RunSeries,
 * }} RunRecord
 */

/**
 * Lua writes an empty table as {}: an empty list
 * @template T
 * @param {T[] | Record<string, never> | undefined} value
 * @returns {T[]}
 */
function list(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * A rate as a fraction of whole numbers (the closest with a denominator of at most a million: 480 x 2/7 is 960/7)
 * @param {number} rate
 * @returns {[number, number]}
 */
function rateFraction(rate) {
    let [h0, h1, k0, k1, x] = [0, 1, 1, 0, rate];
    for (let i = 0; i < 64; i++) {
        const a = Math.floor(x);
        const [h2, k2] = [a * h1 + h0, a * k1 + k0];
        if (k2 > 1_000_000) break;
        [h0, h1, k0, k1] = [h1, h2, k1, k2];
        if (Math.abs(h1 / k1 - rate) < 1e-12 * Math.max(1, rate) || x === a) break;
        x = 1 / (x - a);
    }
    return [h1, k1];
}

/**
 * The products of a row (each final machine's products finished times what one is worth in the target item; a count as it is)
 * and its total output stock (null for a build judged by a count)
 * @param {RunRecord} run
 * @param {SeriesRow} row
 */
function rowTotals(run, row) {
    const finals = list(run.finals);
    const products = run.series?.judged_by === "count" ? list(row.p)[0] ?? 0
        : list(row.p).reduce((sum, finished, k) => sum + finished * finals[k].worth, 0);
    const stock = run.series?.judged_by === "count" || row.s === undefined ? null : list(row.s).reduce((sum, value) => sum + value, 0);
    return {products, stock};
}

/**
 * What each final machine put out in each clock cycle of `rows` (the rows of series.cycles from the steady-state tick on): its
 * products times what one is worth, less the stock it gained. A build judged by a count has the count alone.
 * @param {RunRecord} run
 * @param {SeriesRow[]} rows
 * @returns {number[][]} one list a cycle, one number a final machine
 */
function cycleOutputs(run, rows) {
    const finals = list(run.finals);
    const counted = run.series?.judged_by === "count";
    return rows.slice(1).map((row, i) => {
        const before = rows[i];
        if (counted) return [(list(row.p)[0] ?? 0) - (list(before.p)[0] ?? 0)];
        return list(row.p).map((made, k) => (made - list(before.p)[k]) * finals[k].worth - ((list(row.s)[k] ?? 0) - (list(before.s)[k] ?? 0)));
    });
}

/**
 * The rows of the baseline's whole clock cycles cut to a whole number of the run's repeat (abucnasty, 2026-11-18). The repeat is the
 * smallest number r of clock cycles after which what every final machine puts out in a cycle (cycleOutputs) is the same again,
 * over all the cycles of the baseline, and seen at least twice (2 x r cycles or fewer). A hand in transit at the end of a cycle
 * moves its product to the next cycle, so a clock whose output inserters drop 96 a cycle on average can drop 88, 102 and 98 in
 * three cycles: a span of 16 such cycles has one repeat and one cycle over, and reads 16 short. No repeat that fits twice: all the
 * rows (the run's own cycles are the repeat, as before the rule).
 * @param {RunRecord} run
 * @param {SeriesRow[]} rows the rows of the whole cycles, the steady-state tick first
 * @returns {{rows: SeriesRow[], repeat: number | null}} `repeat` is set only where the cut dropped cycles
 */
function wholeRepeats(run, rows) {
    const outputs = cycleOutputs(run, rows);
    const r = smallestRepeat(outputs);
    if (r === null) return {rows, repeat: null};
    const kept = Math.floor(outputs.length / r) * r;
    return kept === outputs.length ? {rows, repeat: null} : {rows: rows.slice(0, kept + 1), repeat: r};
}

/**
 * The smallest number r of cycles after which what every final machine puts out in a cycle is the same again, over all the cycles
 * given, and seen at least twice (2 x r cycles or fewer): the cycle r later is the same one, in each of the cycles that has one
 * @param {number[][]} outputs one list a cycle, one number a final machine
 * @returns {number | null} null where no repeat fits twice
 */
function smallestRepeat(outputs) {
    const same = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.length === b.length && a.every((value, k) => Math.abs(value - b[k]) < 1e-9);
    for (let r = 1; 2 * r <= outputs.length; r++) {
        if (outputs.every((cycle, i) => i + r >= outputs.length || same(cycle, outputs[i + r]))) return r;
    }
    return null;
}

/**
 * The baseline and the output stock guard, judged from the record (abucnasty, 2026-11-03):
 * - the baseline's whole clock cycles, from the steady-state tick to the last tick in the baseline at which the clock stands where
 *   it stood then, are judged by net output: the final machines' products less the change in their output stock over those
 *   ticks (what leaves them), against the target over those ticks, in whole numbers (net x 60 x d >= n x ticks for the target
 *   n/d a second). No whole cycle in the baseline: it fails (the family names a longer baseline);
 * - a whole number of the run's repeat (abucnasty, 2026-11-18): where what each final machine puts out in a clock cycle repeats every r cycles
 *   (see wholeRepeats), the net output is judged over the last whole number of repeats of those cycles, so a hand in transit at the
 *   end of a part of a repeat is not counted as lost. No repeat seen, or one that fits the cycles exactly: all the whole cycles;
 * - the stock guard: the output stock at the end of the run is no lower than the lowest it was at any tick of those cycles.
 *   A run that asked for a tail (steady.lua `tail`: it goes on after its last recovery) is judged by the stock after settling
 *   instead (judgeStockAfterTail): the stock a disturbance leaves is read once it has settled, not at the tick of the recovery
 *   (abucnasty, 2026-11-03; #587: the guard compares levels that follow the same disturbance). A run with no tail, and every
 *   summary recorded before the tail, is judged as before.
 * A build judged by a count has no output stock: its net output is the count, and the guard does not apply (stock null).
 * @param {RunRecord} run
 * @param {number} target products a second, as exact as known (the fraction is taken of it)
 */
function judgeBaseline(run, target) {
    const recorded = run.baseline;
    const series = run.series;
    if (!recorded || run.steady === undefined || !series) return {baseline: null, stock: null};
    const steady = run.steady;
    const marks = list(series.marks);
    const at = (/** @type {string} */ name) => marks.find(mark => mark.at === name);
    const start = at("steady"), end = at("baseline end");
    const ticks = recorded.ticks;
    /** @type {import("../builds/clock-controls").NativeBaseline} */
    const baseline = {
        ticks,
        total: start && end ? rowTotals(run, end).products - rowTotals(run, start).products : 0,
        expected: run.expected * ticks / run.window,
        min: recorded.min, max: recorded.max,
        held: recorded.min >= run.expected,
        meets: false,
    };
    const cycles = list(series.cycles).filter(row => row.t >= steady && row.t <= steady + ticks);
    if (cycles.length < 2 || cycles[0].t !== steady) return {baseline, stock: null};
    const {rows: whole, repeat} = wholeRepeats(run, cycles);
    const first = rowTotals(run, whole[0]), last = rowTotals(run, whole[whole.length - 1]);
    const measuredTicks = whole[whole.length - 1].t - steady;
    const items = last.products - first.products;
    const stockStart = first.stock, stockEnd = last.stock;
    const counted = stockStart === null || stockEnd === null;
    const net = counted ? items : items - (stockEnd - stockStart);
    baseline.measured = {ticks: measuredTicks, items, expected: run.expected * measuredTicks / run.window,
        ...(!counted && {stock_start: stockStart, stock_end: stockEnd}), net, ...(repeat !== null && {repeat_cycles: repeat})};
    const [n, d] = rateFraction(target);
    baseline.meets = net * 60 * d >= n * measuredTicks;
    if (counted) return {baseline, stock: null};
    // the lowest output stock at any tick of all the baseline's whole cycles (not only the whole repeats): each row holds the lowest since the row before
    const lowest = Math.min(stockStart, ...cycles.slice(1).map(row => row.low ?? Infinity));
    const ended = at("end");
    const endStock = ended ? rowTotals(run, ended).stock : null;
    if (run.tail) {
        const after = judgeStockAfterTail(run, run.tail, lowest);
        return {baseline, stock: {lowest, end: endStock, holds: endStock !== null && after.settled !== null && after.settled.holds, after}};
    }
    return {baseline, stock: {lowest, end: endStock, holds: endStock !== null && endStock >= lowest}};
}

/**
 * The output stock after the last recovery, from the run's tail (steady.lua): at each whole clock cycle the total stock and the
 * lowest it was at any tick since the cycle before, from the tick of the last recovery on. What the last disturbance leaves
 * takes a while to settle (a dip, then a climb back to a level), so the level is read in the last half of the tail only (which can start
 * before the stock has stopped climbing; a climb is no fall). It holds
 * when, there, the stock is never below the baseline's lowest at any tick (the same measure the baseline's lowest is) and is not
 * falling (no lower at the last whole cycle than at the first of those): a slow drain never settles and fails. No cycle there (the
 * run ended before the tail did): no settled level, and the guard fails.
 * @param {RunRecord} run
 * @param {{from: number, ticks: number}} tail
 * @param {number} lowest the lowest output stock at any tick of the baseline's whole cycles
 * @returns {{from: number, t: number[], stock: number[], low: number[], settled: null | {from: number, lowest: number, last: number, falling: boolean, holds: boolean}}}
 */
function judgeStockAfterTail(run, tail, lowest) {
    const rows = list(run.series?.cycles).filter(row => row.t >= tail.from && row.s !== undefined);
    const totals = rows.map(row => rowTotals(run, row).stock ?? 0);
    const lows = rows.map((row, k) => row.low ?? totals[k]);
    const readFrom = tail.from + tail.ticks / 2;
    const first = rows.findIndex(row => row.t >= readFrom);
    const kept = {from: tail.from, t: rows.map(row => row.t), stock: totals, low: lows};
    if (first < 0) return {...kept, settled: null};
    const read = lows.slice(first), level = Math.min(...read);
    const falling = totals[totals.length - 1] < totals[first];
    return {...kept, settled: {from: rows[first].t, lowest: level, last: totals[totals.length - 1], falling, holds: level >= lowest && !falling}};
}

/**
 * Whether a run summary shows the clock holding its target and recovering from every disturbance it ran, with its output
 * stock no lower at the end than in the baseline (where it has one)
 * @param {{result: string, baseline: {meets: boolean} | null, disturbances: Disturbance[], stock: {holds: boolean} | null}} native
 */
function runHolds(native) {
    return native.result === "holds" && native.baseline?.meets === true
        && native.disturbances.every(disturbance => disturbance.recovered !== undefined)
        && (native.stock === null || native.stock?.holds === true);
}

/**
 * The baseline's whole clock cycles judged as judgeBaseline judges them, for some of the final machines only (a copy of a build of
 * several): their products less the change in their output stock, against their own target. No stock guard: the lowest stock
 * the record keeps is the whole build's. Null where judgeBaseline has no whole cycle to judge, or for a build judged by a count.
 * @param {RunRecord} run
 * @param {number} target products a second of these final machines, as exact as known
 * @param {number[]} indices the final machines, as places in `run.finals`
 */
function judgeBaselineOfFinals(run, target, indices) {
    const series = run.series, recorded = run.baseline;
    if (!recorded || run.steady === undefined || !series || series.judged_by === "count") return null;
    const steady = run.steady;
    const cycles = list(series.cycles).filter(row => row.t >= steady && row.t <= steady + recorded.ticks);
    if (cycles.length < 2 || cycles[0].t !== steady) return null;
    const finals = list(run.finals);
    const totals = (/** @type {SeriesRow} */ row) => ({
        products: indices.reduce((sum, k) => sum + list(row.p)[k] * finals[k].worth, 0),
        stock: indices.reduce((sum, k) => sum + (list(row.s)[k] ?? 0), 0),
    });
    // the same whole repeats as judgeBaseline's, found from all the final machines of the build
    const {rows: whole, repeat} = wholeRepeats(run, cycles);
    const first = totals(whole[0]), last = totals(whole[whole.length - 1]);
    const ticks = whole[whole.length - 1].t - steady;
    const items = last.products - first.products;
    const net = items - (last.stock - first.stock);
    const [n, d] = rateFraction(target);
    return {ticks, items, expected: target * ticks / 60, stock_start: first.stock, stock_end: last.stock, net, meets: net * 60 * d >= n * ticks,
        ...(repeat !== null && {repeat_cycles: repeat})};
}

/**
 * What a copy of a build puts out after the last loss, judged from the rows of the run's tail (the missing-recordings probe: one row
 * for each whole clock cycle from the tick of the last recovery on, products and output stock of every final machine): the
 * products of the copy's final machines less the stock they gained, in each whole clock cycle of the last `ticks` of the tail (at
 * least two rows: one cycle), against the copy's target. A cycle that falls short is listed. Judged over a whole number of the run's
 * repeat (decision 1057): see below.
 * @param {{worth: number}[]} finals every final machine of the run
 * @param {SeriesRow[]} tail the rows of the tail, the oldest first
 * @param {number[]} indices the copy's final machines, as places in `finals`
 * @param {number} target products a second of this copy
 * @param {number} ticks how much of the tail's end is judged (a minute: the protocol's)
 */
function judgeAfterLoss(finals, tail, indices, target, ticks = 3600) {
    const tailEnd = tail.length > 0 ? tail[tail.length - 1].t : 0;
    // the whole clock cycles of at least `ticks`: a clock cycle longer than that is judged as the one cycle that ends the run
    const lastMinute = tail.filter(row => row.t >= tailEnd - ticks);
    const rows = lastMinute.length >= 2 ? lastMinute : tail.slice(-2);
    const perTick = target / 60;
    const net = (/** @type {SeriesRow} */ from, /** @type {SeriesRow} */ to) => indices.reduce((sum, k) =>
        sum + (list(to.p)[k] - list(from.p)[k]) * finals[k].worth - ((list(to.s)[k] ?? 0) - (list(from.s)[k] ?? 0)), 0);
    const cycles = [];
    for (let i = 1; i < rows.length; i++) {
        const span = rows[i].t - rows[i - 1].t;
        cycles.push({t: rows[i - 1].t, ticks: span, net: net(rows[i - 1], rows[i]), expected: perTick * span});
    }
    // a whole number of the run's repeat (decision 1057, as the baseline's, wholeRepeats): where what each final machine of the copy puts out
    // in a clock cycle repeats every r > 1 cycles, seen twice in these cycles, a hand that ends a cycle early reads short in one cycle of the
    // repeat and long in the next, so the repeat is judged as a whole against r cycles of target. The last whole repeats are judged: the
    // cycles before them, where the copy may still be settling, are left. No repeat seen twice (or one cycle long): each cycle, as before
    const outputs = rows.slice(1).map((row, i) => indices.map(k => (list(row.p)[k] - list(rows[i].p)[k]) * finals[k].worth - ((list(row.s)[k] ?? 0) - (list(rows[i].s)[k] ?? 0))));
    const repeat = smallestRepeat(outputs);
    let judged = cycles;
    if (repeat !== null && repeat > 1) {
        const kept = cycles.slice(cycles.length - Math.floor(cycles.length / repeat) * repeat);
        judged = Array.from({length: kept.length / repeat}, (_, n) => {
            const part = kept.slice(n * repeat, (n + 1) * repeat);
            return {t: part[0].t, ticks: part.reduce((sum, it) => sum + it.ticks, 0), net: part.reduce((sum, it) => sum + it.net, 0), expected: part.reduce((sum, it) => sum + it.expected, 0)};
        });
    }
    const short = judged.filter(cycle => cycle.net < cycle.expected - 1e-6);
    const total = {net: judged.reduce((sum, it) => sum + it.net, 0), expected: judged.reduce((sum, it) => sum + it.expected, 0)};
    return {cycles: judged, short, total, ...(repeat !== null && repeat > 1 && {repeat_cycles: repeat})};
}

module.exports = {judgeBaseline, judgeBaselineOfFinals, judgeAfterLoss, runHolds};
