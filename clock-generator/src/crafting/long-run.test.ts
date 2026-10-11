import { describe, expect, it } from "vitest";
import { judgeLongRun, longRunPeriods, PeriodRepeat } from "./long-run";

/**
 * What an output inserter holds after each tick when it drops a hand at the given positions of every clock period.
 * It acts on whole ticks, so a drop falls on the first tick at or after its position, as in the simulator and the game.
 * `skip(period, position)` leaves a drop out.
 */
function heldSeries(
    period: number,
    periods: number,
    positions: number[],
    hand: number,
    skip: (period_index: number, position_index: number) => boolean = () => false,
): number[] {
    const ticks = Math.ceil(period * periods);
    const held = new Array<number>(ticks).fill(0);
    for (let k = 0; k < periods; k++) {
        positions.forEach((position, index) => {
            const drop = Math.ceil(k * period + position - 1e-9);
            if (skip(k, index) || drop >= ticks) {
                return;
            }
            for (let t = Math.max(0, drop - 4); t < drop; t++) {
                held[t] = hand;
            }
        });
    }
    return held;
}

describe("judging the long run of a clock", () => {
    // the iron bacteria clock: 1728/19 ticks, four output inserters with three hands of 16 in each of three windows
    const PERIOD = 1728 / 19;
    const REPEAT: PeriodRepeat = { period_ticks: 1728, scale: 19 };
    const DROPS = [5, 13, 21, 35, 43, 51, 65, 73, 81];
    const EXPECTED = 4 * DROPS.length * 16;
    const four = (positions: number[], skip?: (period_index: number, position_index: number) => boolean) =>
        Array.from({ length: 4 }, () => heldSeries(PERIOD, 120, positions, 16, skip));

    it("holds a clock of a fractional period that moves exactly its output every period", () => {
        const verdict = judgeLongRun(four(DROPS), Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16);
        // bins of the 90 whole ticks in a period hold 570 of the 576 on average, and one in eleven is 64 short
        expect(verdict.bin_ticks).toBe(1728);
        expect(verdict.periods_per_bin).toBe(19);
        expect(verdict.expected_per_bin).toBe(19 * EXPECTED);
        expect(verdict.judged).toEqual([10944, 10944, 10944, 10944]);
        expect(verdict.keeps_up).toBe(true);
        expect(verdict.output_items_per_period).toBe(EXPECTED);
    });

    it("holds it wherever the drops fall in the period, also on the boundary between two periods", () => {
        // a drop at 90.5 of 90.947 falls on the last tick of one period and on the first of the next in turn, for
        // all four inserters at once: bins of the true period would read 512 and 640 next to each other
        for (const shift of [85, 85.5, 86, 90]) {
            const drops = DROPS.map(position => (position + shift) % PERIOD);
            const verdict = judgeLongRun(four(drops), Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16);
            expect(verdict.judged, `drops moved by ${shift} ticks`).toEqual([10944, 10944, 10944, 10944]);
            expect(verdict.keeps_up).toBe(true);
        }
    });

    it("does not hold a clock that loses a hand of every output inserter in one period out of eleven", () => {
        const verdict = judgeLongRun(four(DROPS, (period, position) => period % 11 === 0 && position === 8),
            Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16);
        expect(verdict.keeps_up).toBe(false);
        expect(verdict.off_bins.length).toBeGreaterThan(0);
        expect(verdict.span_off).toBe(true);
        expect(verdict.output_items_per_period).toBeLessThan(EXPECTED);
    });

    it("does not hold a clock that drifts a single hand over the judged span", () => {
        const one_short = [heldSeries(PERIOD, 120, DROPS, 16, (period, position) => period === 70 && position === 0),
            ...Array.from({ length: 3 }, () => heldSeries(PERIOD, 120, DROPS, 16))];
        // a hand is the tolerance, so one hand short still holds; two do not
        expect(judgeLongRun(one_short, Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16).keeps_up).toBe(true);
        const two_short = four(DROPS, (period, position) => period === 70 && position === 0).slice(0, 2)
            .concat(Array.from({ length: 2 }, () => heldSeries(PERIOD, 120, DROPS, 16)));
        expect(judgeLongRun(two_short, Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16).keeps_up).toBe(false);
    });

    it("judges a clock of whole ticks period by period, after the first third of the run", () => {
        const drops = [5, 13, 21];
        const held = [heldSeries(90, 120, drops, 16, (period, position) => period === 100 && position < 2)];
        const verdict = judgeLongRun(held, 90 * 120, 90, null, 48, 16);
        expect(verdict.bin_ticks).toBe(90);
        expect(verdict.first_judged_tick).toBe(40 * 90);
        expect(verdict.judged).toHaveLength(80);
        expect(verdict.off_bins).toEqual([{ index: 60, items: 16 }]);
        expect(verdict.keeps_up).toBe(false);
        expect(judgeLongRun([heldSeries(90, 120, drops, 16)], 90 * 120, 90, null, 48, 16).keeps_up).toBe(true);
    });

    it("leaves out the start-up: a short first third does not count", () => {
        const held = four(DROPS, period => period < 30);
        expect(judgeLongRun(held, Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16).keeps_up).toBe(true);
    });

    it("does not hold a clock that is within a hand in every bin but drifts over the judged span", () => {
        // one inserter a hand short in every period: no bin is more than a hand off, the 80 judged periods are 80 hands short
        const one_short_every_period = [heldSeries(90, 120, [5, 13, 21], 16, (_period, position) => position === 0),
            ...Array.from({ length: 3 }, () => heldSeries(90, 120, [5, 13, 21], 16))];
        const verdict = judgeLongRun(one_short_every_period, 90 * 120, 90, null, 4 * 48, 16);
        expect(verdict.off_bins).toEqual([]);
        expect(verdict.span_off).toBe(true);
        expect(verdict.keeps_up).toBe(false);
    });

    it("does not hold a clock with a bin more than a hand off, even when the span comes out exact", () => {
        // two hands slip from period 100 into period 101: both bins are two hands off and the span is whole
        const slipping = Array.from({ length: 2 }, () => heldSeries(90, 120, [5, 13, 21], 16, (period, position) => period === 100 && position === 2));
        const caught_up = Array.from({ length: 2 }, () => heldSeries(90, 120, [40], 16, period => period !== 101));
        const verdict = judgeLongRun([...slipping, ...caught_up], 90 * 120, 90, null, 2 * 48, 16);
        expect(verdict.span_off).toBe(false);
        expect(verdict.total).toBe(verdict.expected_total);
        expect(verdict.off_bins).toEqual([{ index: 60, items: 64 }, { index: 61, items: 128 }]);
        expect(verdict.keeps_up).toBe(false);
    });

    it("starts the judged part at the first whole tick after the settled periods: a drop on the tick before is not judged", () => {
        // 40 periods of 90.947 ticks end at 3637.89: tick 3637 is start-up, tick 3638 is the first tick judged
        const lone = (tick: number) => { const held = new Array<number>(Math.ceil(PERIOD * 120)).fill(0); held.fill(16, tick - 4, tick); return held; };
        const before = judgeLongRun([...four(DROPS), lone(3637), lone(3637)], Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16);
        expect(before.first_judged_tick).toBe(3638);
        expect(before.judged).toEqual([10944, 10944, 10944, 10944]);
        expect(before.keeps_up).toBe(true);
        const after = judgeLongRun([...four(DROPS), lone(3638), lone(3638)], Math.ceil(PERIOD * 120), PERIOD, REPEAT, EXPECTED, 16);
        expect(after.judged).toEqual([10976, 10944, 10944, 10944]);
        expect(after.keeps_up).toBe(false);
    });

    describe("when no whole repeat fits into the judged part", () => {
        // 30 periods judged of a repeat of 1000: the span is cut where it falls and may be a hand of every inserter off
        const far: PeriodRepeat = { period_ticks: 90947, scale: 1000 };
        const TICKS = Math.ceil(90.947 * 45);
        const series = (skip?: (period_index: number, position_index: number, inserter: number) => boolean) =>
            Array.from({ length: 4 }, (_, inserter) => heldSeries(90.947, 45, DROPS, 16, skip && ((period, position) => skip(period, position, inserter))));

        it("compares the periods run after the settled ones as one span", () => {
            const exact = judgeLongRun(series(), TICKS, 90.947, far, EXPECTED, 16);
            expect(exact.bin_ticks).toBeNull();
            expect(exact.judged).toEqual([30 * EXPECTED]);
            // whole periods: the ticks left over are 30 periods and the fraction of a tick the run is rounded up by
            expect(exact.periods_per_bin).toBe(30);
            expect(exact.expected_total).toBe(30 * EXPECTED);
            expect(exact.keeps_up).toBe(true);
            expect(judgeLongRun(series(), TICKS, 90.947, null, EXPECTED, 16).bin_ticks).toBeNull();
        });

        it("holds a span that is a hand of every output inserter off, and no more", () => {
            // four hands short over the span: one of each inserter, the tolerance exactly
            const four_short = judgeLongRun(series((period, position) => period === 30 && position === 0), TICKS, 90.947, far, EXPECTED, 16);
            expect(four_short.total).toBe(30 * EXPECTED - 4 * 16);
            expect(four_short.keeps_up).toBe(true);
            // a fifth hand short is outside it
            const five_short = judgeLongRun(
                series((period, position, inserter) => (period === 30 && position === 0) || (period === 31 && position === 0 && inserter === 0)),
                TICKS, 90.947, far, EXPECTED, 16);
            expect(five_short.total).toBe(30 * EXPECTED - 5 * 16);
            expect(five_short.span_off).toBe(true);
            expect(five_short.keeps_up).toBe(false);
            expect(five_short.output_items_per_period).toBe(Math.round((30 * EXPECTED - 80) / 30));
        });

        it("does not hold a span that loses a hand of every inserter in one period out of five", () => {
            expect(judgeLongRun(series(period => period % 5 === 0), TICKS, 90.947, null, EXPECTED, 16).keeps_up).toBe(false);
        });
    });

    it("runs long enough for the judged two thirds to hold a whole repeat", () => {
        // 19 periods repeat within the 120 of the usual run
        expect(longRunPeriods(PERIOD, REPEAT, 120, 5000)).toBe(120);
        // 22 periods of 1652.87 ticks are ten minutes, but 23 of them repeat: 36 are run so 24 are judged
        expect(longRunPeriods(38016 / 23, { period_ticks: 38016, scale: 23 }, 22, 300)).toBe(36);
        // a whole period needs no more than it had
        expect(longRunPeriods(90, null, 120, 5000)).toBe(120);
        // a repeat that would take far longer than the run is not waited for
        expect(longRunPeriods(90.947, { period_ticks: 90947, scale: 1000 }, 120, 5000)).toBe(120);
        expect(longRunPeriods(38016 / 23, { period_ticks: 38016, scale: 23 }, 22, 30)).toBe(22);
    });
});
