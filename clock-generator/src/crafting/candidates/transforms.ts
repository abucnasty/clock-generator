import { OpenRange } from "../../data-types";
import { InserterStatus } from "../../state";
import { CIRCUIT_LATENCY_TICKS, rotateRanges } from "../clock";
import { TrialRun } from "../plan/plan-run";
import { transitionsOf } from "../sequence/compact-history";

/**
 * The transforms of a clock's windows: pure functions from windows to windows. Each candidate of a search is one of
 * these at one setting (a padding, a shift, an offset), and the search (search.ts) tries them with the trial of a
 * clock. Nothing here runs the build. Belt pickup slack and fuel hand room are the one transform that lives with the
 * clock, `withBeltPickupSlack` in clock.ts, since the belt a clock is made for is read off it.
 */

/** Every window of the inserters named lengthened at its end by `padding` ticks, up to the end of the period */
export function paddedWindows(
    windows: Map<string, OpenRange[]>,
    padded_ids: Iterable<string>,
    padding: number,
    period: number,
): Map<string, OpenRange[]> {
    const result = new Map(windows);
    for (const key of padded_ids) {
        const ranges = windows.get(key);
        if (ranges === undefined) {
            continue;
        }
        result.set(key, OpenRange.reduceRanges(ranges.map(r =>
            OpenRange.from(r.start_inclusive, Math.min(r.end_inclusive + padding, period - 1))
        )));
    }
    return result;
}

/** The crafting cycle a window belongs to: the one it starts in, the last cycle taking what runs past the period */
export function cycleOfWindow(range: OpenRange, cycle_ticks: number, cycles: number): number {
    return Math.min(cycles - 1, Math.floor(range.start_inclusive / cycle_ticks));
}

/**
 * The planned windows with one crafting cycle's windows (every inserter's and drill's) moved together by
 * `shift_ticks`, keeping their lengths and spacing. A window belongs to the cycle it starts in.
 */
export function withCycleShifted(
    planned_windows: Map<string, OpenRange[]>,
    cycle_index: number,
    shift_ticks: number,
    cycle_ticks: number,
    period: number,
): Map<string, OpenRange[]> {
    const cycles = Math.round(period / cycle_ticks);
    return new Map(Array.from(planned_windows, ([key, ranges]) => [key, ranges
        .map(range => cycleOfWindow(range, cycle_ticks, cycles) !== cycle_index ? range
            : OpenRange.from(range.start_inclusive + shift_ticks, range.end_inclusive + shift_ticks))
        .sort((a, b) => a.start_inclusive - b.start_inclusive)]));
}

/** The output windows, each inserter's sorted by start, with the window at `window_index` moved by `shift_ticks` */
export function withOutputWindowMoved(
    sorted_output_windows: ReadonlyMap<string, OpenRange[]>,
    window_index: number,
    shift_ticks: number,
): Map<string, OpenRange[]> {
    return new Map(Array.from(sorted_output_windows, ([key, ranges]) => [key, ranges.map((range, index) => index !== window_index ? range
        : OpenRange.from(range.start_inclusive + shift_ticks, range.end_inclusive + shift_ticks))]));
}

/** Every n-th full-hand output window is lengthened by `ticks`, so a second grab can drain a surplus */
export interface SpareOutputWindows {
    every: number;
    ticks: number;
}

/**
 * The windows with the output inserters' replaced by `swings` windows of `length` ticks each, evenly spaced from
 * `offset`, one swing a window; with `spare`, every n-th window lengthened for a second grab.
 */
export function withSingleSwingOutput(
    windows: Map<string, OpenRange[]>,
    output_ids: Iterable<string>,
    swings: number,
    period: number,
    offset: number,
    length: number,
    spare?: SpareOutputWindows,
): Map<string, OpenRange[]> {
    const spacing = period / swings;
    const result = new Map(windows);
    // floor keeps every start below the period, so starts stay whole ticks
    const starts = Array.from({ length: swings }, (_, j) => Math.floor(offset + j * spacing));
    const ranges = OpenRange.reduceRanges(starts.flatMap((start, j) => {
        const extra = spare && j % spare.every === 0 ? spare.ticks : 0;
        return rotateRanges([OpenRange.from(0, length - 1 + extra)], start, period);
    }));
    for (const key of output_ids) {
        result.set(key, ranges);
    }
    return result;
}

/**
 * The output inserters' swings spread evenly over the period, one swing per window. Windows are the shortest
 * planned window minus the circuit latency, since the game keeps the inserter enabled that much longer and
 * a longer window lets it return and grab a partial stack. Null when that would not change anything or cannot be built.
 */
export function evenlySpacedOutputWindows(
    output_windows: Map<string, OpenRange[]>,
    swing_counts: ReadonlyMap<string, number>,
    period: number,
): Map<string, OpenRange[]> | null {
    if (!Number.isInteger(period)) {
        return null;
    }
    const even = new Map<string, OpenRange[]>();
    let changed = false;
    for (const [key, ranges] of output_windows) {
        const swings = swing_counts.get(key) ?? 0;
        if (swings === 0 || ranges.length === 0) {
            return null;
        }
        const length = Math.min(...ranges.map(r => r.end_inclusive - r.start_inclusive + 1)) - CIRCUIT_LATENCY_TICKS;
        if (length < 1 || length >= period / swings) {
            return null;
        }
        const first = ranges[0].start_inclusive;
        const spaced: OpenRange[] = [];
        for (let k = 0; k < swings; k++) {
            spaced.push(...rotateRanges([OpenRange.from(first, first + length - 1)], Math.round(k * period / swings), period));
        }
        const reduced = OpenRange.reduceRanges(spaced);
        changed ||= reduced.length !== ranges.length || reduced.some((r, i) => r.start_inclusive !== ranges[i].start_inclusive || r.end_inclusive !== ranges[i].end_inclusive);
        even.set(key, reduced);
    }
    return changed ? even : null;
}

/** How many swings each output inserter made in the first period of a run: its drops, as the trial recorded them */
export function outputSwingCountsOf(run: TrialRun, output_ids: ReadonlySet<string>, period: number): Map<string, number> {
    const swing_counts = new Map<string, number>();
    for (const entity of run.serializable_state_transition_history.entities) {
        if (!output_ids.has(entity.entity_id)) {
            continue;
        }
        const sorted = transitionsOf(run.serializable_state_transition_history, entity).sort((a, b) => a.tick - b.tick);
        let status = entity.initial_status;
        let swings = 0;
        for (const transition of sorted) {
            if (transition.tick >= 1 && transition.tick <= period && transition.to_status === InserterStatus.DROP_OFF && status !== InserterStatus.DROP_OFF) {
                swings++;
            }
            status = transition.to_status;
        }
        swing_counts.set(entity.entity_id, swings);
    }
    return swing_counts;
}

const INSERTER_BUSY_STATUSES = new Set<string>([
    InserterStatus.PICKUP,
    InserterStatus.SWING,
    InserterStatus.DROP_OFF,
    InserterStatus.TARGET_FULL,
    InserterStatus.WAITING_FOR_SINK,
]);

/** Busy ticks of a simulated inserter as decider windows (shifted back by the circuit latency) */
export function busyDeciderRanges(
    initial_status: string,
    transitions: { tick: number; to_status: string }[],
    period: number,
): OpenRange[] {
    // manual lcm overrides can produce fractional periods; the simulation runs whole ticks up to the ceiling
    const ticks = Math.ceil(period);
    const busy = new Array<boolean>(ticks).fill(false);
    const sorted = [...transitions].sort((a, b) => a.tick - b.tick);
    let status = initial_status;
    let next = 0;
    // simulated clock ticks run 1..period, matching the clocked controls
    for (let tick = 1; tick <= ticks; tick++) {
        while (next < sorted.length && sorted[next].tick <= tick) {
            status = sorted[next].to_status;
            next++;
        }
        if (INSERTER_BUSY_STATUSES.has(status)) {
            busy[(((tick - CIRCUIT_LATENCY_TICKS) % ticks) + ticks) % ticks] = true;
        }
    }

    const ranges: OpenRange[] = [];
    let start: number | null = null;
    for (let tick = 0; tick <= ticks; tick++) {
        if (tick < ticks && busy[tick]) {
            start ??= tick;
        } else if (start !== null) {
            ranges.push(OpenRange.from(start, tick - 1));
            start = null;
        }
    }
    return ranges;
}
