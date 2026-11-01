import { describe, expect, it } from 'vitest';
import type { AsBuiltStabilityCheck, CompactEntityStateTransitions, FuelInserterPlan } from 'clock-generator/browser';
import type { FuelViewData } from '../worker/types';
import type { EntityOption } from './inserterOptions';
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
    type TickSpan,
    type WakeWindowSource,
} from './wakeWindows';

type Pair = [start: number, end: number];

const spans = (...pairs: Pair[]): TickSpan[] => pairs.map(([start, end]) => ({ start, end }));
const normalize = (period: number, ...pairs: Pair[]) => normalizeWindows(spans(...pairs), period);

function entity(id: string, extra: Partial<CompactEntityStateTransitions> = {}): CompactEntityStateTransitions {
    const [type, number] = id.split(':');
    return {
        entity_id: id,
        entity_type: type as CompactEntityStateTransitions['entity_type'],
        label: `${type} ${number}`,
        items: [],
        initial_status: 'IDLE',
        initial_factorio_state: 'working',
        columns: { tick: new Int32Array(0), from: new Uint8Array(0), to: new Uint8Array(0), reason: new Uint32Array(0), state_tick: new Int32Array(0), state: new Uint8Array(0) },
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
        uncounted_per_minute: { 'arm away': 0 },
        input_wake_ups_per_minute: 0,
        output_wake_ups_per_minute: wake_ups_per_minute,
    }));
    return {
        holds: true,
        actual_output_items: 10,
        start_phases_checked: 3,
        ...(wakeUps === null ? {} : {
            wake_ups: {
                ticks: 36000,
                true_starts_unknown: [],
                uncounted_per_minute: { 'arm away': 0 },
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

type SourceFields = Partial<WakeWindowSource> & { entities?: (string | CompactEntityStateTransitions)[] };

/** A clock of 600 ticks with only what a test gives; `entities` are the run's, by id or in full */
function source({ entities = [], ...extra }: SourceFields = {}): WakeWindowSource {
    return {
        simulationDurationTicks: 600,
        clockWindows: {},
        stateTransitionHistory: { reasons: [], total_duration_ticks: 600, entities: entities.map(one => typeof one === 'string' ? entity(one) : one) },
        asBuilt: null,
        fuelView: null,
        beltPickupSlackTicks: {},
        ...extra,
    };
}

const rowsOf = (fields?: SourceFields, options?: EntityOption[]) => buildWakeWindowRows(source(fields), options);

describe('normalizeWindows', () => {
    const shape = (period: number, ...pairs: Pair[]) => normalize(period, ...pairs).map(w => [w.start, w.end, w.length, w.wraps]);

    it.each<[string, number, Pair[], [number, number, number, boolean][]]>([
        ['sorts windows', 600, [[50, 59], [0, 9]], [[0, 9, 10, false], [50, 59, 10, false]]],
        ['merges touching windows', 600, [[0, 9], [10, 19]], [[0, 19, 20, false]]],
        ['merges overlapping windows', 600, [[0, 15], [10, 19], [30, 31]], [[0, 19, 20, false], [30, 31, 2, false]]],
        ['clamps a window that runs past the period', 600, [[590, 640]], [[590, 599, 10, false]]],
        ['drops an inverted window', 600, [[20, 10], [700, 710]], []],
        ['leaves an empty list empty', 600, [], []],
        ['does not wrap a lone window at tick 0', 100, [[0, 4]], [[0, 4, 5, false]]],
        ['keeps the wrapped window last, after the others', 100, [[0, 4], [40, 49], [96, 99]], [[40, 49, 10, false], [96, 4, 9, true]]],
    ])('%s', (_name, period, raw, windows) => {
        expect(shape(period, ...raw)).toEqual(windows);
    });

    it('joins a window that wraps past the end of the period into one with two segments', () => {
        expect(normalize(100, [0, 4], [96, 99])).toEqual([{ start: 96, end: 4, length: 9, segments: spans([96, 99], [0, 4]), wraps: true, slackTicks: 0 }]);
    });

    it('takes the last tick of a fractional period as its whole part', () => {
        expect([lastTickOf(550.957), lastTickOf(600)]).toEqual([550, 599]);
        expect(shape(550.957, [540, 550.957], [0, 3])).toEqual([[540, 3, 15, true]]);
    });
});

describe('windowLengthTicks', () => {
    it('counts both ends of a window', () => {
        expect(windowLengthTicks({ segments: spans([212, 240]) })).toBe(29);
        expect(windowLengthTicks({ segments: spans([5, 5]) })).toBe(1);
        expect(windowLengthTicks({ segments: spans([96, 99], [0, 4]) })).toBe(9);
    });
});

describe('coverage', () => {
    it.each<[string, number, Pair[], number]>([
        ['is 1 for a window over the whole period', 600, [[0, 599]], 1],
        ['adds the windows up', 600, [[0, 28], [212, 240]], 58 / 600],
        ['counts a wrapped window once', 100, [[0, 4], [96, 99]], 9 / 100],
        ['uses the fractional period', 550.957, [[0, 99]], 100 / 550.957],
        ['is at most 1 over a fractional period', 550.957, [[0, 550.957]], 1],
    ])('%s', (_name, period, raw, share) => {
        expect(coverage(normalize(period, ...raw), period)).toBe(share);
    });
});

describe('drawnSpans', () => {
    it('puts the slack at the end of a window', () => {
        const [window] = normalize(100, [10, 19]);
        expect(drawnSpans({ ...window, slackTicks: 4 })).toEqual([{ start: 10, end: 15, slack: false }, { start: 16, end: 19, slack: true }]);
    });

    it('puts the slack of a wrapped window in its part from tick 0', () => {
        const [window] = normalize(100, [0, 1], [96, 99]);
        expect(drawnSpans({ ...window, slackTicks: 3 })).toEqual([
            { start: 96, end: 98, slack: false },
            { start: 99, end: 99, slack: true },
            { start: 0, end: 1, slack: true },
        ]);
    });
});

describe('barsToDraw', () => {
    it('draws each segment of a window as a bar, the slack in it', () => {
        const windows = normalize(100, [0, 1], [10, 19], [96, 99]).map(window => ({ ...window, slackTicks: 2 }));
        expect(barsToDraw(windows, 0, null).map(bar => [bar.windowIndex, bar.start, bar.end, bar.spans.map(span => span.slack)]))
            .toEqual([[1, 0, 1, [true]], [0, 10, 19, [false, true]], [1, 96, 99, [false]]]);
    });

    it('merges windows under a pixel wide that lie within a pixel of each other, but never the selected one', () => {
        const windows = normalize(1000, [0, 0], [2, 2], [4, 4], [50, 50]);
        const bars = barsToDraw(windows, 5, null);
        expect(bars.map(bar => [bar.windowIndex, bar.merged, bar.start, bar.end])).toEqual([[0, true, 0, 4], [3, false, 50, 50]]);
        expect(bars[0].spans).toEqual([{ start: 0, end: 4, slack: false }]);
        expect(barsToDraw(windows, 5, 1).map(bar => [bar.windowIndex, bar.merged])).toEqual([[0, false], [1, false], [2, false], [3, false]]);
        expect(barsToDraw(windows, 1, null)).toHaveLength(4);
    });
});

describe('buildWakeWindowRows', () => {
    it('orders inserters then drills, by number', () => {
        const rows = rowsOf({ entities: ['drill:1', 'inserter:10', 'machine:1', 'inserter:2'] });
        expect(rows.map(row => [row.id, row.label])).toEqual([['inserter:2', 'Inserter 2'], ['inserter:10', 'Inserter 10'], ['drill:1', 'Drill 1']]);
    });

    it('says what a row moves, between what, in the names every view uses', () => {
        const [inserter, drill] = rowsOf({
            entities: [
                entity('inserter:3', {
                    items: ['iron-plate'],
                    source: { entity_id: 'belt:1', entity_type: 'belt', label: 'Belt 1' },
                    sink: { entity_id: 'machine:2', entity_type: 'machine', label: 'Machine 2 (iron-gear-wheel)' },
                }),
                entity('drill:1', { items: ['iron-ore'], sink: { entity_id: 'furnace:4', entity_type: 'furnace', label: 'Machine 4 (iron-plate)' } }),
            ],
        }, [
            { type: 'belt', id: 1, label: 'Belt 1', icon: 'transport-belt' },
            { type: 'machine', id: 2, label: 'Machine 2', icon: 'assembling-machine-3', sublabel: 'Iron gear wheel' },
            { type: 'machine', id: 4, label: 'Machine 4', icon: 'electric-furnace', sublabel: 'Iron plate' },
        ]);
        // each end's word and number stay together when the row wraps
        expect(inserter).toMatchObject({ items: ['iron-plate'], route: 'Belt\u00a01 to Machine\u00a02', source: { id: 1 }, sink: { sublabel: 'Iron gear wheel' } });
        expect(drill).toMatchObject({ items: ['iron-ore'], route: 'into Machine\u00a04', sink: { sublabel: 'Iron plate' } });
        expect(drill.source).toBeUndefined();
    });

    it('tells the modes apart', () => {
        const rows = rowsOf({
            clockWindows: { 'inserter:1': spans([0, 9]), 'inserter:2': [] },
            entities: ['inserter:1', 'inserter:2', 'inserter:3', 'inserter:4', 'drill:1'],
            fuelView: fuelView('inserter:4'),
        });
        expect(rows.map(row => [row.id, row.mode, row.onShare])).toEqual([
            ['inserter:1', 'windows', 10 / 600],
            ['inserter:2', 'never', 0],
            ['inserter:3', 'always-on', 1],
            ['inserter:4', 'own-clock', 6 / 400],
            ['drill:1', 'always-on', 1],
        ]);
        expect(rows[3].ownClock).toEqual({ windowTicks: 6, everyTicks: 400, perMinute: 9, item: 'coal' });
        expect(rows[0].onTicks).toBe(10);
    });

    it('carries the engine\'s reason on a row the clock leaves always on, and on no other', () => {
        const rows = rowsOf({
            clockWindows: { 'inserter:1': spans([0, 9]) },
            alwaysOnReasons: { 'inserter:2': { kind: 'busy', period_ticks: 24 }, 'inserter:1': { kind: 'loop' } },
            entities: ['inserter:1', 'inserter:2', 'inserter:3'],
        });
        expect(rows.map(row => [row.id, row.mode, row.alwaysOnReason])).toEqual([
            ['inserter:1', 'windows', undefined],
            ['inserter:2', 'always-on', { kind: 'busy', period_ticks: 24 }],
            ['inserter:3', 'always-on', undefined],
        ]);
    });

    it('keeps a fuel inserter on the period clock when it has windows', () => {
        const [row] = rowsOf({ clockWindows: { 'inserter:4': spans([0, 5]) }, fuelView: fuelView('inserter:4') });
        expect(row.mode).toBe('windows');
        expect(row.ownClock).toBeUndefined();
    });

    it('has a row for an id only the wake-ups or only the windows know', () => {
        const rows = rowsOf({ clockWindows: { 'inserter:5': spans([0, 9]), 'drill:2': spans([100, 120]) }, asBuilt: asBuilt({ 'inserter:6': 3 }) });
        expect(rows.map(row => row.id)).toEqual(['inserter:5', 'inserter:6', 'drill:2']);
        expect(rows[0]).toMatchObject({ items: [], route: '' });
    });

    it('takes the wake-ups by id, and has none for a drill or a clock without a count', () => {
        const clockWindows = { 'inserter:1': spans([0, 9]), 'inserter:2': spans([20, 29]), 'drill:1': spans([0, 9]) };
        const wakeUps = (check: AsBuiltStabilityCheck | null) => rowsOf({ clockWindows, asBuilt: check }).map(row => row.wakeUpsPerMinute);
        expect(wakeUps(asBuilt({ 'inserter:1': 12.5, 'inserter:2': 3, 'drill:1': 99 }))).toEqual([12.5, 3, null]);
        expect(wakeUps(null)).toEqual([null, null, null]);
        expect(wakeUps(asBuilt(null))).toEqual([null, null, null]);
    });

    it('caps the belt slack at the window, and has none in a fractional period or for an inserter without it', () => {
        const clockWindows = { 'inserter:1': spans([0, 9], [100, 101]), 'inserter:2': spans([0, 9]) };
        const slack = (simulationDurationTicks: number) => rowsOf({ clockWindows, beltPickupSlackTicks: { 'inserter:1': 4 }, simulationDurationTicks })
            .map(row => row.windows.map(w => w.slackTicks));
        expect(slack(600)).toEqual([[4, 2], [0]]);
        expect(slack(550.957)).toEqual([[0, 0], [0]]);
    });
});

describe('sumWakeUps and wakeUpsCounted', () => {
    it('adds the rows up to the clock figure', () => {
        const check = asBuilt({ 'inserter:1': 12.25, 'inserter:2': 3.5, 'inserter:3': 0 });
        const rows = rowsOf({ clockWindows: { 'inserter:1': spans([0, 9]), 'drill:1': spans([0, 9]) }, asBuilt: check });
        expect(sumWakeUps(rows)).toBeCloseTo(check.wake_ups!.wake_ups_per_minute);
        expect(wakeUpsCounted({ asBuilt: check })).toBe(true);
    });

    it('is null when an inserter has no figure', () => {
        const rows = rowsOf({ clockWindows: { 'inserter:1': spans([0, 9]), 'inserter:2': spans([0, 9]) }, asBuilt: asBuilt({ 'inserter:1': 4 }) });
        expect(sumWakeUps(rows)).toBeNull();
        expect(wakeUpsCounted({ asBuilt: asBuilt(null) })).toBe(false);
        expect(wakeUpsCounted({ asBuilt: null })).toBe(false);
    });

    it('finds the inserter woken most', () => {
        expect(mostWokenRowId(rowsOf({ asBuilt: asBuilt({ 'inserter:1': 2, 'inserter:2': 7, 'inserter:3': 7 }) }))).toBe('inserter:2');
        expect(mostWokenRowId(rowsOf({ asBuilt: asBuilt({ 'inserter:1': 0 }) }))).toBeNull();
    });
});

describe('axisTicks', () => {
    it.each([
        [60, 4, [0, 20, 40]],
        [168, 4, [0, 50, 100, 150]],
        [2240, 6, [0, 500, 1000, 1500, 2000]],
        [550.957, 6, [0, 100, 200, 300, 400, 500]],
        [600, 6, [0, 100, 200, 300, 400, 500]],
        [600, 10, [0, 100, 200, 300, 400, 500]],
        [60, 10, [0, 10, 20, 30, 40, 50]],
        [1, 6, [0]],
    ])('marks a period of %s with at most %s marks, at the finest step of 1, 2 or 5 that fits', (period, maxMarks, marks) => {
        expect(axisTicks(period, maxMarks)).toEqual(marks);
    });
});

describe('pointer and keys', () => {
    const windows = normalize(100, [10, 19], [50, 52]);

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
