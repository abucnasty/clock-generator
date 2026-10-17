import type { TimelineEntity, TimelineEvent, TimelineRecording, TimelineSeries, TimelineValue } from 'clock-generator/browser';

export interface TimelineRange { start: number; end: number }
export type TimelineSignalGroup = TimelineSeries['group'] | 'transfers' | 'throughput' | 'buffers';
export interface TimelineInspection {
    /** 'states' is accepted for older saved contexts and migrates to Activity with a signal preset. */
    view: 'windows' | 'activity' | 'states' | 'transfers';
    run: 'clock' | 'plan';
    entityId: string | null;
    tick: number;
    ranges: Partial<Record<'windows' | 'clock' | 'plan', TimelineRange>>;
    signals: TimelineSignalGroup[];
    comparisonId: string | null;
    showConnections?: boolean;
}
export const DEFAULT_INSPECTION: TimelineInspection = { view: 'windows', run: 'clock', entityId: null, tick: 0, ranges: {}, signals: ['state', 'inventory', 'transfers'], comparisonId: null };
export const SIGNAL_GROUPS: TimelineSignalGroup[] = ['state', 'inventory', 'transfers', 'buffers', 'progress', 'hand', 'fuel', 'production', 'throughput'];
export const timelineEntityName = (entity: Pick<TimelineEntity, 'id' | 'type' | 'recipe'>, recipeLabel: (id: string) => string) =>
    `${entity.type[0].toUpperCase()}${entity.type.slice(1)} ${entity.id.split(':')[1]}${entity.recipe ? ` · ${recipeLabel(entity.recipe)}` : ''}`;

export function validInspection(value: unknown): TimelineInspection {
    const input = value && typeof value === 'object' ? value as Partial<TimelineInspection> : {};
    const ranges: TimelineInspection['ranges'] = {};
    for (const key of ['windows', 'clock', 'plan'] as const) {
        const range = input.ranges?.[key];
        if (range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end > range.start && range.end <= 500_000) ranges[key] = { start: range.start, end: range.end };
    }
    return {
        view: input.view === 'states' ? 'activity' : ['windows', 'activity', 'transfers'].includes(input.view ?? '') ? input.view! : 'windows',
        run: input.run === 'plan' ? 'plan' : 'clock',
        entityId: typeof input.entityId === 'string' && /^(machine|inserter|drill|belt|chest):\d+$/.test(input.entityId) ? input.entityId : null,
        tick: typeof input.tick === 'number' && Number.isFinite(input.tick) ? Math.max(0, Math.min(500_000, Math.round(input.tick))) : 0,
        ranges,
        signals: input.view === 'states' ? ['state'] : Array.isArray(input.signals) ? [...new Set(input.signals.filter(group => SIGNAL_GROUPS.includes(group)))] : DEFAULT_INSPECTION.signals,
        showConnections: input.showConnections === true,
        comparisonId: typeof input.comparisonId === 'string' && input.comparisonId.length < 200 ? input.comparisonId : null,
    };
}

export function clampTimelineRange(range: TimelineRange | undefined, duration: number): TimelineRange {
    const end = Number.isFinite(duration) ? Math.max(1, duration) : 1;
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) return { start: 0, end };
    const span = Math.min(end, Math.max(1, range.end - range.start));
    const start = Math.max(0, Math.min(end - span, range.start));
    return { start, end: start + span };
}
export function zoomTimeline(range: TimelineRange, factor: number, tick: number, duration: number): TimelineRange {
    const span = Math.max(1, Math.min(duration, (range.end - range.start) * factor));
    const center = Math.max(range.start, Math.min(range.end, tick));
    return clampTimelineRange({ start: center - span / 2, end: center + span / 2 }, duration);
}
export function panTimeline(range: TimelineRange, direction: number, duration: number): TimelineRange {
    const delta = (range.end - range.start) * direction;
    return clampTimelineRange({ start: range.start + delta, end: range.end + delta }, duration);
}
export function upperBound(ticks: readonly number[], tick: number): number {
    let lo = 0, hi = ticks.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (ticks[mid] <= tick) lo = mid + 1; else hi = mid; }
    return lo;
}
export function timelineValueAt(series: TimelineSeries, tick: number): TimelineValue | undefined {
    return series.values[Math.max(0, upperBound(series.ticks, tick) - 1)];
}

/** Cull before drawing, retaining the value carried into the viewport and exact extrema in each pixel bucket. */
export function timelinePoints(series: TimelineSeries, range: TimelineRange, pixels: number): { tick: number; value: number }[] {
    const first = Math.max(0, upperBound(series.ticks, range.start) - 1);
    const last = upperBound(series.ticks, range.end);
    const result: { tick: number; value: number }[] = [];
    const width = Math.max(1, pixels), span = range.end - range.start;
    let bucket = -1, indices: number[] = [];
    const flush = () => {
        if (!indices.length) return;
        let min = indices[0], max = min;
        for (const index of indices) { if (Number(series.values[index]) < Number(series.values[min])) min = index; if (Number(series.values[index]) > Number(series.values[max])) max = index; }
        for (const i of [...new Set([indices[0], min, max, indices[indices.length - 1]])].sort((a, b) => a - b)) result.push({ tick: Math.max(range.start, series.ticks[i]), value: Number(series.values[i]) });
    };
    for (let index = first; index < last; index++) {
        const next = Math.floor((series.ticks[index] - range.start) / span * width);
        if (next !== bucket) { flush(); indices = []; bucket = next; }
        indices.push(index);
    }
    flush();
    const endValue = timelineValueAt(series, range.end);
    if (typeof endValue === 'number') result.push({ tick: range.end, value: endValue });
    return result;
}

export function relatedTimelineEntities(recording: TimelineRecording, selected: TimelineEntity): TimelineEntity[] {
    const ids = new Set([selected.id]);
    if (selected.source) ids.add(selected.source);
    if (selected.sink) ids.add(selected.sink);
    for (const entity of recording.entities) if (entity.source === selected.id || entity.sink === selected.id) ids.add(entity.id);
    return recording.entities.filter(entity => ids.has(entity.id));
}
export function relevantTimelineEvents(recording: TimelineRecording, selected: TimelineEntity): TimelineEvent[] {
    const ids = new Set(relatedTimelineEntities(recording, selected).map(entity => entity.id));
    return recording.events.filter(event => ids.has(event.entity_id));
}
export interface TimelineWait { entityId: string; state: string; start: number; end: number }
/** Recorded waits, not automatically faults: a deliberately batched clock can legitimately wait. */
export function timelineWaits(recording: TimelineRecording, entityId: string): TimelineWait[] {
    const entity = recording.entities.find(candidate => candidate.id === entityId);
    const state = entity?.signals.find(signal => signal.id === 'state');
    if (!state) return [];
    return state.ticks.flatMap((start, index) => {
        const value = String(state.values[index]);
        const end = state.ticks[index + 1] ?? recording.end_tick;
        return end > start && ['item_ingredient_shortage', 'full_output', 'no_fuel', 'waiting_for_source_items', 'waiting_for_more_items', 'waiting_for_space_in_destination'].includes(value)
            ? [{ entityId, state: value, start, end }] : [];
    });
}

/** A delivery-based rolling rate. Events are quantities actually dropped, never adjusted transfer ranges. */
export function deliveryRateSeries(events: readonly TimelineEvent[], item: string, duration: number, windowTicks = 60): TimelineSeries {
    const drops = events.filter(event => event.kind === 'drop' && event.item === item);
    const changes = new Map<number, number>();
    for (const event of drops) {
        changes.set(event.tick, (changes.get(event.tick) ?? 0) + event.amount);
        if (event.tick + windowTicks <= duration) changes.set(event.tick + windowTicks, (changes.get(event.tick + windowTicks) ?? 0) - event.amount);
    }
    const ticks = [0], values = [0]; let amount = 0;
    for (const [tick, delta] of [...changes].sort(([a], [b]) => a - b)) {
        amount += delta; ticks.push(tick); values.push(amount * 60 / windowTicks);
    }
    return { id: `rate:${item}`, item, label: 'Delivered over the preceding second', group: 'production', unit: 'items/s', ticks, values };
}

export interface ProductionBatch { start: number; end: number; amount: number }
/** Sum nearby recorded production events for legible quantities at wide zooms; never infer crafts or deliveries. */
export function productionBatches(events: readonly TimelineEvent[], range: TimelineRange, columns: number): ProductionBatch[] {
    const bins = new Map<number, ProductionBatch>();
    const count = Math.max(1, Math.floor(columns));
    const span = range.end - range.start;
    for (const event of events) {
        if (event.tick < range.start) continue;
        if (event.tick > range.end) break;
        if (event.kind !== 'produce') continue;
        const index = Math.min(count - 1, Math.floor((event.tick - range.start) / span * count));
        const bin = bins.get(index);
        if (bin) { bin.end = event.tick; bin.amount += event.amount; }
        else bins.set(index, { start: event.tick, end: event.tick, amount: event.amount });
    }
    return [...bins.values()];
}

export function timelineStateDurations(recording: TimelineRecording, entityId: string): { state: string; ticks: number; share: number }[] {
    const series = recording.entities.find(entity => entity.id === entityId)?.signals.find(signal => signal.id === 'state');
    if (!series || recording.end_tick <= 0) return [];
    const totals = new Map<string, number>();
    for (let index = 0; index < series.ticks.length; index++) {
        const ticks = Math.max(0, Math.min(recording.end_tick, series.ticks[index + 1] ?? recording.end_tick) - series.ticks[index]);
        const state = String(series.values[index]);
        totals.set(state, (totals.get(state) ?? 0) + ticks);
    }
    return [...totals].map(([state, ticks]) => ({ state, ticks, share: ticks / recording.end_tick }));
}


export function timelineSignalPreset(groups: readonly TimelineSignalGroup[]): 'default' | 'states' | 'custom' {
    const selected = new Set(groups);
    if (selected.size === 1 && selected.has('state')) return 'states';
    if (selected.size === DEFAULT_INSPECTION.signals.length && DEFAULT_INSPECTION.signals.every(group => selected.has(group))) return 'default';
    return 'custom';
}
