import { describe, expect, it } from 'vitest';
import type { FuelLevelSeries } from 'clock-generator/browser';
import type { FuelViewData } from '../worker/types';
import { fuelEventRows, fuelSampledEmptyIntervals, fuelTraceSummary } from './fuelAccessibility';

const levels = (updates: Partial<FuelLevelSeries> = {}): FuelLevelSeries => ({ machine_id: 'machine-one', machine_number: 1,
    ticks_per_sample: 10, min: [2, 1, 3], max: [4, 3, 4], start_level: 4, end_level: 3, min_level: 1, max_level: 4,
    inserted: 7.5, burned: 8.5, empty_ticks: 0, first_empty_tick: null, limit_lasts_ticks: null, ...updates });

// Typed input fixtures exercise branches that may not be produced by the real fuel sample; browser parity uses actual worker output.
function fuel(): FuelViewData {
    const defaults = { machine_id: 'machine', fuel_item: 'coal', hand_size: 4, hand_lasts_ticks: 20, modulus: 20, window: { start: 0, end: 3 }, enables_per_minute: 180, expected_swings_per_minute: 180, swing_share: 1 };
    return { plan: { period_ticks: 12, merged_clock_ticks: 60, machines: [], inserters: [
        { ...defaults, inserter_id: 'second', inserter_number: 2, machine_number: 7 },
        { ...defaults, inserter_id: 'first', inserter_number: 1, machine_number: 3 },
    ] }, run: { periods: 2, durationTicks: 25, fuelSwingsRecorded: true, ranOutOfFuel: false,
        levels: [levels()], swings: { second: [{ start: 4.5, end: 6.5, amount: 2 }], first: [
            { start: 4.5, end: 7, amount: 3 }, { start: 0, end: 2, amount: 1 }, { start: 4.5, end: 6, amount: 0.5 },
        ] } } };
}

describe('Fuel text equivalents', () => {
    it('reproduces every event exactly, associates feed machines and sorts by start, inserter and end', () => {
        const view = fuel(), before = structuredClone(view);
        expect(fuelEventRows(view)).toEqual([
            { inserterNumber: 1, machineNumber: 3, startTick: 0, endTick: 2, amount: 1 },
            { inserterNumber: 1, machineNumber: 3, startTick: 4.5, endTick: 6, amount: 0.5 },
            { inserterNumber: 1, machineNumber: 3, startTick: 4.5, endTick: 7, amount: 3 },
            { inserterNumber: 2, machineNumber: 7, startTick: 4.5, endTick: 6.5, amount: 2 },
        ]);
        expect(view).toEqual(before);
    });
    it('returns no invented events when a run is absent, an inserter has none or no swings were recorded', () => {
        const view = fuel(); view.run = null; expect(fuelEventRows(view)).toEqual([]);
        view.run = { ...fuel().run!, fuelSwingsRecorded: false, swings: {} }; expect(fuelEventRows(view)).toEqual([]);
    });
    it('summarizes exact start, end, min, max, inserted, burned, duration and zero empty ticks', () => {
        expect(fuelTraceSummary(levels(), 25)).toBe('Machine 1, over 25 ticks: fuel started at 4 items and ended at 3 items. Minimum 1 items; maximum 4 items. 7.5 items inserted; 8.5 items burned. 0 ticks with no fuel.');
    });
    it('preserves first empty tick zero and never claims sampled bin boundaries are exact', () => {
        const text = fuelTraceSummary(levels({ empty_ticks: 2, first_empty_tick: 0, min: [0, 1, 0] }), 25);
        expect(text).toContain('2 ticks with no fuel. First empty tick: 0.');
        expect(text).toContain('Sampled intervals containing an empty level: 0 to 10, 20 to 25 ticks. Exact empty-interval boundaries are unavailable.');
    });
    it('merges adjacent sampled bins, separates others and clips a partial last bin', () => {
        expect(fuelSampledEmptyIntervals(levels({ empty_ticks: 3, min: [0, -1, 2, 0, 0] }), 43)).toEqual([
            { startTick: 0, endTick: 20 }, { startTick: 30, endTick: 43 },
        ]);
    });
    it('uses the chart condition: zero empty ticks suppresses zero minima, and positive total requires nonpositive minima', () => {
        expect(fuelSampledEmptyIntervals(levels({ min: [0, 0] }), 20)).toEqual([]);
        expect(fuelSampledEmptyIntervals(levels({ empty_ticks: 1 }), 25)).toEqual([]);
        expect(fuelSampledEmptyIntervals(levels({ empty_ticks: 1, min: [] }), 25)).toEqual([]);
    });
    it('still labels one-tick recorder bins as sampled and ignores bins beyond the run', () => {
        const series = levels({ ticks_per_sample: 1, empty_ticks: 1, first_empty_tick: 2, min: [1, 0, 0, 0] });
        expect(fuelSampledEmptyIntervals(series, 2)).toEqual([{ startTick: 1, endTick: 2 }]);
        expect(fuelTraceSummary(series, 2)).toContain('Sampled intervals containing an empty level: 1 to 2 ticks. Exact empty-interval boundaries are unavailable.');
    });
});
