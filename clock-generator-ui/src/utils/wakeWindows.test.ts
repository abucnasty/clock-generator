import { describe, expect, it } from 'vitest';
import type { AsBuiltStabilityCheck, FuelInserterPlan, SerializableEntityStateTransitions } from 'clock-generator/browser';
import type { FuelViewData } from '../worker/types';
import {
    axisTicks,
    barsToDraw,
    buildWakeWindowRows,
    coverage,
    drawnSpans,
    lastTickOf,
    mostWokenRowId,
    nearestWindowIndex,
    normalizeWindows,
    stepWindow,
    sumWakeUps,
    tickAtFraction,
    wakeUpsCounted,
    windowLengthTicks,
    type WakeWindowSource,
} from './wakeWindows';

function entity(id: string, extra: Partial<SerializableEntityStateTransitions> = {}): SerializableEntityStateTransitions {
    const [type, number] = id.split(':');
    return {
        entity_id: id,
        entity_type: type as SerializableEntityStateTransitions['entity_type'],
        label: `${type} ${number}`,
        items: [],
        initial_status: 'IDLE',
        transitions: [],
        initial_factorio_state: 'working',
        factorio_states: [],
        ...extra,
    };
}

function asBuilt(wakeUps: Record<string, number> | null): AsBuiltStabilityCheck {
    const inserters = Object.entries(wakeUps ?? {}).map(([inserter_id, wake_ups_per_minute]) => ({
        inserter_id,
        wake_ups_per_minute,
        alarms_per_minute: wake_ups_per_minute,
        enabled_share: 0.5,
        waiting_share: 0.1,
    }));
    return {
        holds: true,
        actual_output_items: 10,
        start_phases_checked: 3,
        ...(wakeUps === null ? {} : {
            wake_ups: {
                ticks: 36000,
                true_starts_unknown: [],
                wake_ups_per_minute: inserters.reduce((sum, it) => sum + it.wake_ups_per_minute, 0),
                inserters,
            },
        }),
    };
}

function fuelView(inserterId: string): FuelViewData {
    const inserter: Partial<FuelInserterPlan> = {
        inserter_id: inserterId,
        modulus: 400,
        window: { start: 10, end: 15 },
        enables_per_minute: 9,
        fuel_item: 'coal',
    };
    return { plan: { period_ticks: 600, merged_clock_ticks: 1200, machines: [], inserters: [inserter as FuelInserterPlan] }, run: null };
}

function source(extra: Partial<WakeWindowSource> = {}): WakeWindowSource {
    return {
        simulationDurationTicks: 600,
        clockWindows: {},
        stateTransitionHistory: { total_duration_ticks: 600, entities: [] },
        asBuilt: null,
        fuelView: null,
        beltPickupSlackTicks: {},
        ...extra,
    };
}

describe('normalizeWindows', () => {
    it('sorts windows', () => {
        expect(normalizeWindows([{ start: 50, end: 59 }, { start: 0, end: 9 }], 600).map(w => w.start)).toEqual([0, 50]);
    });

    it('merges overlapping and touching windows', () => {
        const touching = normalizeWindows([{ start: 0, end: 9 }, { start: 10, end: 19 }], 600);
        expect(touching).toHaveLength(1);
        expect(touching[0]).toMatchObject({ start: 0, end: 19, length: 20, wraps: false });
        const overlapping = normalizeWindows([{ start: 0, end: 15 }, { start: 10, end: 19 }, { start: 30, end: 31 }], 600);
        expect(overlapping.map(w => [w.start, w.end])).toEqual([[0, 19], [30, 31]]);
    });

    it('clamps a window that runs past the period', () => {
        expect(normalizeWindows([{ start: 590, end: 640 }], 600)[0]).toMatchObject({ start: 590, end: 599, length: 10 });
    });

    it('drops an inverted window', () => {
        expect(normalizeWindows([{ start: 20, end: 10 }, { start: 700, end: 710 }], 600)).toEqual([]);
    });

    it('leaves an empty list empty', () => {
        expect(normalizeWindows([], 600)).toEqual([]);
    });

    it('joins a window that wraps past the end of the period into one with two segments', () => {
        const windows = normalizeWindows([{ start: 0, end: 4 }, { start: 96, end: 99 }], 100);
        expect(windows).toHaveLength(1);
        expect(windows[0]).toEqual({
            start: 96,
            end: 4,
            length: 9,
            segments: [{ start: 96, end: 99 }, { start: 0, end: 4 }],
            wraps: true,
            slackTicks: 0,
        });
    });

    it('keeps the wrapped window last, after the others', () => {
        const windows = normalizeWindows([{ start: 0, end: 4 }, { start: 40, end: 49 }, { start: 96, end: 99 }], 100);
        expect(windows.map(w => [w.start, w.end, w.wraps])).toEqual([[40, 49, false], [96, 4, true]]);
    });

    it('does not wrap a lone window at tick 0', () => {
        expect(normalizeWindows([{ start: 0, end: 4 }], 100)[0].wraps).toBe(false);
    });

    it('takes the last tick of a fractional period as its whole part', () => {
        expect(lastTickOf(550.957)).toBe(550);
        expect(lastTickOf(600)).toBe(599);
        const windows = normalizeWindows([{ start: 540, end: 550.957 }, { start: 0, end: 3 }], 550.957);
        expect(windows).toHaveLength(1);
        expect(windows[0]).toMatchObject({ start: 540, end: 3, length: 15, wraps: true });
    });
});

describe('windowLengthTicks', () => {
    it('counts both ends of a window', () => {
        expect(windowLengthTicks({ segments: [{ start: 212, end: 240 }] })).toBe(29);
        expect(windowLengthTicks({ segments: [{ start: 5, end: 5 }] })).toBe(1);
        expect(windowLengthTicks({ segments: [{ start: 96, end: 99 }, { start: 0, end: 4 }] })).toBe(9);
    });
});

describe('coverage', () => {
    it('is 1 for a window over the whole period', () => {
        expect(coverage(normalizeWindows([{ start: 0, end: 599 }], 600), 600)).toBe(1);
    });

    it('adds the windows up', () => {
        expect(coverage(normalizeWindows([{ start: 0, end: 28 }, { start: 212, end: 240 }], 600), 600)).toBeCloseTo(58 / 600);
    });

    it('counts a wrapped window once', () => {
        expect(coverage(normalizeWindows([{ start: 0, end: 4 }, { start: 96, end: 99 }], 100), 100)).toBeCloseTo(0.09);
    });

    it('uses the fractional period', () => {
        const windows = normalizeWindows([{ start: 0, end: 99 }], 550.957);
        expect(windows[0].length).toBe(100);
        expect(coverage(windows, 550.957)).toBeCloseTo(100 / 550.957);
        expect(coverage(normalizeWindows([{ start: 0, end: 550.957 }], 550.957), 550.957)).toBe(1);
    });
});

describe('drawnSpans', () => {
    it('puts the slack at the end of a window', () => {
        const [window] = normalizeWindows([{ start: 10, end: 19 }], 100);
        expect(drawnSpans({ ...window, slackTicks: 4 })).toEqual([
            { start: 10, end: 15, slack: false },
            { start: 16, end: 19, slack: true },
        ]);
    });

    it('puts the slack of a wrapped window in its part from tick 0', () => {
        const [window] = normalizeWindows([{ start: 0, end: 1 }, { start: 96, end: 99 }], 100);
        expect(drawnSpans({ ...window, slackTicks: 3 })).toEqual([
            { start: 96, end: 98, slack: false },
            { start: 99, end: 99, slack: true },
            { start: 0, end: 1, slack: true },
        ]);
    });
});

describe('barsToDraw', () => {
    it('draws each segment of a window as a bar, the slack in it', () => {
        const windows = normalizeWindows([{ start: 0, end: 1 }, { start: 10, end: 19 }, { start: 96, end: 99 }], 100)
            .map(window => ({ ...window, slackTicks: 2 }));
        expect(barsToDraw(windows, 0, null).map(bar => [bar.windowIndex, bar.start, bar.end, bar.spans.map(span => span.slack)]))
            .toEqual([[1, 0, 1, [true]], [0, 10, 19, [false, true]], [1, 96, 99, [false]]]);
    });

    it('merges windows under a pixel wide that lie within a pixel of each other, but never the selected one', () => {
        const windows = normalizeWindows([{ start: 0, end: 0 }, { start: 2, end: 2 }, { start: 4, end: 4 }, { start: 50, end: 50 }], 1000);
        const bars = barsToDraw(windows, 5, null);
        expect(bars.map(bar => [bar.windowIndex, bar.merged, bar.start, bar.end])).toEqual([[0, true, 0, 4], [3, false, 50, 50]]);
        expect(bars[0].spans).toEqual([{ start: 0, end: 4, slack: false }]);
        expect(barsToDraw(windows, 5, 1).map(bar => [bar.windowIndex, bar.merged])).toEqual([[0, false], [1, false], [2, false], [3, false]]);
        expect(barsToDraw(windows, 1, null)).toHaveLength(4);
    });
});

describe('buildWakeWindowRows', () => {
    it('orders inserters then drills, by number', () => {
        const rows = buildWakeWindowRows(source({
            stateTransitionHistory: {
                total_duration_ticks: 600,
                entities: [entity('drill:1'), entity('inserter:10'), entity('machine:1'), entity('inserter:2')],
            },
        }));
        expect(rows.map(row => row.id)).toEqual(['inserter:2', 'inserter:10', 'drill:1']);
        expect(rows.map(row => row.label)).toEqual(['Inserter 2', 'Inserter 10', 'Drill 1']);
    });

    it('says what a row moves, between what, in the names every view uses', () => {
        const [inserter, drill] = buildWakeWindowRows(source({
            stateTransitionHistory: {
                total_duration_ticks: 600,
                entities: [
                    entity('inserter:3', {
                        items: ['iron-plate'],
                        source: { entity_id: 'belt:1', entity_type: 'belt', label: 'Belt 1' },
                        sink: { entity_id: 'machine:2', entity_type: 'machine', label: 'Machine 2 (iron-gear-wheel)' },
                    }),
                    entity('drill:1', {
                        items: ['iron-ore'],
                        sink: { entity_id: 'furnace:4', entity_type: 'furnace', label: 'Machine 4 (iron-plate)' },
                    }),
                ],
            },
        }), [
            { type: 'belt', id: 1, label: 'Belt 1', icon: 'transport-belt' },
            { type: 'machine', id: 2, label: 'Machine 2', icon: 'assembling-machine-3', sublabel: 'Iron gear wheel' },
            { type: 'machine', id: 4, label: 'Machine 4', icon: 'electric-furnace', sublabel: 'Iron plate' },
        ]);
        expect(inserter.items).toEqual(['iron-plate']);
        expect(inserter.route).toBe('Belt\u00a01 to Machine\u00a02');
        expect(drill.items).toEqual(['iron-ore']);
        expect(drill.route).toBe('into Machine\u00a04');
        expect(inserter.source?.id).toBe(1);
        expect(inserter.sink?.sublabel).toBe('Iron gear wheel');
        expect(drill.source).toBeUndefined();
        expect(drill.sink?.sublabel).toBe('Iron plate');
    });

    it('tells the modes apart', () => {
        const rows = buildWakeWindowRows(source({
            clockWindows: { 'inserter:1': [{ start: 0, end: 9 }], 'inserter:2': [] },
            stateTransitionHistory: {
                total_duration_ticks: 600,
                entities: [entity('inserter:1'), entity('inserter:2'), entity('inserter:3'), entity('inserter:4'), entity('drill:1')],
            },
            fuelView: fuelView('inserter:4'),
        }));
        expect(rows.map(row => [row.id, row.mode])).toEqual([
            ['inserter:1', 'windows'],
            ['inserter:2', 'never'],
            ['inserter:3', 'always-on'],
            ['inserter:4', 'own-clock'],
            ['drill:1', 'always-on'],
        ]);
        expect(rows[3].ownClock).toEqual({ windowTicks: 6, everyTicks: 400, perMinute: 9, item: 'coal' });
        expect(rows[3].onShare).toBeCloseTo(6 / 400);
        expect(rows[2].onShare).toBe(1);
        expect(rows[1].onShare).toBe(0);
        expect(rows[0].onTicks).toBe(10);
    });

    it('carries the engine\'s reason on a row the clock leaves always on, and on no other', () => {
        const rows = buildWakeWindowRows(source({
            clockWindows: { 'inserter:1': [{ start: 0, end: 9 }] },
            alwaysOnReasons: { 'inserter:2': { kind: 'busy', period_ticks: 24 }, 'inserter:1': { kind: 'loop' } },
            stateTransitionHistory: {
                total_duration_ticks: 600,
                entities: [entity('inserter:1'), entity('inserter:2'), entity('inserter:3')],
            },
        }));
        expect(rows.map(row => [row.id, row.mode, row.alwaysOnReason])).toEqual([
            ['inserter:1', 'windows', undefined],
            ['inserter:2', 'always-on', { kind: 'busy', period_ticks: 24 }],
            ['inserter:3', 'always-on', undefined],
        ]);
    });

    it('keeps a fuel inserter on the period clock when it has windows', () => {
        const rows = buildWakeWindowRows(source({ clockWindows: { 'inserter:4': [{ start: 0, end: 5 }] }, fuelView: fuelView('inserter:4') }));
        expect(rows[0].mode).toBe('windows');
        expect(rows[0].ownClock).toBeUndefined();
    });

    it('has a row for an id only the wake-ups or only the windows know', () => {
        const rows = buildWakeWindowRows(source({
            clockWindows: { 'inserter:5': [{ start: 0, end: 9 }], 'drill:2': [{ start: 100, end: 120 }] },
            asBuilt: asBuilt({ 'inserter:6': 3 }),
        }));
        expect(rows.map(row => row.id)).toEqual(['inserter:5', 'inserter:6', 'drill:2']);
        expect(rows[0].items).toEqual([]);
        expect(rows[0].route).toBe('');
    });

    it('takes the wake-ups by id, and has none for a drill or a clock without a count', () => {
        const clockWindows = { 'inserter:1': [{ start: 0, end: 9 }], 'inserter:2': [{ start: 20, end: 29 }], 'drill:1': [{ start: 0, end: 9 }] };
        const counted = buildWakeWindowRows(source({ clockWindows, asBuilt: asBuilt({ 'inserter:1': 12.5, 'inserter:2': 3, 'drill:1': 99 }) }));
        expect(counted.map(row => row.wakeUpsPerMinute)).toEqual([12.5, 3, null]);
        const noCheck = buildWakeWindowRows(source({ clockWindows, asBuilt: null }));
        expect(noCheck.map(row => row.wakeUpsPerMinute)).toEqual([null, null, null]);
        const noLongRun = buildWakeWindowRows(source({ clockWindows, asBuilt: asBuilt(null) }));
        expect(noLongRun.map(row => row.wakeUpsPerMinute)).toEqual([null, null, null]);
    });

    it('caps the belt slack at the window, and has none in a fractional period or for an inserter without it', () => {
        const clockWindows = { 'inserter:1': [{ start: 0, end: 9 }, { start: 100, end: 101 }], 'inserter:2': [{ start: 0, end: 9 }] };
        const rows = buildWakeWindowRows(source({ clockWindows, beltPickupSlackTicks: { 'inserter:1': 4 } }));
        expect(rows[0].windows.map(w => w.slackTicks)).toEqual([4, 2]);
        expect(rows[1].windows.map(w => w.slackTicks)).toEqual([0]);
        const fractional = buildWakeWindowRows(source({ clockWindows, beltPickupSlackTicks: { 'inserter:1': 4 }, simulationDurationTicks: 550.957 }));
        expect(fractional[0].windows.map(w => w.slackTicks)).toEqual([0, 0]);
    });
});

describe('sumWakeUps and wakeUpsCounted', () => {
    it('adds the rows up to the clock figure', () => {
        const check = asBuilt({ 'inserter:1': 12.25, 'inserter:2': 3.5, 'inserter:3': 0 });
        const rows = buildWakeWindowRows(source({
            clockWindows: { 'inserter:1': [{ start: 0, end: 9 }], 'drill:1': [{ start: 0, end: 9 }] },
            asBuilt: check,
        }));
        expect(sumWakeUps(rows)).toBeCloseTo(check.wake_ups!.wake_ups_per_minute);
        expect(wakeUpsCounted({ asBuilt: check })).toBe(true);
    });

    it('is null when an inserter has no figure', () => {
        const rows = buildWakeWindowRows(source({
            clockWindows: { 'inserter:1': [{ start: 0, end: 9 }], 'inserter:2': [{ start: 0, end: 9 }] },
            asBuilt: asBuilt({ 'inserter:1': 4 }),
        }));
        expect(sumWakeUps(rows)).toBeNull();
        expect(wakeUpsCounted({ asBuilt: asBuilt(null) })).toBe(false);
        expect(wakeUpsCounted({ asBuilt: null })).toBe(false);
    });

    it('finds the inserter woken most', () => {
        const rows = buildWakeWindowRows(source({ asBuilt: asBuilt({ 'inserter:1': 2, 'inserter:2': 7, 'inserter:3': 7 }) }));
        expect(mostWokenRowId(rows)).toBe('inserter:2');
        expect(mostWokenRowId(buildWakeWindowRows(source({ asBuilt: asBuilt({ 'inserter:1': 0 }) })))).toBeNull();
    });
});

describe('axisTicks', () => {
    const niceStep = (step: number) => {
        const power = 10 ** Math.floor(Math.log10(step));
        return [1, 2, 5].includes(Math.round(step / power));
    };

    it.each([[60, 4], [168, 4], [2240, 6], [550.957, 6], [1, 4]])('marks a period of %s with at most %s marks at a nice step', (period, maxMarks) => {
        const marks = axisTicks(period, maxMarks);
        expect(marks[0]).toBe(0);
        expect(marks.length).toBeLessThanOrEqual(maxMarks);
        expect(marks.every(mark => mark < period)).toBe(true);
        if (marks.length > 1) {
            const step = marks[1] - marks[0];
            expect(niceStep(step)).toBe(true);
            expect(marks.every((mark, index) => mark === index * step)).toBe(true);
        }
    });

    it('picks the finest step that fits', () => {
        expect(axisTicks(600, 10)).toEqual([0, 100, 200, 300, 400, 500]);
        expect(axisTicks(600, 6)).toEqual([0, 100, 200, 300, 400, 500]);
        expect(axisTicks(60, 10)).toEqual([0, 10, 20, 30, 40, 50]);
        expect(axisTicks(1, 6)).toEqual([0]);
    });
});

describe('pointer and keys', () => {
    const windows = normalizeWindows([{ start: 10, end: 19 }, { start: 50, end: 52 }], 100);

    it('clamps the tick under a point to the period', () => {
        expect(tickAtFraction(-0.5, 100)).toBe(0);
        expect(tickAtFraction(0.25, 100)).toBe(25);
        expect(tickAtFraction(1.5, 100)).toBe(100);
    });

    it('picks the nearer window within the tolerance', () => {
        expect(nearestWindowIndex(windows, 15, 0)).toBe(0);
        expect(nearestWindowIndex(windows, 45, 10)).toBe(1);
        expect(nearestWindowIndex(windows, 25, 10)).toBe(0);
        expect(nearestWindowIndex(windows, 35, 10)).toBeNull();
        expect(nearestWindowIndex([], 10, 100)).toBeNull();
    });

    it('steps through the windows without wrapping', () => {
        expect(stepWindow(null, 3, 'next')).toBe(0);
        expect(stepWindow(0, 3, 'next')).toBe(1);
        expect(stepWindow(2, 3, 'next')).toBe(2);
        expect(stepWindow(1, 3, 'previous')).toBe(0);
        expect(stepWindow(0, 3, 'previous')).toBe(0);
        expect(stepWindow(null, 3, 'previous')).toBe(2);
        expect(stepWindow(1, 3, 'first')).toBe(0);
        expect(stepWindow(null, 3, 'last')).toBe(2);
        expect(stepWindow(null, 0, 'next')).toBeNull();
        expect(stepWindow(1, 0, 'first')).toBeNull();
    });
});
