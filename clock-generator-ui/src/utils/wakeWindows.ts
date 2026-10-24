/**
 * The wake windows of a clock, row by row, as the Wake windows view draws them: pure functions over the data a clock
 * alternative carries. Every number here comes from the engine; the view counts no wake-ups of its own, so a changed
 * engine definition of a wake-up flows through unchanged. The words are in `wakeWindowCopy.ts`.
 */
import type { AlwaysOnReason } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { entityLabel, type LabelKind } from './entityLabel';
import { rowRouteText } from './wakeWindowCopy';
import type { EntityOption } from './inserterOptions';

/** Inclusive ticks of one clock period */
export interface TickSpan {
    start: number;
    end: number;
}

export interface WakeWindow {
    /** First tick of the window; for a window that wraps past the end of the period, `end` is less than `start` */
    start: number;
    /** Last tick of the window, inclusive */
    end: number;
    /** Ticks in the window, both ends included */
    length: number;
    /** What is drawn: one bar, or two for a window that wraps (from `start` to the end of the period, then from 0) */
    segments: TickSpan[];
    wraps: boolean;
    /** Ticks at the end of the window that are belt slack; 0 when none */
    slackTicks: number;
}

export type WakeWindowRowMode = 'windows' | 'always-on' | 'own-clock' | 'never';

/** A fuel inserter on a clock of its own: on `windowTicks` ticks every `everyTicks` */
export interface OwnClock {
    windowTicks: number;
    everyTicks: number;
    perMinute: number;
    item: string;
}

export interface WakeWindowRow {
    /** The engine's entity id, "inserter:3" */
    id: string;
    kind: 'inserter' | 'drill';
    number: number;
    /** "Inserter 3" */
    label: string;
    /** The ids of the items it moves, "iron-plate"; empty when the run does not say. The screen shows them as icons. */
    items: string[];
    /** Between what, "Belt 1 to Machine 2"; a drill's "into Machine 1"; empty when the run does not say */
    route: string;
    source?: EntityOption;
    sink?: EntityOption;
    windows: WakeWindow[];
    mode: WakeWindowRowMode;
    /** Why the clock leaves it always on, when the engine says; only on a row in 'always-on' mode */
    alwaysOnReason?: AlwaysOnReason;
    ownClock?: OwnClock;
    /** Ticks of the period it is on: the windows' lengths, the whole period when always on */
    onTicks: number;
    /** Share of the period it is on, 0 to 1 */
    onShare: number;
    /** The engine's count for this inserter, a minute, one copy; null for a drill and when the clock has none */
    wakeUpsPerMinute: number | null;
}

export type WakeWindowSource = Pick<
    ClockAlternativeView,
    'clockWindows' | 'stateTransitionHistory' | 'asBuilt' | 'fuelView' | 'beltPickupSlackTicks' | 'simulationDurationTicks' | 'alwaysOnReasons'
>;

const TICKS_PER_SECOND = 60;

/** Last tick of a period: a period of 600 ticks runs 0 to 599, a subtick one of 550.957 runs 0 to 550 */
export function lastTickOf(period: number): number {
    return Number.isInteger(period) ? period - 1 : Math.floor(period);
}

export function ticksToSeconds(ticks: number): number {
    return ticks / TICKS_PER_SECOND;
}

export function windowLengthTicks(window: Pick<WakeWindow, 'segments'>): number {
    return window.segments.reduce((sum, segment) => sum + segment.end - segment.start + 1, 0);
}

function windowOf(segments: TickSpan[]): WakeWindow {
    const first = segments[0];
    const last = segments[segments.length - 1];
    const window = { start: first.start, end: last.end, segments, wraps: segments.length > 1, slackTicks: 0 };
    return { ...window, length: windowLengthTicks(window) };
}

/**
 * The windows of one entity as one period of the clock holds them: sorted, clamped to the period, overlapping and
 * touching windows merged, and a window that runs past the end of the period joined with its rest from tick 0.
 */
export function normalizeWindows(raw: readonly TickSpan[], period: number): WakeWindow[] {
    const lastTick = lastTickOf(period);
    const clamped = raw
        .map(window => ({ start: Math.max(0, window.start), end: Math.min(lastTick, window.end) }))
        .filter(window => window.end >= window.start)
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: TickSpan[] = [];
    for (const window of clamped) {
        const previous = merged[merged.length - 1];
        if (previous && window.start <= previous.end + 1) {
            previous.end = Math.max(previous.end, window.end);
        } else {
            merged.push({ ...window });
        }
    }
    if (merged.length >= 2 && merged[0].start === 0 && merged[merged.length - 1].end === lastTick) {
        const [head, ...rest] = merged;
        const tail = rest.pop()!;
        return [...rest.map(window => windowOf([window])), windowOf([tail, head])].sort((a, b) => a.start - b.start);
    }
    return merged.map(window => windowOf([window]));
}

/** Share of the period the windows cover, 0 to 1; a wrapped window counts once */
export function coverage(windows: readonly WakeWindow[], period: number): number {
    if (period <= 0) {
        return 0;
    }
    const ticks = windows.reduce((sum, window) => sum + window.length, 0);
    return Math.min(1, ticks / period);
}

/** What to draw of a window, in order: the solid part, then the belt slack at its end, split where it wraps */
export function drawnSpans(window: WakeWindow): (TickSpan & { slack: boolean })[] {
    let slackLeft = window.slackTicks;
    const spans: (TickSpan & { slack: boolean })[] = [];
    // walk back from the window's last tick: the slack is the end of the window, which is in the last segment
    for (let index = window.segments.length - 1; index >= 0; index -= 1) {
        const segment = window.segments[index];
        const length = segment.end - segment.start + 1;
        const slack = Math.min(slackLeft, length);
        slackLeft -= slack;
        const parts: (TickSpan & { slack: boolean })[] = [];
        if (slack < length) {
            parts.push({ start: segment.start, end: segment.end - slack, slack: false });
        }
        if (slack > 0) {
            parts.push({ start: segment.end - slack + 1, end: segment.end, slack: true });
        }
        spans.unshift(...parts);
    }
    return spans;
}

/** One bar of a track: a segment of a window, or several windows too narrow to tell apart, merged */
interface DrawnBar {
    /** The window it draws; the first of them for merged windows */
    windowIndex: number;
    merged: boolean;
    start: number;
    end: number;
    spans: (TickSpan & { slack: boolean })[];
}

/**
 * The bars of a track, in tick order. Windows shorter than `minTicks` (under a pixel wide) that lie within `minTicks` of
 * each other are drawn as one solid bar, so a clock with thousands of windows stays cheap to draw; the selected window
 * (`keep`) is never merged. Only the drawing merges: the windows and their text are unchanged.
 */
export function barsToDraw(windows: readonly WakeWindow[], minTicks: number, keep: number | null): DrawnBar[] {
    const pieces = windows.flatMap((window, windowIndex) => {
        const spans = drawnSpans(window);
        return window.segments.map(segment => ({
            windowIndex,
            merged: false,
            start: segment.start,
            end: segment.end,
            spans: spans.filter(span => span.start >= segment.start && span.end <= segment.end),
        }));
    }).sort((a, b) => a.start - b.start);
    const tiny = (bar: DrawnBar) => bar.windowIndex !== keep && bar.end - bar.start + 1 < minTicks;
    const bars: DrawnBar[] = [];
    for (const piece of pieces) {
        const previous = bars[bars.length - 1];
        if (previous && tiny(previous) && tiny(piece) && piece.start - previous.end - 1 < minTicks) {
            previous.merged = true;
            previous.end = piece.end;
            previous.spans = [{ start: previous.start, end: piece.end, slack: false }];
        } else {
            bars.push(piece);
        }
    }
    return bars;
}

const ID_PATTERN = /^(inserter|drill):(\d+)$/;
const LABEL_KINDS: Record<string, LabelKind> = {
    machine: 'machine',
    furnace: 'machine',
    inserter: 'inserter',
    belt: 'belt',
    drill: 'drill',
};

/** "Belt 1" from "belt:1", the name every view gives an entity; the engine's label when the id is not one of those */
function endLabel(end: { entity_id: string; label: string } | undefined): string | null {
    if (!end) {
        return null;
    }
    const match = /^([a-z]+):(\d+)$/.exec(end.entity_id);
    const kind = match ? LABEL_KINDS[match[1]] : undefined;
    return match && kind ? entityLabel(kind, Number(match[2])) : end.label;
}

/** One row per inserter, then per drill, in number order, of everything the clock switches or leaves on */
export function buildWakeWindowRows(alternative: WakeWindowSource, options: readonly EntityOption[] = []): WakeWindowRow[] {
    const endpoints = new Map(options.map(option => [`${option.type}:${option.id}`, option]));
    const endpoint = (id?: string) => id ? endpoints.get(id.replace(/^furnace:/, 'machine:')) : undefined;
    const period = alternative.simulationDurationTicks;
    const entities = new Map(
        alternative.stateTransitionHistory.entities
            .filter(entity => entity.entity_type === 'inserter' || entity.entity_type === 'drill')
            .map(entity => [entity.entity_id, entity]),
    );
    const wakeUps = alternative.asBuilt?.wake_ups;
    const wakeUpsById = new Map(wakeUps?.inserters.map(inserter => [inserter.inserter_id, inserter.wake_ups_per_minute]) ?? []);
    const ownClocks = new Map(alternative.fuelView?.plan.inserters.map(inserter => [inserter.inserter_id, inserter]) ?? []);
    const ids = new Set([...entities.keys(), ...Object.keys(alternative.clockWindows), ...wakeUpsById.keys(), ...ownClocks.keys()]);
    const wholeTicks = Number.isInteger(period);

    const rows: WakeWindowRow[] = [];
    for (const id of ids) {
        const match = ID_PATTERN.exec(id);
        if (!match) {
            continue;
        }
        const kind = match[1] as 'inserter' | 'drill';
        const number = Number(match[2]);
        const entity = entities.get(id);
        const raw = alternative.clockWindows[id];
        const ownClockPlan = ownClocks.get(id);
        const slack = wholeTicks ? alternative.beltPickupSlackTicks?.[id] ?? 0 : 0;
        const windows = raw === undefined ? [] : normalizeWindows(raw, period)
            .map(window => ({ ...window, slackTicks: Math.max(0, Math.min(slack, window.length)) }));

        let mode: WakeWindowRowMode;
        if (raw !== undefined) {
            mode = windows.length > 0 ? 'windows' : 'never';
        } else if (ownClockPlan) {
            mode = 'own-clock';
        } else {
            mode = 'always-on';
        }
        const ownClock = mode === 'own-clock' && ownClockPlan ? {
            windowTicks: ownClockPlan.window.end - ownClockPlan.window.start + 1,
            everyTicks: ownClockPlan.modulus,
            perMinute: ownClockPlan.enables_per_minute,
            item: ownClockPlan.fuel_item,
        } : undefined;

        let onTicks = 0;
        let onShare = 0;
        if (mode === 'windows') {
            onTicks = windows.reduce((sum, window) => sum + window.length, 0);
            onShare = coverage(windows, period);
        } else if (mode === 'always-on') {
            onTicks = period;
            onShare = 1;
        } else if (ownClock && ownClock.everyTicks > 0) {
            onShare = Math.min(1, ownClock.windowTicks / ownClock.everyTicks);
            onTicks = onShare * period;
        }

        const route = entity ? rowRouteText(kind === 'inserter' ? endLabel(entity.source) : null, endLabel(entity.sink)) : '';

        rows.push({
            id,
            kind,
            number,
            label: entityLabel(kind, number),
            items: entity ? [...entity.items] : [],
            route,
            source: endpoint(entity?.source?.entity_id),
            sink: endpoint(entity?.sink?.entity_id),
            windows,
            mode,
            ...(mode === 'always-on' && alternative.alwaysOnReasons?.[id] ? { alwaysOnReason: alternative.alwaysOnReasons[id] } : {}),
            ...(ownClock ? { ownClock } : {}),
            onTicks,
            onShare,
            wakeUpsPerMinute: kind === 'inserter' ? wakeUpsById.get(id) ?? null : null,
        });
    }
    return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'inserter' ? -1 : 1) || a.number - b.number);
}

/** The rows' wake-ups added up: the clock table's figure. Null when an inserter has no count */
export function sumWakeUps(rows: readonly WakeWindowRow[]): number | null {
    let sum = 0;
    for (const row of rows) {
        if (row.kind !== 'inserter') {
            continue;
        }
        if (row.wakeUpsPerMinute === null) {
            return null;
        }
        sum += row.wakeUpsPerMinute;
    }
    return sum;
}

/** Whether the engine counted the clock's wake-ups: it does only over a long run of a clock that held */
export function wakeUpsCounted(alternative: Pick<ClockAlternativeView, 'asBuilt'>): boolean {
    return alternative.asBuilt?.wake_ups !== undefined;
}

/** The inserter woken most, when any was woken at all; the first in order on a tie */
export function mostWokenRowId(rows: readonly WakeWindowRow[]): string | null {
    let best: WakeWindowRow | null = null;
    for (const row of rows) {
        if (row.wakeUpsPerMinute !== null && row.wakeUpsPerMinute > 0 && (best === null || row.wakeUpsPerMinute > best.wakeUpsPerMinute!)) {
            best = row;
        }
    }
    return best?.id ?? null;
}

/**
 * Tick marks of the axis at a step of 1, 2 or 5 times a power of ten, so there are at most `maxMarks`, 0 included.
 * The end of the period is labelled separately, so no mark is placed on or past it.
 */
export function axisTicks(period: number, maxMarks: number): number[] {
    if (!(period > 0) || maxMarks <= 1) {
        return [0];
    }
    // the marks below the period at a step; a step of the period or more leaves only 0, so the search ends
    const marksAt = (step: number) => Array.from({ length: Math.ceil(period / step) }, (_, index) => index * step);
    for (let power = 1; ; power *= 10) {
        for (const factor of [1, 2, 5]) {
            const step = factor * power;
            if (Math.ceil(period / step) <= maxMarks) {
                return marksAt(step);
            }
        }
    }
}

/** The tick under a point of the track, `fraction` of the way along it */
export function tickAtFraction(fraction: number, period: number): number {
    return Math.min(period, Math.max(0, fraction * period));
}

/**
 * The window nearest a point of the track, in ticks, if it is within `toleranceTicks`. A window of ticks 3 to 5
 * covers 3 up to (not including) 6 on the track.
 */
export function nearestWindowIndex(windows: readonly WakeWindow[], tick: number, toleranceTicks: number): number | null {
    let bestIndex: number | null = null;
    let bestDistance = Infinity;
    for (const [index, window] of windows.entries()) {
        for (const segment of window.segments) {
            const distance = tick < segment.start ? segment.start - tick : tick > segment.end + 1 ? tick - segment.end - 1 : 0;
            if (distance < bestDistance) {
                bestIndex = index;
                bestDistance = distance;
            }
        }
    }
    return bestDistance <= toleranceTicks ? bestIndex : null;
}

/**
 * The window a key selects: the next or previous one, stopping at the ends, or the first or last. From no selection,
 * next and first select the first window, previous and last the last one. Null when the row has no windows.
 */
export function stepWindow(current: number | null, count: number, key: 'next' | 'previous' | 'first' | 'last'): number | null {
    if (count <= 0) {
        return null;
    }
    switch (key) {
        case 'first':
            return 0;
        case 'last':
            return count - 1;
        case 'next':
            return current === null ? 0 : Math.min(current + 1, count - 1);
        case 'previous':
            return current === null ? count - 1 : Math.max(current - 1, 0);
    }
}
