import type { FuelLevelSeries } from 'clock-generator/browser';
import type { FuelViewData } from '../worker/types';
import { formatNumberText } from './numberText';

export interface FuelEventRow {
    inserterNumber: number;
    machineNumber: number;
    startTick: number;
    endTick: number;
    amount: number;
}

export function fuelEventRows(fuel: FuelViewData): FuelEventRow[] {
    if (!fuel.run) return [];
    const run = fuel.run;
    return fuel.plan.inserters.flatMap(inserter => (run.swings[inserter.inserter_id] ?? []).map(swing => ({
        inserterNumber: inserter.inserter_number,
        machineNumber: inserter.machine_number,
        startTick: swing.start,
        endTick: swing.end,
        amount: swing.amount,
    }))).sort((a, b) => a.startTick - b.startTick || a.inserterNumber - b.inserterNumber || a.endTick - b.endTick);
}

/** These are the chart's sampled bins containing an empty level, never exact empty-interval boundaries. */
export function fuelSampledEmptyIntervals(levels: FuelLevelSeries, durationTicks: number): { startTick: number; endTick: number }[] {
    const intervals: { startTick: number; endTick: number }[] = [];
    if (levels.empty_ticks <= 0) return intervals;
    levels.min.forEach((min, sample) => {
        if (min > 0) return;
        const startTick = Math.min(sample * levels.ticks_per_sample, durationTicks);
        const endTick = Math.min((sample + 1) * levels.ticks_per_sample, durationTicks);
        if (startTick >= endTick) return;
        const previous = intervals.at(-1);
        if (previous?.endTick === startTick) previous.endTick = endTick;
        else intervals.push({ startTick, endTick });
    });
    return intervals;
}

export function fuelTraceSummary(levels: FuelLevelSeries, durationTicks: number): string {
    const intervals = fuelSampledEmptyIntervals(levels, durationTicks);
    const quantity = (value: number) => formatNumberText(value, { maxDecimals: 3 });
    return `Machine ${levels.machine_number}, over ${durationTicks} ticks: fuel started at ${quantity(levels.start_level)} items and ended at ${quantity(levels.end_level)} items. `
        + `Minimum ${quantity(levels.min_level)} items; maximum ${quantity(levels.max_level)} items. ${quantity(levels.inserted)} items inserted; ${quantity(levels.burned)} items burned (fuel amounts rounded for display). `
        + `${levels.empty_ticks} ticks with no fuel.`
        + (levels.first_empty_tick !== null ? ` First empty tick: ${levels.first_empty_tick}.` : '')
        + (intervals.length ? ` Sampled intervals containing an empty level: ${intervals.map(range => `${range.startTick} to ${range.endTick}`).join(', ')} ticks. Exact empty-interval boundaries are unavailable.` : '');
}
