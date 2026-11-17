import type { Logger } from "../common/logger";
import type { Config } from "../config";
import { OpenRange } from "../data-types";
import { Entity, EntityId } from "../entities";
import { withChestDrillWindows } from "./chest-drill-windows";
import type { SerializableClockWindows } from "./clock";
import type { ClockRunForLog } from "./one-copy-log";
import { COPY_NUMBER_STRIDE } from "./sequence/build-copies";
import { createEntityRegistryFromConfig, type SimulationContext } from "./sequence/simulation-context";
import { clockWindowsOf, type InserterTimetableRecord, rangesOfWindowPart, recordTimetable, timetableOf, type TimetableLine, type WindowRange } from "./timetable";
import { longRunWindowCyclesOf, runClockOnBuild } from "./trial";
import { withTickPurpose } from "./tick-ledger";

/**
 * The repeat check of the maker log (scripts/blast/MAKER-LOG.md, event `repeat_check`): a clock that holds on one copy is run
 * from the cold start as its long run is made, for all the window cycles of the long run (the long run itself stops where its
 * state repeats), and the ticks the run needed of each window are read from its first tick on
 * (timetable.ts). Each window is narrowed to the span of those ticks, with no margin; a window with no needed tick stays as
 * it is. The narrowed clock is run again from the same start, and every hand of every inserter is compared tick for tick
 * with the first run. Where a hand differs, each narrowed window opens 1, 2 and more ticks earlier, never before its own
 * opening, until the run repeats or every window opens where it did.
 *
 * Nothing it makes is listed, ranked or kept: it is a reading for the log, and it runs only where the generation asks for it.
 */

/** Where a run first differs from the first run: the tick (of the first run's record) and the inserter, with the items in each hand */
export interface FirstDifference {
    tick: number;
    inserter_id: string;
    held: number;
    held_again: number;
}

/** Whether the build has a source two takers share, in the two senses the log gives */
export interface SharedSources {
    /** A machine two or more inserters take from */
    machine_with_takers: boolean;
    /** A source (a machine, a chest or a belt) of one item that two or more takers can take from in one tick, by their windows */
    taken_in_one_tick: boolean;
}

/** What the repeat check found of one clock */
export interface RepeatCheck {
    /** Ticks of the first run compared; ticks before the clock's first tick of the stock (the warm-up) included */
    ticks: number;
    /** The windows narrowed, those left as they were because no tick of them was needed, and every window */
    windows: { narrowed: number; not_needed: number; all: number };
    /** Whether the needed ticks of the first run are those of the timetable of the run whose wakeups the record holds; null where that has none */
    same_needed_as_timetable: boolean | null;
    /** The run again on the clock's own windows: it repeats the first run, else the check cannot be read */
    control_repeats: boolean;
    /** The ticks each narrowed window opens before its first needed tick in the run that repeats; null where none repeats */
    earlier_by: number | null;
    /** The most `earlier_by` can be: past it every narrowed window opens where it did */
    earlier_by_most: number;
    /** Runs made, the first and the control run included */
    runs: number;
    /** Where the narrowed clock first differs with no earlier opening, and where it does with the most */
    first_difference: FirstDifference | null;
    last_difference: FirstDifference | null;
    shared_sources: SharedSources;
}

/** Thrown inside a run to stop it: at the first hand that differs, or past the last tick of the first run */
class StopRun {
    constructor(readonly difference: FirstDifference | null) {}
}

/**
 * Puts into a run the comparison of every hand with the first run's records, by the inserter's copy and number: the run stops
 * at the first tick a hand differs (`StopRun` with it), or after the first run's last tick (`StopRun` with null)
 */
function compareHands(context: SimulationContext, first: readonly InserterTimetableRecord[]): void {
    const of = new Map<string, InserterTimetableRecord>(first.map(record => [`${record.copy}|${record.inserter_id}`, record]));
    const last = Math.min(...first.map(record => record.last_tick));
    const watched = context.inserters.map(archetype => {
        const number = archetype.entity_id.number;
        const key = `${Math.floor(number / COPY_NUMBER_STRIDE)}|${EntityId.forInserter(number % COPY_NUMBER_STRIDE).id}`;
        return { archetype, record: of.get(key) };
    });
    context.after_inserters.push({ tick() {
        const tick = context.tick_provider.getCurrentTick();
        if (tick > last) throw new StopRun(null);
        for (const { archetype, record } of watched) {
            if (record === undefined) continue;
            const held_again = archetype.inserter_state.held_item?.quantity ?? 0;
            const held = record.heldAt(tick);
            if (held >= 0 && held !== held_again) throw new StopRun({ tick, inserter_id: record.inserter_id, held, held_again });
        }
    } });
}

/** The shared sources of a build in the two senses of `SharedSources`, by the clock's windows (an inserter with none is always enabled) */
export function sharedSourcesOf(config: Config, windows: SerializableClockWindows, window_cycle_ticks: number): SharedSources {
    const inserters = createEntityRegistryFromConfig(config).getAll().filter(Entity.isInserter);
    const takers = new Map<string, number>();
    for (const inserter of inserters) {
        if (EntityId.isMachine(inserter.source.entity_id)) takers.set(inserter.source.entity_id.id, (takers.get(inserter.source.entity_id.id) ?? 0) + 1);
    }
    const T = Math.ceil(window_cycle_ticks);
    const enabledAt = (id: string): Uint8Array | null => {
        const ranges = windows[id];
        if (ranges === undefined || ranges.length === 0) return null;
        const on = new Uint8Array(T);
        for (const range of ranges) for (let tick = Math.ceil(range.start); tick <= Math.min(T - 1, Math.floor(range.end)); tick++) on[tick] = 1;
        return on;
    };
    let taken_in_one_tick = false;
    for (let a = 0; a < inserters.length && !taken_in_one_tick; a++) {
        for (let b = a + 1; b < inserters.length && !taken_in_one_tick; b++) {
            const one = inserters[a], other = inserters[b];
            if (one.source.entity_id.id !== other.source.entity_id.id) continue;
            if (![...one.filtered_items].some(item => other.filtered_items.has(item))) continue;
            const on_one = enabledAt(one.entity_id.id), on_other = enabledAt(other.entity_id.id);
            if (on_one === null || on_other === null) {
                taken_in_one_tick = true;
                continue;
            }
            for (let tick = 0; tick < T; tick++) if (on_one[tick] === 1 && on_other[tick] === 1) { taken_in_one_tick = true; break; }
        }
    }
    return { machine_with_takers: [...takers.values()].some(count => count >= 2), taken_in_one_tick };
}

/**
 * The windows of the clock with each window narrowed to the span of its needed ticks, opening `earlier_by` ticks before its
 * first needed tick (never before its own opening). An inserter none of whose windows is narrowed keeps its ranges as they
 * are, and so does a window with no needed tick.
 */
export function narrowedWindows(windows: SerializableClockWindows, line: TimetableLine, window_cycle_ticks: number, earlier_by: number): SerializableClockWindows {
    const T = window_cycle_ticks;
    return Object.fromEntries(Object.entries(windows).map(([id, ranges]) => {
        const row = line.rows.find(it => it.inserter_id === id);
        const clock_windows = clockWindowsOf(ranges, T);
        const parts = clock_windows.map((window, index) => {
            const needed = row?.windows[index]?.needed_from_start ?? null;
            return needed === null || (needed[0] === 0 && needed[1] === window.ticks - 1) ? null : [Math.max(0, needed[0] - earlier_by), needed[1]] as const;
        });
        if (row === undefined || parts.every(part => part === null)) return [id, ranges];
        const window_of = new Int16Array(T).fill(-1);
        clock_windows.forEach((window, index) => { for (let k = 0; k < window.ticks; k++) window_of[(window.start + k) % T] = index; });
        const kept = (index: number) => ranges.filter(range => window_of[((Math.ceil(range.start) % T) + T) % T] === index);
        const narrowed: WindowRange[] = clock_windows.flatMap((window, index) => {
            const part = parts[index];
            return part === null ? kept(index) : rangesOfWindowPart(window, part[0], part[1], T);
        });
        return [id, narrowed.sort((a, b) => a.start - b.start)];
    }));
}

const mapOf = (windows: SerializableClockWindows) => new Map(Object.entries(windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));

/**
 * The repeat check of a clock on one copy (see the module's description). `timetable` is the timetable of the run whose wakeups
 * the record holds, where the log has one: the needed ticks of the first run are compared with it.
 */
export function repeatCheckOf(run: ClockRunForLog, timetable: TimetableLine | null, logger: Logger): RepeatCheck {
    const T = run.window_cycle_ticks;
    if (!Number.isInteger(T)) throw new Error(`the repeat check reads a window cycle of whole ticks, not ${T}`);
    const config: Config = { ...run.config, overrides: { ...run.config.overrides, derive_clock_windows: false } };
    const cycles = longRunWindowCyclesOf(T, run.long_run_ticks);
    if (cycles <= 1) throw new Error(`no long run of a window cycle of ${T} ticks`);
    // every run for all the window cycles of the long run: the long run stops where its state repeats, a narrowed run need not
    const runWith = (windows: SerializableClockWindows, on_context: (context: SimulationContext) => void) =>
        withTickPurpose("repeat_check", () => runClockOnBuild(config, withChestDrillWindows(config, mapOf(windows), T), T, logger, { simulate_window_cycles: cycles, machine_stock: true, factorio_states: false,
            ...run.swings, stock_detail: "hands", record_histories: false, on_context }), { claim: true });
    // the first run, as the long run of the clock is made
    let recordsOf: () => InserterTimetableRecord[] = () => [];
    runWith(run.windows, context => { recordsOf = recordTimetable(context); });
    const first = recordsOf();
    const from = Math.min(...first.map(record => record.first_tick));
    const to = Math.min(...first.map(record => record.last_tick)) + 1;
    const line = timetableOf({ records: first, windows: run.windows, window_cycle_ticks: T, from, to, needed_from: from });
    if (line.errors.length > 0) throw new Error(`the first run's timetable cannot be read: ${line.errors[0]}`);
    let runs = 1;
    /** A run again on the windows given, compared with the first: null where it repeats it, else where it first differs */
    const again = (windows: SerializableClockWindows): FirstDifference | null => {
        runs++;
        try {
            runWith(windows, context => compareHands(context, first));
        } catch (stop) {
            if (stop instanceof StopRun) return stop.difference;
            throw stop;
        }
        return null;
    };
    const neededOf = (of: TimetableLine) => of.rows.flatMap(row => row.windows.map(window => `${row.inserter_id}@${window.start}:${JSON.stringify(window.needed_from_start ?? null)}`));
    const same_needed_as_timetable = timetable === null ? null : JSON.stringify(neededOf(line)) === JSON.stringify(neededOf(timetable));
    const all = line.rows.reduce((sum, row) => sum + row.windows.length, 0);
    const not_needed = line.rows.reduce((sum, row) => sum + row.windows.filter(window => window.needed_from_start == null).length, 0);
    const narrowed_parts = line.rows.flatMap(row => row.windows.filter(window => window.needed_from_start != null
        && !(window.needed_from_start[0] === 0 && window.needed_from_start[1] === window.ticks - 1)));
    const earlier_by_most = Math.max(0, ...narrowed_parts.map(window => window.needed_from_start![0]));
    const shared_sources = sharedSourcesOf(config, run.windows, T);
    const head = { ticks: to - from, windows: { narrowed: narrowed_parts.length, not_needed, all }, same_needed_as_timetable, earlier_by_most, shared_sources };
    const control = again(run.windows);
    if (control !== null) return { ...head, control_repeats: false, earlier_by: null, runs, first_difference: control, last_difference: control };
    if (narrowed_parts.length === 0) return { ...head, control_repeats: true, earlier_by: 0, runs, first_difference: null, last_difference: null };
    let first_difference: FirstDifference | null = null;
    let last_difference: FirstDifference | null = null;
    for (let earlier_by = 0; earlier_by <= earlier_by_most; earlier_by++) {
        const difference = again(narrowedWindows(run.windows, line, T, earlier_by));
        if (difference === null) return { ...head, control_repeats: true, earlier_by, runs, first_difference, last_difference };
        first_difference ??= difference;
        last_difference = difference;
    }
    return { ...head, control_repeats: true, earlier_by: null, runs, first_difference, last_difference };
}
