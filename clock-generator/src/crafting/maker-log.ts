/**
 * The maker log: what each maker made in a generation and why clocks were dropped, as events a caller reads and writes
 * where it likes (the blast writes one file a job, `scripts/blast/blast.sh run --log`; the schema is in `scripts/blast/MAKER-LOG.md`).
 *
 * Off unless a caller passes `maker_log` to `generateClockAlternatives`: with no sink no event is built, no clock is
 * timed, and nothing a generation computes changes. The log only reads what the generation computed; it never asks
 * for a check the generation did not run.
 *
 * Reasons are codes with numbers, never sentences (`MakerReason`). The sentence a reason has in a result is the result's
 * own and is not changed by the log.
 */

import type { ClockRunForLog, OneCopyForLog } from "./one-copy-log";
import type { SharedLanesForLog } from "./shared-lane-log";
import { withTickLedger, withTickMaker, type TickLedgerCount } from "./tick-ledger";

/** The format of the log, on the `job` event: a field's name and meaning do not change, a new field, a field less or a changed meaning is a new number */
export const MAKER_LOG_FORMAT = "maker-log-4";

/** A reason as a code with numbers: the fields a code has are those `MAKER_REASON_CODES` lists for it */
export interface MakerReason {
    code: string;
    [field: string]: number | string | boolean | null | undefined;
}

/**
 * Every code of a reason and the fields it has besides `code`, so that a reader can tell a code it does not know from one it
 * does (`scripts/blast/MAKER-LOG.md` says what each means). `other` is a reason no site gave a code: it is a fault of the
 * log, and the blast has none.
 */
export const MAKER_REASON_CODES = {
    // a maker that made no clock (event `not_made`), and the Coordinated Sources compositions that were not made
    takes_from_belt: ["inserter", "source_kind"],
    has_drills: [],
    no_search_pick: ["search"],
    fractional_swings_over_limit: ["sub_cycle", "swings_required", "swings_max", "total_swings", "cycle_multiplier"],
    window_cycle_not_whole: ["window_cycle_ticks"],
    no_source_has_choice: [],
    recommended_not_a_part: [],
    plans_on_other_window_cycle: ["planned_ticks", "recommended_ticks"],
    keeps_recommended_clock: [],
    same_as_listed_clock: [],
    // metered takers: no source hands to two or more target machines, or no output swing count up to the most gives windows that hold
    metered_window_unproved: ["inserter", "cause"],
    metered_plan_override: ["terminal_swing_count", "lcm"],
    no_metered_takers: ["target_machines"],
    no_count_holds: ["swings_max", "whole_counts", "as_built_refusals", "margin_refusals"],
    // a clock, part or composition that was made and is not listed or taken
    not_stable: ["verdict"],
    margin_check: ["check", "shift_ticks", "group_size"],
    does_not_hold: ["stage"],
    loss_trial_one_copy: ["tried"],
    does_not_hold_with_copies: ["check"],
    // a part not taken by Coordinated Sources
    cycle_does_not_divide: ["part_window_cycle_ticks", "shared_window_cycle_ticks"],
    not_counted: [],
    does_not_hold_alone: ["source", "check", "items", "expected_items"],
    same_windows_as_part: ["part"],
    // a listed clock of a job whose copies share a lane, with no facts of the lanes (event `lane_facts`)
    not_run_with_copies: ["cause"],
    // a listed clock with no timetable of its run of one copy, no ledger, or no repeat check (events `timetable`, `ledger`, `repeat_check`)
    no_run_of_one_copy: ["cause"],
    not_repeat_checked: ["cause"],
    other: [],
} as const satisfies Record<string, readonly string[]>;

export type MakerReasonCode = keyof typeof MAKER_REASON_CODES;

/** A reason of a code with its fields */
export function reasonOf(code: MakerReasonCode, fields: Record<string, number | string | boolean | null | undefined> = {}): MakerReason {
    return { code, ...fields };
}

/** An error whose message is the sentence a result shows and whose `reason` is the log's code for it */
export class CodedError extends Error {
    readonly reason: MakerReason;

    constructor(message: string, reason: MakerReason) {
        super(message);
        this.reason = reason;
    }
}

/** The code of a reason an error carries (a `CodedError`, or any error with a `reason` of its own); `other` for an error that carries none */
export function reasonOfError(error: unknown): MakerReason {
    const reason = error instanceof Error ? (error as { reason?: unknown }).reason : undefined;
    return typeof reason === "object" && reason !== null && typeof (reason as MakerReason).code === "string" ? reason as MakerReason : reasonOf("other");
}

/** An event of the log; `event` names its kind (`MAKER_LOG_EVENTS`) */
export interface MakerLogEvent {
    event: string;
    [field: string]: unknown;
}

/** The events, in the order a log lists them (the order they are made in within a kind) */
export const MAKER_LOG_EVENTS = ["job", "job_lanes", "clock", "windows", "lane_facts", "missed_swings", "timetable", "ledger", "repeat_check", "composition", "part",
    "not_made", "ticks", "shadow", "seconds"] as const;

export type MakerLogSink = (event: MakerLogEvent) => void;

/**
 * The `ticks` event: the ticks the generation simulated and the runs it made, by maker, purpose and stage (`tick-ledger.ts`).
 * One event a job, with a row for each maker, purpose and loop that ran, never a line for a tick or a run.
 */
export function ticksEventOf(count: TickLedgerCount): MakerLogEvent {
    return { event: "ticks", rows: count.rows.map(row => ({ maker: row.maker, purpose: row.purpose, stage: row.stage, loop: row.loop, runs: row.runs, ticks: row.ticks })),
        memo_hits: count.memo_hits.map(hit => ({ maker: hit.maker, purpose: hit.purpose, hits: hit.hits })) };
}

/**
 * The `shadow` event: what each warm-up gave, read against the judged cycle (`tick-ledger.ts`). One event a job, with a row for each
 * maker, purpose and outcome, and cycle: a count of warm-up runs, never a line for a run.
 */
export function shadowEventOf(count: TickLedgerCount): MakerLogEvent {
    return { event: "shadow", rows: count.shadows.map(row => ({ maker: row.maker, purpose: row.purpose, outcome: row.outcome, cycle: row.cycle, stays: row.stays,
        ran: row.ran, asked: row.asked, runs: row.runs })) };
}

/** The seconds a log counts, by what they were spent on */
export type MakerSecondsKind = "shared_lane_check" | "copies_trial" | "fewer_copies" | "loss_trials_one_copy" | "timetable" | "repeat_check";
const SECONDS_KINDS: readonly MakerSecondsKind[] = ["shared_lane_check", "copies_trial", "fewer_copies", "loss_trials_one_copy", "timetable", "repeat_check"];

interface Scope {
    sink: MakerLogSink;
    /** Seconds each maker took, by its slot (`ClockAlternative.maker`) */
    makers: Map<string, number>;
    checks: Map<MakerSecondsKind, number>;
    /** What the check of the shared lanes kept for the log of each clock made, by the clock's result (`noteClockLanes`) */
    lanes: WeakMap<object, ClockLanesForLog>;
    /** What the log kept of each run of one copy whose wakeups a check counted, by the wakeups it counted (`noteRunOfOneCopy`) */
    one_copy: WeakMap<object, OneCopyForLog>;
    /** How each clock made is run on one copy, by the clock's result (`noteClockRun`) */
    runs: WeakMap<object, ClockRunForLog>;
    /** Whether the generation asked for the repeat check (`MakerLogOptions.repeat_check`) */
    repeat_check: boolean;
}

/** What a generation asks of its log besides the events */
export interface MakerLogOptions {
    /**
     * Each listed clock that holds on one copy is run again on its windows narrowed to the ticks its run needed, and the two
     * runs are compared (event `repeat_check`). Off by default: it runs the clock again, which the generation does not.
     */
    repeat_check?: boolean;
}

/** What the checks with the copies kept of one clock for the log: whether it holds on one copy, whether its lanes were checked, and their facts */
export interface ClockLanesForLog {
    held: boolean;
    /** Whether the check of the shared lanes stopped with an error */
    not_checked: boolean;
    /** The facts of the lanes, where the check ran them (`SharedLaneJudgement.for_log`) */
    for_log: SharedLanesForLog | null;
}

/** The log being made: set while a generation that asked for one runs, as the run memo is */
let scope: Scope | undefined;

/** Whether a generation that asked for a log is running: where it is not, build no event and time nothing */
export function makerLogOn(): boolean {
    return scope !== undefined;
}

const now = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());

/**
 * Runs `work` with the sink, then gives it the `seconds` event. Without a sink it runs `work` as it is. The log is not
 * nested: a generation inside another's `work` writes to the first.
 */
export function withMakerLog<T>(sink: MakerLogSink | undefined, work: () => T, options: MakerLogOptions = {}): T {
    if (sink === undefined || scope !== undefined) return work();
    const own: Scope = { sink, makers: new Map(), checks: new Map(), lanes: new WeakMap(), one_copy: new WeakMap(), runs: new WeakMap(),
        repeat_check: options.repeat_check === true };
    scope = own;
    try {
        // the ledger of the ticks is open as long as the log is, and gives its events before the seconds
        return withTickLedger(count => { sink(ticksEventOf(count)); sink(shadowEventOf(count)); }, work);
    } finally {
        scope = undefined;
        const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
        sink({ event: "seconds", makers: Object.fromEntries([...own.makers].map(([maker, seconds]) => [maker, round(seconds)])),
            ...Object.fromEntries(SECONDS_KINDS.map(kind => [`${kind}_seconds`, round(own.checks.get(kind) ?? 0)])) });
    }
}

/** Gives the sink an event, made only where there is one */
export function emitMakerLog(make: () => MakerLogEvent): void {
    scope?.sink(make());
}

/** Keeps what the checks with the copies found of a clock, by its result, for the events of the listed clocks; nothing where no log is on */
export function noteClockLanes(result: object, lanes: ClockLanesForLog): void {
    scope?.lanes.set(result, lanes);
}

/** What `noteClockLanes` kept of the clock with this result; undefined where nothing was kept */
export function clockLanesOf(result: object): ClockLanesForLog | undefined {
    return scope?.lanes.get(result);
}

/** Keeps what the log read of a run of one copy, by the wakeups a check counted on it (`AsBuiltStabilityCheck.wake_ups`); nothing where no log is on */
export function noteRunOfOneCopy(wake_ups: object, run: OneCopyForLog): void {
    scope?.one_copy.set(wake_ups, run);
}

/** What `noteRunOfOneCopy` kept of the run whose wakeups these are; undefined where nothing was kept */
export function runOfOneCopyOf(wake_ups: object): OneCopyForLog | undefined {
    return scope?.one_copy.get(wake_ups);
}

/** Keeps how a clock made is run on one copy, by its result, for the repeat check; nothing where no log is on */
export function noteClockRun(result: object, run: ClockRunForLog): void {
    scope?.runs.set(result, run);
}

/** What `noteClockRun` kept of the clock with this result; undefined where nothing was kept */
export function clockRunOf(result: object): ClockRunForLog | undefined {
    return scope?.runs.get(result);
}

/** Whether the generation running asked for the repeat check */
export function repeatCheckOn(): boolean {
    return scope?.repeat_check === true;
}

/**
 * Runs `work` with the events it gives held back instead of given to the sink; the caller gives those it keeps (`emitMakerLog`).
 * Its seconds are counted as they would be. Without a log no event is built and none is held.
 */
export function heldMakerLog<T>(work: () => T): { value: T; events: MakerLogEvent[] } {
    const own = scope;
    const events: MakerLogEvent[] = [];
    if (own === undefined) return { value: work(), events };
    scope = { ...own, sink: event => { events.push(event); } };
    try {
        return { value: work(), events };
    } finally {
        scope = own;
    }
}

/**
 * Runs `work` and counts its seconds to a maker, where a log is on. The ticks the work simulates are counted to the maker too
 * (`withTickMaker`, a ledger of its own: it does nothing where none is open).
 */
export function timedMaker<T>(maker: string, work: () => T): T {
    const own = scope;
    if (own === undefined) return withTickMaker(maker, work);
    const started = now();
    try {
        return withTickMaker(maker, work);
    } finally {
        own.makers.set(maker, (own.makers.get(maker) ?? 0) + (now() - started) / 1000);
    }
}

/**
 * Runs `work` and counts its seconds to a kind of check, where a log is on. The seconds of a check a maker asked for are in the maker's too.
 * A check that a generation shares between makers (the run memo) is counted where it was first made.
 */
export function timedCheck<T>(kind: MakerSecondsKind, work: () => T): T {
    const own = scope;
    if (own === undefined) return work();
    const started = now();
    try {
        return work();
    } finally {
        own.checks.set(kind, (own.checks.get(kind) ?? 0) + (now() - started) / 1000);
    }
}
