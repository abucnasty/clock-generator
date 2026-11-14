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
 * The baseline and the output stock guard, judged from the record (owner, 2026-11-03):
 * - the baseline's whole clock cycles, from the steady-state tick to the last tick in the baseline at which the clock stands where
 *   it stood then, are judged by net output: the final machines' products less the change in their output stock over those
 *   ticks (what leaves them), against the target over those ticks, in whole numbers (net x 60 x d >= n x ticks for the target
 *   n/d a second). No whole cycle in the baseline: it fails (the family names a longer baseline);
 * - the stock guard: the output stock at the end of the run is no lower than the lowest it was at any tick of those cycles.
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
    const first = rowTotals(run, cycles[0]), last = rowTotals(run, cycles[cycles.length - 1]);
    const measuredTicks = cycles[cycles.length - 1].t - steady;
    const items = last.products - first.products;
    const stockStart = first.stock, stockEnd = last.stock;
    const counted = stockStart === null || stockEnd === null;
    const net = counted ? items : items - (stockEnd - stockStart);
    baseline.measured = {ticks: measuredTicks, items, expected: run.expected * measuredTicks / run.window,
        ...(!counted && {stock_start: stockStart, stock_end: stockEnd}), net};
    const [n, d] = rateFraction(target);
    baseline.meets = net * 60 * d >= n * measuredTicks;
    if (counted) return {baseline, stock: null};
    // the lowest output stock at any tick of the baseline's whole cycles: each row holds the lowest since the row before
    const lowest = Math.min(stockStart, ...cycles.slice(1).map(row => row.low ?? Infinity));
    const ended = at("end");
    const endStock = ended ? rowTotals(run, ended).stock : null;
    return {baseline, stock: {lowest, end: endStock, holds: endStock !== null && endStock >= lowest}};
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
    const first = totals(cycles[0]), last = totals(cycles[cycles.length - 1]);
    const ticks = cycles[cycles.length - 1].t - steady;
    const items = last.products - first.products;
    const net = items - (last.stock - first.stock);
    const [n, d] = rateFraction(target);
    return {ticks, items, expected: target * ticks / 60, stock_start: first.stock, stock_end: last.stock, net, meets: net * 60 * d >= n * ticks};
}

module.exports = {judgeBaseline, judgeBaselineOfFinals, runHolds};
