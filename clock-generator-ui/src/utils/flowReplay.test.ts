import { describe, expect, it } from 'vitest';
import type { TimelineRecording } from 'clock-generator/browser';
import { adjacentTransfer, flowEventSummary, flowReplayEvents, flowReplayFrame, flowTransferTicks, flowTransferAmounts, flowReplayIndex, flowReplaySnapshot } from './flowReplay';
import { validInspection } from './timelineInspection';

const recording = { entities: [{ id: 'inserter:1', type: 'inserter', source: 'belt:1', sink: 'machine:1', items: ['iron-plate'], signals: [
    { id: 'hand', ticks: [0, 3, 5, 8], values: [0, 16, 10, 0], group: 'hand', unit: 'items' },
    { id: 'hand-item', ticks: [0, 3, 8], values: ['', 'iron-plate', ''], group: 'hand', unit: 'state' },
    { id: 'enabled', ticks: [0, 7], values: [1, 0], group: 'state', unit: 'enabled' },
] }, { id: 'machine:1', type: 'machine', signals: [
    { id: 'input:iron-plate', label: 'Ingredient', item: 'iron-plate', ticks: [0, 5, 8], values: [2, 8, 18], group: 'inventory', unit: 'items' },
    { id: 'burning', label: 'Burning fuel remaining', ticks: [0, 5], values: [3.2, 2.8], group: 'fuel', unit: 'MJ' },
] }], events: [
    { tick: 8, kind: 'drop', entity_id: 'inserter:1', amount: 10, item: 'iron-plate' },
    { tick: 5, kind: 'drop', entity_id: 'inserter:1', amount: 6, item: 'iron-plate' },
    { tick: 3, kind: 'pickup', entity_id: 'inserter:1', amount: 16, item: 'iron-plate' },
    { tick: 5, kind: 'produce', entity_id: 'machine:1', amount: 2, item: 'gear' },
    { tick: 5, kind: 'craft-complete', entity_id: 'machine:1', amount: 1 },
] } as TimelineRecording;

describe('flow replay', () => {
    it('supports exact backward seeking, partial deliveries and baseline inventory/fuel without mutating the recording', () => {
        const index = flowReplayIndex(recording);
        expect(flowReplaySnapshot(index, 'inserter:1', 8)).toMatchObject({ hand: 0, handItem: '', enabled: false });
        expect(flowReplaySnapshot(index, 'inserter:1', 5)).toMatchObject({ hand: 10, handItem: 'iron-plate', enabled: true });
        expect(flowReplaySnapshot(index, 'inserter:1', 0).hand).toBe(0);
        expect(flowReplaySnapshot(index, 'machine:1', 0).inventory).toEqual([
            { label: 'Ingredient', item: 'iron-plate', value: 2, unit: 'items' },
            { label: 'Burning fuel remaining', item: undefined, value: 3.2, unit: 'MJ' },
        ]);
        expect(recording.events[0].tick).toBe(8);
    });
    it('steps strictly between transfer ticks and respects the selected crafting-cycle bounds', () => {
        const index = flowReplayIndex(recording);
        expect(adjacentTransfer(index, 3, 1)).toBe(5);
        expect(adjacentTransfer(index, 5, -1)).toBe(3);
        expect(adjacentTransfer(index, 5, -1, 4, 8)).toBeNull();
        expect(adjacentTransfer(index, 5, 1, 0, 7)).toBeNull();
        expect(adjacentTransfer(index, 8, 1)).toBeNull();
    });
    it('groups only visual effects, keeping production distinct from transferred quantities', () => {
        const index = flowReplayIndex(recording);
        expect(flowReplayEvents(index, 5, 5)).toHaveLength(2);
        const effects = flowReplayEvents(index, 3, 8);
        expect(flowEventSummary(effects, 'inserter:1')).toEqual([
            { kind: 'pickup', item: 'iron-plate', amount: 16 }, { kind: 'drop', item: 'iron-plate', amount: 16 },
        ]);
        expect(flowEventSummary(effects, 'machine:1')).toEqual([{ kind: 'produce', item: 'gear', amount: 2 }]);
    });
    it('preserves valid replay context and rejects unsafe saved viewport values', () => {
        expect(validInspection({ view: 'flow', replaySpeed: 4, replayCycleOnly: true, replayTransferScope: 'selection', replayViewport: { x: 20, y: -30, zoom: 0.8 } })).toMatchObject({ view: 'flow', replaySpeed: 4, replayCycleOnly: true, replayTransferScope: 'selection', replayViewport: { x: 20, y: -30, zoom: 0.8 } });
        const invalid = validInspection({ replayTransferScope: 'broken', replaySpeed: 1000, replayViewport: { x: NaN, y: 0, zoom: -1 } });
        expect(invalid).not.toHaveProperty('replaySpeed');
        expect(invalid).not.toHaveProperty('replayTransferScope');
        expect(validInspection({ replayTransferScope: 'all' }).replayTransferScope).toBe('all');
        expect(invalid).not.toHaveProperty('replayViewport');
    });
});

it('uses the exact clock period for fractional crafting cycles, including truncated excerpts', async () => {
    const { flowReplayCycles } = await import('./flowReplay');
    expect(flowReplayCycles(50.087, { period_ticks: 50.087 * 11, end_tick: 551 })?.count).toBe(11);
    expect(flowReplayCycles(50.087, { period_ticks: 50.087 * 11, end_tick: 120 })?.count).toBe(3);
});


describe('route-aware transfers', () => {
    const routes = {
        ...recording,
        entities: [...recording.entities,
            { id: 'belt:1', type: 'belt', signals: [] },
            { id: 'inserter:2', type: 'inserter', source: 'belt:1', sink: 'machine:2', signals: [] },
            { id: 'inserter:3', type: 'inserter', source: 'machine:1', sink: 'chest:1', signals: [] },
            { id: 'inserter:4', type: 'inserter', source: 'belt:2', sink: 'machine:2', signals: [] },
            { id: 'drill:1', type: 'drill', signals: [] },
        ],
        events: [...recording.events,
            { tick: 2, kind: 'pickup', entity_id: 'inserter:4', amount: 2 },
            { tick: 4, kind: 'pickup', entity_id: 'inserter:2', amount: 5 },
            { tick: 6, kind: 'drop', entity_id: 'inserter:2', amount: 5 },
            { tick: 5, kind: 'pickup', entity_id: 'inserter:3', amount: 2 },
            { tick: 7, kind: 'drop', entity_id: 'inserter:3', amount: 2 },
            { tick: 9, kind: 'produce', entity_id: 'machine:1', amount: 4 },
        ],
    } as TimelineRecording;
    it('includes both halves of every connected route for belts and machines, excluding unrelated transfers and production', () => {
        const index = flowReplayIndex(routes);
        expect(flowTransferTicks(index, 'belt:1')).toEqual([3, 4, 5, 6, 8]);
        expect(flowTransferTicks(index, 'machine:1')).toEqual([3, 5, 7, 8]);
        expect(flowTransferTicks(index, 'inserter:1')).toEqual([3, 5, 8]);
        expect(flowTransferTicks(index, 'drill:1')).toEqual([]);
        expect(flowTransferTicks(index, null)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    });
    it('steps forward and backward within the chosen scope and cycle bounds', () => {
        const index = flowReplayIndex(routes);
        const scoped = { transferTicks: flowTransferTicks(index, 'machine:1') };
        expect(adjacentTransfer(scoped, 5, 1)).toBe(7);
        expect(adjacentTransfer(scoped, 5, -1)).toBe(3);
        expect(adjacentTransfer(scoped, 5, 1, 0, 6)).toBeNull();
        expect(adjacentTransfer(scoped, 5, -1, 4, 8)).toBeNull();
        expect(adjacentTransfer(index, 5, 1)).toBe(6);
    });
});

describe('exact-tick quantities', () => {
    it('separates quantities from an unnumbered fixed recent trail and excludes future events', () => {
        const index = flowReplayIndex(recording);
        const frame = flowReplayFrame(index, 5);
        expect(frame.events.map(event => [event.kind, event.amount])).toEqual([['drop', 6], ['produce', 2]]);
        expect(frame.recentTransfers.map(event => event.tick)).toEqual([3]);
        expect(flowEventSummary(frame.events, 'inserter:1')).toEqual([{ kind: 'drop', item: 'iron-plate', amount: 6 }]);
        expect(flowReplayFrame(index, 5)).toEqual(frame); // Seeking back yields the same frame as playback.
        expect(flowReplayFrame(index, 0).recentTransfers).toEqual([]);
        expect(flowReplayFrame(index, 21).recentTransfers).toEqual([]);
    });
    it('keeps each item separate when several transfers share an edge and tick', () => {
        const events = [
            { tick: 5, kind: 'drop', entity_id: 'inserter:1', item: 'iron-plate', amount: 6 },
            { tick: 5, kind: 'drop', entity_id: 'inserter:1', item: 'copper-plate', amount: 3 },
            { tick: 5, kind: 'drop', entity_id: 'inserter:1', item: 'iron-plate', amount: 2 },
        ] as TimelineRecording['events'];
        expect(flowTransferAmounts(events)).toEqual([
            { item: 'iron-plate', amount: 8 }, { item: 'copper-plate', amount: 3 },
        ]);
    });
});
