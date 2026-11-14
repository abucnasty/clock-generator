import { describe, expect, it } from 'vitest';
import type { CheckedLanes } from 'clock-generator/browser';
import { AUTOMATION_240, ELECTROMAGNETIC_330, viewOf } from '../test/checkedLanesFixtures';
import { shownRateOf, type RatedClock } from './shownRate';

const made = (items_per_second: number): CheckedLanes => ({ copies_made: { items_per_second, window_cycles: 63 } }) as CheckedLanes;
const rated = (losses: number, checkedLanes?: CheckedLanes): RatedClock => ({
    assessment: { items_per_second: 240, shared_lane_losses: Array.from({ length: losses }, () => ({}) as never) },
    ...(checkedLanes !== undefined && { checkedLanes }),
});

describe('shownRateOf', () => {
    it('gives what all the copies made in their run together on a clock with a loss on a shared lane', () => {
        expect(shownRateOf(rated(4, made(234.074074074)))).toBe(234.074074074);
    });

    it('gives the clock-only rate on a clock without a loss, whatever the run of the copies made', () => {
        expect(shownRateOf(rated(0, made(239.5)))).toBe(240);
        expect(shownRateOf({ assessment: { items_per_second: 240 }, checkedLanes: made(239.5) })).toBe(240);
    });

    it('gives the clock-only rate where the result has no rate of the copies: an older result, or no run of the copies', () => {
        expect(shownRateOf(rated(4, {} as CheckedLanes))).toBe(240);
        expect(shownRateOf(rated(4))).toBe(240);
    });

    it('reads the engine\'s results: the 216-tick automation science clock, and a stable clock of each', () => {
        expect(shownRateOf(viewOf(AUTOMATION_240, 'takt_batches_observed'))).toBeCloseTo(234.074074, 6);
        expect(shownRateOf(viewOf(AUTOMATION_240, 'time_study_windows'))).toBe(240);
        expect(shownRateOf(viewOf(ELECTROMAGNETIC_330, 'takt_batches_observed'))).toBe(330);
    });
});
