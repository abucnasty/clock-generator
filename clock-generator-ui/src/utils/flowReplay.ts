import type { TimelineEvent, TimelineRecording, TimelineValue } from 'clock-generator/browser';
import { craftingCycles } from './craftingCycles';
import { timelineValueAt, upperBound } from './timelineInspection';

export function flowReplayIndex(recording: TimelineRecording) {
    const events = recording.events.filter(event => ['pickup', 'drop', 'produce'].includes(event.kind)).sort((a, b) => a.tick - b.tick);
    return {
        entities: new Map(recording.entities.map(entity => [entity.id, { entity, signals: new Map(entity.signals.map(signal => [signal.id, signal])) }])),
        events, eventTicks: events.map(event => event.tick),
        transferTicks: [...new Set(events.filter(event => event.kind !== 'produce').map(event => event.tick))],
    };
}
export type FlowReplayIndex = ReturnType<typeof flowReplayIndex>;
export interface FlowReplaySnapshot {
    state?: string; enabled?: boolean; craft?: number; hand?: number; handItem?: string; produced?: number;
    inventory: { label: string; item?: string; value: TimelineValue; unit: string }[];
}
/** Random-access snapshots make backward seeking identical to forward playback. */
export function flowReplaySnapshot(index: FlowReplayIndex, entityId: string, tick: number): FlowReplaySnapshot {
    const entry = index.entities.get(entityId);
    const value = (id: string) => { const signal = entry?.signals.get(id); return signal ? timelineValueAt(signal, tick) : undefined; };
    const numeric = (id: string) => typeof value(id) === 'number' ? Number(value(id)) : undefined;
    return { state: value('state') as string | undefined, enabled: value('enabled') === undefined ? undefined : Boolean(value('enabled')),
        craft: numeric('craft'), hand: numeric('hand'), handItem: value('hand-item') as string | undefined, produced: numeric('produced'),
        inventory: (entry?.entity.signals ?? []).filter(signal => ['inventory', 'fuel'].includes(signal.group)).map(signal => ({ label: signal.label, item: signal.item, value: timelineValueAt(signal, tick)!, unit: signal.unit })),
    };
}
export function flowReplayEvents(index: FlowReplayIndex, start: number, end: number): TimelineEvent[] {
    return index.events.slice(upperBound(index.eventTicks, start - 1), upperBound(index.eventTicks, end));
}
/** Strictly before/after the cursor, including multiple transfers at a tick as one step. */
export function adjacentTransfer(index: Pick<FlowReplayIndex, 'transferTicks'>, tick: number, direction: -1 | 1, start = 0, end = Infinity): number | null {
    const ticks = index.transferTicks;
    const position = direction === 1 ? upperBound(ticks, tick) : upperBound(ticks, tick - 1) - 1;
    const next = ticks[position];
    return next !== undefined && next >= start && next <= end ? next : null;
}

/** Aggregate only presentation effects; the underlying events and tick inspector stay exact. */
export function flowEventSummary(events: TimelineEvent[], entityId: string) {
    const result = new Map<string, { kind: TimelineEvent['kind']; item?: string; amount: number }>();
    for (const event of events) {
        if (event.entity_id !== entityId) continue;
        const key = `${event.kind}:${event.item ?? ''}`;
        const previous = result.get(key);
        result.set(key, { kind: event.kind, item: event.item, amount: (previous?.amount ?? 0) + event.amount });
    }
    return [...result.values()];
}

/** The recorder rounds its last simulated tick up; that fraction is not an extra planned cycle. */
export function flowReplayCycles(cycleTicks: number, recording: Pick<TimelineRecording, 'period_ticks' | 'end_tick'>) {
    return craftingCycles(cycleTicks, Math.min(recording.end_tick, recording.period_ticks));
}

/** Transfer stepping follows whole routes through connected inserters, not machine production events. */
export function flowTransferTicks(index: FlowReplayIndex, entityId: string | null): number[] {
    if (entityId === null) return index.transferTicks;
    const inserters = new Set<string>();
    if (index.entities.get(entityId)?.entity.type === 'inserter') inserters.add(entityId);
    for (const { entity } of index.entities.values()) {
        if (entity.type === 'inserter' && (entity.source === entityId || entity.sink === entityId)) inserters.add(entity.id);
    }
    return [...new Set(index.events.filter(event => event.kind !== 'produce' && (inserters.has(event.entity_id) || event.source === entityId || event.sink === entityId)).map(event => event.tick))];
}

export const FLOW_TRAIL_TICKS = 12;
/** Quantities always describe one exact tick. Trails carry no amounts and do not change with playback speed. */
export function flowReplayFrame(index: FlowReplayIndex, tick: number) {
    const recentStart = Math.max(0, tick - FLOW_TRAIL_TICKS);
    return { events: flowReplayEvents(index, tick, tick), recentStart,
        recentTransfers: flowReplayEvents(index, recentStart, tick - 1).filter(event => event.kind !== 'produce') };
}
export interface FlowTransferAmount { item?: string; amount: number }
export function flowTransferAmounts(events: readonly TimelineEvent[]): FlowTransferAmount[] {
    const amounts = new Map<string | undefined, number>();
    for (const event of events) amounts.set(event.item, (amounts.get(event.item) ?? 0) + event.amount);
    return [...amounts].map(([item, amount]) => ({ item, amount }));
}
