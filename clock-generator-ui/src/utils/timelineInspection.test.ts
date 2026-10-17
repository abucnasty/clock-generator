import { describe, expect, it } from 'vitest';
import type { TimelineEvent, TimelineRecording, TimelineSeries } from 'clock-generator/browser';
import { clampTimelineRange, deliveryRateSeries, productionBatches, timelineStateDurations, panTimeline, timelinePoints, timelineValueAt, timelineWaits, validInspection, zoomTimeline } from './timelineInspection';
const series: TimelineSeries = { id: 'stock', label: 'Stock', group: 'inventory', unit: 'items', ticks: [0, 10, 11, 12, 30], values: [4, 5, 100, 0, 9] };

describe('timeline inspection', () => {
    it('retains boundary values and narrow extrema when culling/downsampling', () => {
        expect(timelineValueAt(series, 11)).toBe(100);
        expect(timelineValueAt(series, 29)).toBe(0);
        const points = timelinePoints(series, { start: 5, end: 20 }, 1);
        expect(points[0]).toEqual({ tick: 5, value: 4 });
        expect(points).toContainEqual({ tick: 11, value: 100 });
        expect(points.at(-1)).toEqual({ tick: 20, value: 0 });
        expect(points.every(point => point.tick >= 5 && point.tick <= 20)).toBe(true);
    });
    it('clamps and preserves a useful viewport when clocks have different periods', () => {
        expect(clampTimelineRange({ start: 80, end: 120 }, 100)).toEqual({ start: 60, end: 100 });
        expect(clampTimelineRange({ start: 80, end: 120 }, 20)).toEqual({ start: 0, end: 20 });
        expect(zoomTimeline({ start: 0, end: 100 }, .5, 50, 100)).toEqual({ start: 25, end: 75 });
        expect(panTimeline({ start: 25, end: 75 }, 1, 100)).toEqual({ start: 50, end: 100 });
    });
    it('migrates unknown persisted inspection choices safely and separates plan/clock ranges', () => {
        expect(validInspection({ view: 'broken', tick: Infinity, entityId: 'anything', signals: ['inventory', 'evil', 'inventory'], ranges: { plan: { start: 10, end: 20 }, clock: { start: -1, end: 30 } } })).toMatchObject({
            view: 'windows', tick: 0, entityId: null, signals: ['inventory'], ranges: { plan: { start: 10, end: 20 } },
        });
    });
    it('uses actual drops and quantities for the trailing one-second rate', () => {
        const event = (tick: number, amount: number, kind: TimelineEvent['kind'] = 'drop'): TimelineEvent => ({ tick, amount, kind, item: 'iron-plate', entity_id: 'inserter:1' });
        const rate = deliveryRateSeries([event(10, 3), event(20, 7), event(30, 100, 'pickup')], 'iron-plate', 100);
        expect(timelineValueAt(rate, 19)).toBe(3);
        expect(timelineValueAt(rate, 20)).toBe(10);
        expect(timelineValueAt(rate, 70)).toBe(7);
        expect(timelineValueAt(rate, 80)).toBe(0);
    });
    it('frames only known waiting intervals and clips the final interval to the excerpt', () => {
        const recording = { end_tick: 25, entities: [{ id: 'machine:1', signals: [{ ...series, id: 'state', ticks: [0, 5, 20], values: ['working', 'full_output', 'item_ingredient_shortage'] }] }] } as TimelineRecording;
        expect(timelineWaits(recording, 'machine:1')).toEqual([
            { entityId: 'machine:1', state: 'full_output', start: 5, end: 20 },
            { entityId: 'machine:1', state: 'item_ingredient_shortage', start: 20, end: 25 },
        ]);
    });
});

it('sums released product quantities without counting crafts or pickups, including viewport boundaries', () => {
    const events: TimelineEvent[] = [
        { tick: 5, entity_id: 'machine:1', kind: 'produce', item: 'iron-plate', amount: 100 },
        { tick: 10, entity_id: 'machine:1', kind: 'produce', item: 'iron-plate', amount: 3 },
        { tick: 11, entity_id: 'machine:1', kind: 'craft-complete', amount: 1 },
        { tick: 12, entity_id: 'machine:1', kind: 'produce', item: 'iron-plate', amount: 4 },
        { tick: 20, entity_id: 'machine:1', kind: 'produce', item: 'iron-plate', amount: 2 },
        { tick: 21, entity_id: 'machine:1', kind: 'produce', item: 'iron-plate', amount: 99 },
    ];
    expect(productionBatches(events, { start: 10, end: 20 }, 1)).toEqual([{ start: 10, end: 20, amount: 9 }]);
    expect(productionBatches(events, { start: 10, end: 20 }, 100)).toEqual([{ start: 10, end: 10, amount: 3 }, { start: 12, end: 12, amount: 4 }, { start: 20, end: 20, amount: 2 }]);
});
it('summarizes repeated waiting intervals as shares of the recorded excerpt', () => {
    const recording = { end_tick: 30, entities: [{ id: 'machine:1', signals: [{ ...series, id: 'state', ticks: [0, 10, 15, 25], values: ['working', 'item_ingredient_shortage', 'working', 'item_ingredient_shortage'] }] }] } as TimelineRecording;
    expect(timelineStateDurations(recording, 'machine:1')).toEqual([
        { state: 'working', ticks: 20, share: 2 / 3 }, { state: 'item_ingredient_shortage', ticks: 10, share: 1 / 3 },
    ]);
});

it('migrates saved Entity states views to the Activity states-only preset without losing context', () => {
    expect(validInspection({ view: 'states', signals: ['inventory', 'transfers'], entityId: 'inserter:12', tick: 235, run: 'plan', ranges: { plan: { start: 220, end: 253 } } })).toMatchObject({
        view: 'activity', signals: ['state'], entityId: 'inserter:12', tick: 235, run: 'plan', ranges: { plan: { start: 220, end: 253 } },
    });
});

it('discards legacy A/B choices while retaining workspace context', () => {
    const saved = { view: 'activity', run: 'clock', entityId: 'inserter:5', tick: 235, signals: ['state', 'hand'], showConnections: true, ranges: { clock: { start: 220, end: 253 } }, comparisonId: 'swings-2' };
    const restored = validInspection(saved);
    expect(restored).toEqual({ view: 'activity', run: 'clock', entityId: 'inserter:5', tick: 235, signals: ['state', 'hand'], showConnections: true, ranges: { clock: { start: 220, end: 253 } } });
    expect(restored).not.toHaveProperty('comparisonId');
});

it('persists planned crafting-cycle navigation without altering normal timeline ranges', () => {
    const saved = validInspection({ view: 'cycles', cycleIndex: 4, tick: 384, ranges: { windows: { start: 10, end: 60 } } });
    expect(saved).toMatchObject({ view: 'cycles', cycleIndex: 4, tick: 384, ranges: { windows: { start: 10, end: 60 } } });
    expect(validInspection({ cycleIndex: -1 })).not.toHaveProperty('cycleIndex');
});
