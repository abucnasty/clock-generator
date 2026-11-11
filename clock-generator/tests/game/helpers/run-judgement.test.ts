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
