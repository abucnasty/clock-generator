import { CIRCUIT_LATENCY_TICKS } from "../common/rule-constants";
import type { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import type { InserterArchetype } from "../simulation/archetypes/inserter";
import { isWindowCycleClock } from "../simulation/controls/enable-control";
import { InserterPhase } from "../simulation/status-codes";
import { handStartsOf, type HandCondition, type TakerConditions } from "./hand-conditions";
import { COPY_NUMBER_STRIDE } from "./sequence/build-copies";
import type { SimulationContext } from "./sequence/simulation-context";

/**
 * The timetable of a run for the maker log (scripts/blast/MAKER-LOG.md): for each inserter and each of its windows, the
 * ticks the run needed of the window, the open ticks it did not need, and the hands the close of the window cut. It reads
 * the run and changes nothing in it.
 *
 * A needed tick is a tick in which the inserter's phase rule read its enable condition, the read let it go on, and its
 * hand is at its pickup after the update: a hand starts (`start`), a hand fills on (`fill`), or a part hand waits for its
 * machine (`wait`). The three kinds are counted apart. A read that the scheduler makes outside the phase rule (whether the
 * inserter goes to sleep) is not a read of the condition. An inserter asleep on a list makes no read.
 *
 * A cut hand is a hand that was at its pickup when the close of its window stopped it, with items or empty. Its ticks to
 * the swing are the open ticks from the next opening up to the tick its hand leaves for the sink.
 *
 * Positions are read from each inserter's clock and moved back by the circuit latency, so that a window is named as the
 * clock gives it.
 */

/** The bits of one tick of an inserter's record */
const READ = 1, READ_ON = 2, OPEN = 4, AT_PICKUP = 8, WAITS = 16, TOOK = 32, CUT = 64, SWINGS_OUT = 128, HELD = 256;

/** What the recorder kept of one inserter of one copy, a tick at a time from `first_tick` */
export class InserterTimetableRecord {
    private bits = new Uint16Array(1024);
    private held = new Uint16Array(1024);
    private positions = new Int32Array(1024);
    private count = 0;
    /** The first tick recorded; ticks before it are not in the record */
    public first_tick = -1;
    /** The window cycle of the inserter's clock, where it has a clock of whole ticks */
    public window_cycle_ticks: number | null = null;
    /** Why the record cannot be read, where it cannot */
    public error: string | null = null;

    constructor(
        /** The copy, counted from 0, the config's own */
        public readonly copy: number,
        /** The config's inserter the copy's inserter is a copy of */
        public readonly inserter_id: string,
    ) {}

    public push(tick: number, bits: number, held: number, position: number): void {
        if (this.first_tick < 0) this.first_tick = tick;
        else if (tick !== this.first_tick + this.count) this.error ??= `tick ${tick} follows tick ${this.first_tick + this.count - 1}`;
        if (this.count === this.bits.length) {
            const grow = <T extends Uint16Array | Int32Array>(from: T, made: T): T => { made.set(from); return made; };
            this.bits = grow(this.bits, new Uint16Array(this.count * 2));
            this.held = grow(this.held, new Uint16Array(this.count * 2));
            this.positions = grow(this.positions, new Int32Array(this.count * 2));
        }
        this.bits[this.count] = bits;
        this.held[this.count] = Math.min(held, 0xffff);
        this.positions[this.count] = position;
        this.count++;
    }

    /** The last tick recorded */
    public get last_tick(): number {
        return this.first_tick + this.count - 1;
    }

    private indexOf(tick: number): number {
        const index = tick - this.first_tick;
        return this.first_tick < 0 || index < 0 || index >= this.count ? -1 : index;
    }

    /** The bits of a tick; 0 for a tick that is not recorded */
    public at(tick: number): number {
        const index = this.indexOf(tick);
        return index < 0 ? 0 : this.bits[index];
    }

    /** Items in the hand after the tick; -1 for a tick that is not recorded */
    public heldAt(tick: number): number {
        const index = this.indexOf(tick);
        return index < 0 ? -1 : this.held[index];
    }

    /** The position of the inserter's clock in its window cycle in the tick; -1 where it has none or the tick is not recorded */
    public positionAt(tick: number): number {
        const index = this.indexOf(tick);
        return index < 0 ? -1 : this.positions[index];
    }

    /** Whether the window was open in the tick */
    public open(tick: number): boolean {
        return (this.at(tick) & OPEN) !== 0;
    }

    /** The kind of a needed tick, or null for a tick that is not needed */
    public neededAs(tick: number): "start" | "fill" | "wait" | null {
        const bits = this.at(tick);
        if ((bits & READ_ON) === 0 || (bits & (AT_PICKUP | WAITS)) === 0) return null;
        const before = this.at(tick - 1);
        if ((bits & WAITS) !== 0 || (before & WAITS) !== 0) return "wait";
        return (before & AT_PICKUP) !== 0 ? "fill" : "start";
    }

    /** Whether the close of the window cut a hand at its pickup in the tick, and whether the hand held items */
    public cutIn(tick: number): "with_items" | "empty" | null {
        const bits = this.at(tick);
        return (bits & CUT) === 0 ? null : (bits & HELD) !== 0 ? "with_items" : "empty";
    }

    /** Whether the hand left its pickup for the sink in the tick */
    public swingsOutIn(tick: number): boolean {
        return (this.at(tick) & SWINGS_OUT) !== 0;
    }
}

/** How many recorders were put into runs, for a test that the log off puts none in */
export const timetableRecorders = { made: 0 };

/** What the recorder reads of one inserter between two of its ticks */
interface Reader {
    archetype: InserterArchetype;
    record: InserterTimetableRecord;
    in_rule: boolean;
    /** The last read of the phase rule in the tick: 0 none, 1 closed, 2 open */
    read: number;
    phase: InserterPhase;
    held: number;
}

/**
 * Puts the recorder of the timetable into a run's context before its first tick: one record for each inserter of each copy.
 * It wraps the inserter's phase rule and the reads of its control, on the inserter itself, so that a control swap keeps it;
 * the wrapped calls give what they gave. In each tick after the inserters' update it reads the hand's phase and what it
 * holds, and the window from the control asked for this tick without moving it on (a control that answers for ticks
 * ahead; for any other, the read of the phase rule).
 */
export function recordTimetable(context: SimulationContext): () => InserterTimetableRecord[] {
    timetableRecorders.made++;
    const readers: Reader[] = context.inserters.map(archetype => {
        const number = archetype.entity_id.number;
        const record = new InserterTimetableRecord(Math.floor(number / COPY_NUMBER_STRIDE), EntityId.forInserter(number % COPY_NUMBER_STRIDE).id);
        const reader: Reader = { archetype, record, in_rule: false, read: 0, phase: archetype.hand.phase, held: archetype.inserter_state.held_item?.quantity ?? 0 };
        const control = archetype.control;
        const enabled = control.enabled.bind(control);
        control.enabled = () => {
            const value = enabled();
            if (reader.in_rule) reader.read = value ? 2 : 1;
            return value;
        };
        const rule = archetype.phaseRule.bind(archetype);
        archetype.phaseRule = () => {
            reader.in_rule = true;
            try {
                rule();
            } finally {
                reader.in_rule = false;
            }
        };
        return reader;
    });
    // a read that fails ends the record: the run goes on as it would without the recorder
    let failed: string | null = null;
    context.after_inserters.push({ tick() {
        if (failed !== null) return;
        const tick = context.tick_provider.getCurrentTick();
        try {
            for (const reader of readers) readTick(reader, tick);
        } catch (error) {
            failed = error instanceof Error ? error.message : String(error);
        }
    } });
    return () => {
        if (failed !== null) throw new Error(`The record of the timetable stopped: ${failed}`);
        return readers.map(it => it.record);
    };
}

function readTick(reader: Reader, tick: number): void {
    const { archetype, record } = reader;
    const control = archetype.control;
    const asked = control.asked;
    let position = -1;
    if (isWindowCycleClock(asked)) {
        const T = asked.windowCycleDuration.ticks;
        if (Number.isInteger(T) && T > 0) {
            position = ((asked.clockTick() % T) + T) % T;
            if (record.window_cycle_ticks === null) record.window_cycle_ticks = T;
        }
    }
    const phase = archetype.hand.phase;
    const held = archetype.inserter_state.held_item?.quantity ?? 0;
    const before = reader.phase;
    const at_pickup_before = before === InserterPhase.PICKUP || before === InserterPhase.WAITING_FOR_SINK;
    let bits = 0;
    if (reader.read !== 0) bits |= READ;
    if (reader.read === 2) bits |= READ_ON;
    if (control.looks_ahead ? control.enabledIn(0) : reader.read === 2) bits |= OPEN;
    if (phase === InserterPhase.PICKUP) bits |= AT_PICKUP;
    if (phase === InserterPhase.WAITING_FOR_SINK) bits |= WAITS;
    if (held > reader.held) bits |= TOOK;
    if (at_pickup_before && phase === InserterPhase.DISABLED) bits |= CUT;
    if (at_pickup_before && phase === InserterPhase.SWING) bits |= SWINGS_OUT;
    if (held > 0) bits |= HELD;
    record.push(tick, bits, held, position);
    reader.read = 0;
    reader.phase = phase;
    reader.held = held;
}

/** A window of a clock as the timetable names it: its first tick of the window cycle, and its ticks (it can run over the end of the window cycle) */
export interface ClockWindow {
    start: number;
    ticks: number;
}

/** A window as a clock or a config gives it: from `start` to `end`, both in */
export interface WindowRange {
    start: number;
    end: number;
}

/**
 * The windows of an inserter on a window cycle of whole ticks: its ranges joined where they meet or overlap, and the one that
 * runs to the end of the window cycle joined with the one that starts at 0, as the run opens them: one opening each
 */
export function clockWindowsOf(ranges: readonly WindowRange[], window_cycle_ticks: number): ClockWindow[] {
    const T = window_cycle_ticks;
    const sorted = ranges.map(range => [Math.ceil(range.start), Math.floor(range.end)] as [number, number])
        .filter(([start, end]) => end >= start).sort((a, b) => a[0] - b[0]);
    const blocks: [number, number][] = [];
    for (const [start, end] of sorted) {
        const last = blocks.at(-1);
        if (last !== undefined && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else blocks.push([start, end]);
    }
    if (blocks.length > 1 && blocks[0][0] <= 0 && blocks.at(-1)![1] >= T - 1) {
        const head = blocks.shift()!;
        const tail = blocks.pop()!;
        blocks.push([tail[0], head[1] + T]);
    }
    return blocks.map(([start, end]) => ({ start: ((start % T) + T) % T, ticks: Math.min(T, end - start + 1) }));
}

/** The windows of a run as the timetable reads them */
export function windowRangesOf(windows: ReadonlyMap<string, readonly OpenRange[]>): Record<string, WindowRange[]> {
    return Object.fromEntries([...windows].map(([id, ranges]) => [id, ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))]));
}

/** The ranges of a window narrowed to the ticks `first` to `last` of it, counted from its start: one range, or two over the end of the window cycle */
export function rangesOfWindowPart(window: ClockWindow, first: number, last: number, window_cycle_ticks: number): WindowRange[] {
    const T = window_cycle_ticks;
    const start = (window.start + first) % T;
    const end = start + (last - first);
    return end < T ? [{ start, end }] : [{ start, end: T - 1 }, { start: 0, end: end - T }];
}

/** One window of an inserter in the timetable, over the span read */
export interface TimetableWindow {
    start: number;
    ticks: number;
    /** Openings of the window in the span, over all copies read */
    openings: number;
    open_ticks: number;
    /** The first and the last needed tick, counted from the window's start; null where no tick was needed */
    needed: [number, number] | null;
    needed_ticks: number;
    needed_by: { start: number; fill: number; wait: number };
    /** Open ticks that were not needed */
    open_without_pickup: number;
    /** Hands the close of the window cut, and of them those that were empty */
    cut_hands: number;
    cut_empty: number;
    /** The cut hands by their open ticks to the swing (`ticks_to_swing` ticks: hands), and those that did not swing in the record */
    ticks_to_swing: Record<string, number>;
    not_swung: number;
    /** Hand starts in the window by their last condition, for a taker of a belt with a record of the four conditions */
    starts_by_last?: Partial<Record<HandCondition, number>>;
    /** The first and the last needed tick over the record from `needed_from` on (`timetableOf`) */
    needed_from_start?: [number, number] | null;
}

/** One inserter of the timetable, over every copy read */
export interface TimetableRow {
    inserter_id: string;
    /** The copies read, 1 the config's own */
    copies: number[];
    windows: TimetableWindow[];
    /** Open ticks at a position no window of the clock has: a record that does not line up with the clock */
    unmapped_open_ticks: number;
}

/** The timetable of a run over the span from `from_tick` up to, not including, `to_tick` */
export interface TimetableLine {
    from_tick: number;
    to_tick: number;
    rows: TimetableRow[];
    /** The inserters of the run that have no window of the clock */
    no_window: string[];
    errors: string[];
}

const mod = (value: number, by: number) => ((value % by) + by) % by;

/** The open ticks from the opening after a cut at `tick` up to the tick the hand leaves for the sink; null where it does not in the record */
function ticksToSwing(record: InserterTimetableRecord, tick: number): number | null {
    let open = 0;
    for (let at = tick + 1; at <= record.last_tick; at++) {
        if (record.swingsOutIn(at)) return open;
        if (record.open(at)) open++;
    }
    return null;
}

/**
 * The timetable of a run's records over the span from `from` up to, not including, `to` (ticks of the run), for the clock's
 * windows on a window cycle of whole ticks: by inserter of the config, over every copy recorded. With `conditions`, the hand
 * starts of each taker of a belt by their last condition. With `needed_from`, each window also has the span of its needed
 * ticks from that tick on, up to `to`.
 */
export function timetableOf(input: {
    records: readonly InserterTimetableRecord[];
    windows: Readonly<Record<string, readonly WindowRange[]>>;
    window_cycle_ticks: number;
    from: number;
    to: number;
    conditions?: readonly TakerConditions[];
    needed_from?: number;
}): TimetableLine {
    const { records, window_cycle_ticks: T, from, to } = input;
    const errors: string[] = [];
    if (!Number.isInteger(T) || T <= 0) throw new Error(`The timetable reads a window cycle of whole ticks, not ${T}`);
    for (const record of records) if (record.error !== null) errors.push(`${record.copy}|${record.inserter_id}: ${record.error}`);
    const ids = [...new Set(records.map(record => record.inserter_id))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const rows: TimetableRow[] = [];
    const no_window: string[] = [];
    for (const inserter_id of ids) {
        const windows = clockWindowsOf(input.windows[inserter_id] ?? [], T);
        if (windows.length === 0) {
            no_window.push(inserter_id);
            continue;
        }
        const window_of = new Int16Array(T).fill(-1);
        windows.forEach((window, index) => { for (let k = 0; k < window.ticks; k++) window_of[(window.start + k) % T] = index; });
        const rows_of: TimetableWindow[] = windows.map(window => ({ start: window.start, ticks: window.ticks, openings: 0, open_ticks: 0, needed: null, needed_ticks: 0,
            needed_by: { start: 0, fill: 0, wait: 0 }, open_without_pickup: 0, cut_hands: 0, cut_empty: 0, ticks_to_swing: {}, not_swung: 0,
            ...(input.needed_from !== undefined && { needed_from_start: null }) }));
        const windowAt = (record: InserterTimetableRecord, tick: number): number => {
            const position = record.positionAt(tick);
            return position < 0 ? -1 : window_of[mod(position - CIRCUIT_LATENCY_TICKS, T)];
        };
        const offsetIn = (record: InserterTimetableRecord, tick: number, index: number) =>
            mod(record.positionAt(tick) - CIRCUIT_LATENCY_TICKS - windows[index].start, T);
        let unmapped = 0;
        const copies = new Set<number>();
        for (const record of records.filter(it => it.inserter_id === inserter_id && it.error === null)) {
            if (record.window_cycle_ticks !== T) {
                errors.push(`${record.copy}|${inserter_id}: its clock has a window cycle of ${record.window_cycle_ticks} ticks, not ${T}`);
                continue;
            }
            copies.add(record.copy + 1);
            for (let tick = Math.max(from, record.first_tick + 1); tick < Math.min(to, record.last_tick + 1); tick++) {
                if (record.open(tick)) {
                    const index = windowAt(record, tick);
                    if (index < 0) {
                        unmapped++;
                    } else {
                        const row = rows_of[index];
                        row.open_ticks++;
                        if (!record.open(tick - 1)) row.openings++;
                        const kind = record.neededAs(tick);
                        if (kind === null) {
                            row.open_without_pickup++;
                        } else {
                            const offset = offsetIn(record, tick, index);
                            row.needed = row.needed === null ? [offset, offset] : [Math.min(row.needed[0], offset), Math.max(row.needed[1], offset)];
                            row.needed_ticks++;
                            row.needed_by[kind]++;
                        }
                    }
                }
                const cut = record.cutIn(tick);
                if (cut !== null) {
                    const index = windowAt(record, tick - 1);
                    if (index >= 0) {
                        const row = rows_of[index];
                        row.cut_hands++;
                        if (cut === "empty") row.cut_empty++;
                        const ticks = ticksToSwing(record, tick);
                        if (ticks === null) row.not_swung++;
                        else row.ticks_to_swing[ticks] = (row.ticks_to_swing[ticks] ?? 0) + 1;
                    }
                }
            }
            if (input.needed_from !== undefined) {
                for (let tick = Math.max(input.needed_from, record.first_tick + 1); tick < Math.min(to, record.last_tick + 1); tick++) {
                    if (!record.open(tick) || record.neededAs(tick) === null) continue;
                    const index = windowAt(record, tick);
                    if (index < 0) continue;
                    const row = rows_of[index];
                    const offset = offsetIn(record, tick, index);
                    row.needed_from_start = row.needed_from_start == null ? [offset, offset]
                        : [Math.min(row.needed_from_start[0], offset), Math.max(row.needed_from_start[1], offset)];
                }
            }
            const conditions = input.conditions?.find(it => it.copy === record.copy && it.inserter_id === inserter_id);
            if (conditions !== undefined) {
                for (const row of rows_of) row.starts_by_last ??= {};
                for (const start of handStartsOf(conditions, from, to)) {
                    const index = windowAt(record, start.tick);
                    if (index < 0) continue;
                    const counts = rows_of[index].starts_by_last!;
                    counts[start.last] = (counts[start.last] ?? 0) + 1;
                }
            }
        }
        rows.push({ inserter_id, copies: [...copies].sort((a, b) => a - b), windows: rows_of, unmapped_open_ticks: unmapped });
    }
    return { from_tick: from, to_tick: to, rows, no_window, errors };
}
