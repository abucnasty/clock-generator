import fs from "fs";
import path from "path";
import {describe, expect, it} from "vitest";
import {judgeAfterLoss, judgeBaseline, judgeBaselineOfFinals, runHolds} from "./run-judgement";

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

// A whole number of the run's repeat (abucnasty, 2026-11-18). The series is the game's own: filled-start search 5, the automation science 240
// build (one copy, nine assemblers, window cycle 216) on the windows 89341f604ac4 from the staged backpressure start. Its output inserters drop 96
// a cycle on average; two of the assemblers' hands run in a 3-cycle repeat (they drop 88, 102 and 98), so the 16 cycles of the
// baseline hold five repeats and a cycle over, which reads 13,808 of 13,824, and the 15 cycles of five repeats read 12,960 of 12,960
describe("judgeBaseline: a whole number of the run's repeat (abucnasty, 2026-11-18)", () => {
    const nine = () => JSON.parse(fs.readFileSync(path.join(__dirname, "run-judgement-nine-89341f604ac4.json"), "utf8"));
    const target = 240;
    /** the nine's series with `change(k, row index, products)` in place of each assembler's products at each cycle row */
    const changed = (change: (machine: number, row: number, products: number) => number) => {
        const run = nine();
        run.series.cycles = run.series.cycles.map((row: {p: number[]}, i: number) => ({...row, p: row.p.map((products, k) => change(k, i, products))}));
        return run;
    };

    it("holds a baseline of 16 cycles of a 3-cycle repeat over its 15 cycles", () => {
        const {baseline, stock} = judgeBaseline(nine(), target);
        expect(baseline?.measured).toMatchObject({ticks: 3240, net: 12960, expected: 12960, repeat_cycles: 3});
        expect(baseline?.meets).toBe(true);
        expect(runHolds({result: "holds", baseline: baseline!, disturbances: [], stock})).toBe(true);
    });

    it("keeps the stock guard over all the whole cycles of the baseline", () => {
        expect(judgeBaseline(nine(), target).stock).toEqual({lowest: 14, end: 154, holds: true});
    });

    it("fails a run that is truly short: an assembler one product short in every cycle", () => {
        const short = changed((k, row, products) => k === 3 ? products - row : products);
        const {baseline} = judgeBaseline(short, target);
        expect(baseline?.measured).toMatchObject({ticks: 3240, net: 12945, repeat_cycles: 3});
        expect(baseline?.meets).toBe(false);
    });

    it("judges all the whole cycles where the output has no repeat seen twice", () => {
        // one assembler drops 3 fewer in the last cycle only: nothing repeats, so the 16 cycles are judged, as before the rule
        const odd = changed((k, row, products) => k === 0 && row === 16 ? products - 3 : products);
        const {baseline} = judgeBaseline(odd, target);
        expect(baseline?.measured).toMatchObject({ticks: 3456, net: 13805});
        expect(baseline?.measured?.repeat_cycles).toBeUndefined();
        expect(baseline?.meets).toBe(false);
    });

    it("judges all the whole cycles where the repeat fits them exactly (no field written)", () => {
        const run = nine();
        run.series.cycles = run.series.cycles.slice(0, 16);
        const {baseline} = judgeBaseline(run, target);
        expect(baseline?.measured).toMatchObject({ticks: 3240, net: 12960});
        expect(baseline?.measured?.repeat_cycles).toBeUndefined();
    });

    it("judges a copy's final machines over the same whole repeats", () => {
        // the assemblers 3 and 7: 288 each in every repeat of 3 cycles, 26 and 2/3 a second each, 53 and 1/3 together
        expect(judgeBaselineOfFinals(nine(), 480 / 9, [2, 6])).toMatchObject({ticks: 3240, net: 2880, meets: true, repeat_cycles: 3});
    });
});

// What a copy puts out after the last loss, over a whole number of the run's repeat (decision 1057, abucnasty's 988 for the baseline). The
// series is the game's own: copy 10 (unit 1075) of the electromagnetic science 330 build, 11 copies, ruling 60's start, the supercapacitor lane cut at
// 9,312 (Factorio 2.1.24), from diag2-capture/electromagnetic-science-330-supercapacitors in 2026-11-judged-start-recordings-2/evidence and its
// work folder 2026-11-em-330-supercapacitor. The copy makes all 1,056 packs of every 2,112-tick cycle, but its two output inserters take 67 and 65
// hands in turn, so its net output reads 1,040 and 1,072 in turn: a cycle that ends a hand early reads 16 short. The rows are the test's own tail
// rows (1,740 + k x 2,112); the run's tail began at 24,972 and the copy had settled into the pattern from 12,300
describe("judgeAfterLoss: a whole number of the run's repeat (decision 1057)", () => {
    const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, "run-judgement-em330-copy10.json"), "utf8")) as {rows: {t: number; p: number[]; s: number[]}[]};
    const finals = [{worth: 1}];
    const target = 30; // 1,056 packs in 2,112 ticks: 30 a second
    const from = (t: number) => recorded.rows.filter(row => row.t >= t);

    it("holds copy 10 over the cycles it was recorded to run after the loss: 1,040 and 1,072 in turn are 2,112 in a repeat of two", () => {
        // 6 rows, 5 cycles: 1,040 1,072 1,040 1,072 1,040; the repeat of two is seen twice, the last four cycles are judged
        const after = judgeAfterLoss(finals, from(20748), [0], target, 10_560);
        expect(after.cycles.map(cycle => cycle.net)).toEqual([2112, 2112]);
        expect(after.short).toEqual([]);
        expect(after.total).toEqual({net: 4224, expected: 4224});
        expect(after.repeat_cycles).toBe(2);
    });

    it("judges one cycle of the last minute as before where the tail holds no repeat twice (the recorded tail: three cycles)", () => {
        const tail = from(24972);
        expect(tail.map(row => row.t)).toEqual([24972, 27084, 29196, 31308]);
        const after = judgeAfterLoss(finals, tail, [0], target);
        expect(after.cycles.map(cycle => cycle.net)).toEqual([1040]);
        expect(after.short).toHaveLength(1);
        expect(after.repeat_cycles).toBeUndefined();
    });

    it("fails a copy that is truly short: one pack short in every repeat", () => {
        // one pack less in the products of every second cycle, from the first cycle of the span on
        const short = from(20748).map((row, i) => ({...row, p: [row.p[0] - Math.floor((i + 1) / 2)]}));
        const after = judgeAfterLoss(finals, short, [0], target, 10_560);
        expect(after.repeat_cycles).toBe(2);
        expect(after.short.length).toBeGreaterThan(0);
        expect(after.short.every(cycle => cycle.net === 2111)).toBe(true);
    });

    it("fails a copy that is a hand short in every cycle (no repeat to cut)", () => {
        const short = from(20748).map((row, i) => ({...row, p: [row.p[0] - 16 * i]}));
        const after = judgeAfterLoss(finals, short, [0], target, 10_560);
        expect(after.short.length).toBeGreaterThan(0);
    });
});
