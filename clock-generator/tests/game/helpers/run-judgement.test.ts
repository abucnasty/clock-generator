import {describe, expect, it} from "vitest";
import {judgeBaseline, judgeBaselineOfFinals, runHolds} from "./run-judgement";

// one final machine worth 1 a product, 10 products a 60-tick cycle (10 a second), steady state at tick 3,600, a baseline of
// 3,600 ticks: 60 whole cycles, then the end of the run at 7,200
function record(made: (cycle: number) => number, stock: (cycle: number) => number, endStock: number, low = (cycle: number) => stock(cycle)) {
    const cycles = Array.from({length: 61}, (_, k) => ({t: 3600 + 60 * k, p: [made(k)], s: [stock(k)], low: low(k)}));
    return {
        window: 3600, expected: 600, steady: 3600, result: "holds", ended: 7200,
        baseline: {start: 3600, ticks: 3600, min: 600, max: 600},
        disturbances: [],
        finals: [{unit_number: 1, recipe: "r", worth: 1}],
        series: {judged_by: "finals" as const, seconds: [], cycles, marks: [
            {t: 3600, at: "steady", p: [made(0)], s: [stock(0)]},
            {t: 7200, at: "baseline end", p: [made(60)], s: [stock(60)]},
            {t: 7200, at: "end", p: [made(60)], s: [endStock]},
        ]},
    };
}

describe("judgeBaseline", () => {
    it("judges the whole cycles by net output: products less the stock gained", () => {
        // 601 made, 1 of them still in the machine's output: 600 left it
        const {baseline, stock} = judgeBaseline(record(k => k * 10 + (k === 60 ? 1 : 0), k => 5 + (k === 60 ? 1 : 0), 6), 10);
        expect(baseline?.measured).toEqual({ticks: 3600, items: 601, expected: 600, stock_start: 5, stock_end: 6, net: 600});
        expect(baseline?.meets).toBe(true);
        expect(stock).toEqual({lowest: 5, end: 6, holds: true});
    });

    it("fails a baseline one product short of the target", () => {
        const {baseline} = judgeBaseline(record(k => k * 10 - (k === 60 ? 1 : 0), () => 5, 5), 10);
        expect(baseline?.measured?.net).toBe(599);
        expect(baseline?.meets).toBe(false);
    });

    it("fails a baseline whose output stock grew by what is missing from what left the machines", () => {
        // 600 made, one of them kept in the output stock: 599 left
        const {baseline} = judgeBaseline(record(k => k * 10, k => 5 + (k === 60 ? 1 : 0), 6), 10);
        expect(baseline?.measured?.net).toBe(599);
        expect(baseline?.meets).toBe(false);
    });

    it("fails the stock guard when the run ends below the baseline's lowest stock, seen at any tick", () => {
        const {stock} = judgeBaseline(record(k => k * 10, () => 5, 3, k => k === 30 ? 4 : 5), 10);
        expect(stock).toEqual({lowest: 4, end: 3, holds: false});
        expect(runHolds({result: "holds", baseline: {meets: true}, disturbances: [], stock: stock!})).toBe(false);
    });

    it("has no guard for a build judged by a count", () => {
        const run = record(k => k * 10, () => 0, 0);
        const counted = {...run, finals: [], series: {...run.series, judged_by: "count" as const,
            cycles: run.series.cycles.map(({t, p}) => ({t, p})), marks: run.series.marks.map(({t, at, p}) => ({t, at, p}))}};
        const {baseline, stock} = judgeBaseline(counted, 10);
        expect(baseline?.measured).toEqual({ticks: 3600, items: 600, expected: 600, net: 600});
        expect(stock).toBeNull();
        expect(runHolds({result: "holds", baseline: baseline!, disturbances: [], stock})).toBe(true);
    });

    it("fails a baseline with no whole clock cycle in it", () => {
        const run = record(k => k * 10, () => 5, 5);
        const {baseline} = judgeBaseline({...run, series: {...run.series, cycles: run.series.cycles.slice(0, 1)}}, 10);
        expect(baseline?.measured).toBeUndefined();
        expect(baseline?.meets).toBe(false);
    });

    it("refuses a summary recorded before the stock guard", () => {
        expect(runHolds({result: "holds", baseline: {meets: true}, disturbances: [], stock: undefined as never})).toBe(false);
    });
});

// the same run with a tail (steady.lua `tail`): it goes on for 3,600 ticks after the baseline's end, which is the last recovery
// here, a whole 60-tick cycle at a time. The first row of the tail is the cycle at the recovery (the baseline's last), then one
// row for each given {stock, low}; the stock a row holds is a total, its low the lowest of the ticks since the row before
function tailed(after: {stock: number, low: number}[], tail = {from: 7200, ticks: 3600}) {
    const base = record(k => k * 10, () => 5, 5);
    const rows = after.map(({stock, low}, k) => ({t: 7260 + 60 * k, p: [610 + 10 * k], s: [stock], low}));
    const end = rows[rows.length - 1] ?? base.series.cycles[60];
    return {...base, tail, ended: end.t, series: {...base.series, cycles: [...base.series.cycles, ...rows],
        marks: [...base.series.marks.slice(0, 2), {t: end.t, at: "end", p: end.p, s: end.s}]}};
}
const levels = (stocks: number[]) => stocks.map(stock => ({stock, low: stock}));
const sixty = (head: number[], rest: number) => levels([...head, ...Array.from({length: 60 - head.length}, () => rest)]);

describe("judgeBaseline: the stock after the last recovery (#587)", () => {
    it("reads the level the stock settles to, not the dip the last disturbance leaves at its recovery", () => {
        // 5 in the baseline; the last disturbance drops it to 1, it climbs back to 9 within the first half of the tail and stays
        const {stock} = judgeBaseline(tailed(sixty([1, 2, 3, 4, 5, 6, 7, 8, 9], 9)), 10);
        expect(stock).toMatchObject({lowest: 5, end: 9, holds: true, after: {settled: {from: 9000, lowest: 9, last: 9, falling: false, holds: true}}});
        expect(stock?.after?.stock.slice(0, 3)).toEqual([5, 1, 2]);
    });

    it("passes a drop to a new steady level that is no lower than the baseline's lowest", () => {
        const {stock} = judgeBaseline(tailed(sixty([3, 4], 5)), 10);
        expect(stock?.holds).toBe(true);
        expect(stock?.after?.settled).toMatchObject({lowest: 5, falling: false});
    });

    it("fails a new steady level below the baseline's lowest", () => {
        const {stock} = judgeBaseline(tailed(sixty([3, 4], 4)), 10);
        expect(stock).toMatchObject({lowest: 5, end: 4, holds: false, after: {settled: {lowest: 4, falling: false, holds: false}}});
    });

    it("fails a slow drain, whether it reaches the baseline's lowest in the tail or not", () => {
        const toBelow = judgeBaseline(tailed(levels(Array.from({length: 60}, (_, k) => 40 - k))), 10);
        expect(toBelow.stock?.holds).toBe(false);
        // 100 at the start, 1 less in every cycle: still far above the lowest at the end of the tail, but never settled
        const above = judgeBaseline(tailed(levels(Array.from({length: 60}, (_, k) => 100 - k))), 10);
        expect(above.stock).toMatchObject({holds: false, after: {settled: {falling: true, holds: false}}});
        expect(above.stock?.after?.settled?.lowest).toBeGreaterThanOrEqual(5);
    });

    it("judges the lowest tick of the cycles it reads, as the baseline's lowest is", () => {
        const rows = sixty([3], 9).map((row, k) => k === 50 ? {...row, low: 4} : row);
        expect(judgeBaseline(tailed(rows), 10).stock).toMatchObject({holds: false, after: {settled: {lowest: 4}}});
    });

    it("has no settled level, and fails, where the run ended before the half of its tail", () => {
        const {stock} = judgeBaseline(tailed(levels([9, 9, 9]), {from: 7200, ticks: 3600}), 10);
        expect(stock).toMatchObject({holds: false, after: {settled: null}});
    });

    it("judges a run that asked for no tail as before: the stock at its end, and no new field", () => {
        const {stock} = judgeBaseline(record(k => k * 10, () => 5, 3, k => k === 30 ? 4 : 5), 10);
        expect(stock).toEqual({lowest: 4, end: 3, holds: false});
    });

    it("holds the run only when the stock after settling holds", () => {
        const holds = (rows: ReturnType<typeof levels>) => {
            const run = tailed(rows), {baseline, stock} = judgeBaseline(run, 10);
            return runHolds({result: "holds", baseline: baseline!, disturbances: [], stock});
        };
        expect(holds(sixty([1, 2], 9))).toBe(true);
        expect(holds(sixty([1, 2], 4))).toBe(false);
    });
});

describe("judgeBaselineOfFinals", () => {
    // two final machines of two copies, 10 products a 60-tick cycle wanted of each: the first makes them, the second makes 9 and
    // keeps one more in its output stock in the last cycle
    const run = record(k => k * 10, () => 5, 5);
    const two = {...run, finals: [{unit_number: 1, recipe: "r", worth: 1}, {unit_number: 2, recipe: "r", worth: 1}],
        series: {...run.series, cycles: run.series.cycles.map(row => {
            const k = (row.t - 3600) / 60;
            return {...row, p: [k * 10, k * 9], s: [5, 5 + (k === 60 ? 1 : 0)]};
        })}};

    it("judges the whole cycles of the named final machines by their net output", () => {
        expect(judgeBaselineOfFinals(two, 10, [0])).toEqual({ticks: 3600, items: 600, expected: 600, stock_start: 5, stock_end: 5, net: 600, meets: true});
        expect(judgeBaselineOfFinals(two, 10, [1])).toEqual({ticks: 3600, items: 540, expected: 600, stock_start: 5, stock_end: 6, net: 539, meets: false});
        expect(judgeBaselineOfFinals(two, 20, [0, 1])?.meets).toBe(false);
    });

    it("has nothing to judge without a whole clock cycle or for a build judged by a count", () => {
        expect(judgeBaselineOfFinals({...two, series: {...two.series, cycles: two.series.cycles.slice(0, 1)}}, 10, [0])).toBeNull();
        expect(judgeBaselineOfFinals({...two, series: {...two.series, judged_by: "count" as const}}, 10, [0])).toBeNull();
    });
});
