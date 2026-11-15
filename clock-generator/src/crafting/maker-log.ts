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

/** The format of the log, on the `job` event: a field's name and meaning do not change, a new field, a field less or a changed meaning is a new number */
export const MAKER_LOG_FORMAT = "maker-log-1";

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
    // a clock, part or composition that was made and is not listed or taken
    not_stable: ["verdict"],
    margin_check: ["check", "shift_ticks", "group_size"],
    does_not_hold: ["stage"],
    loss_trial_one_copy: ["tried"],
    // a part not taken by Coordinated Sources
    cycle_does_not_divide: ["part_window_cycle_ticks", "shared_window_cycle_ticks"],
    not_counted: [],
    does_not_hold_alone: ["source", "check", "items", "expected_items"],
    same_windows_as_part: ["part"],
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
export const MAKER_LOG_EVENTS = ["job", "clock", "windows", "composition", "part", "not_made", "seconds"] as const;

export type MakerLogSink = (event: MakerLogEvent) => void;

/** The seconds a log counts, by what they were spent on */
export type MakerSecondsKind = "shared_lane_check" | "copies_trial" | "fewer_copies" | "loss_trials_one_copy";
const SECONDS_KINDS: readonly MakerSecondsKind[] = ["shared_lane_check", "copies_trial", "fewer_copies", "loss_trials_one_copy"];

interface Scope {
    sink: MakerLogSink;
    /** Seconds each maker took, by its slot (`ClockAlternative.maker`) */
    makers: Map<string, number>;
    checks: Map<MakerSecondsKind, number>;
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
export function withMakerLog<T>(sink: MakerLogSink | undefined, work: () => T): T {
    if (sink === undefined || scope !== undefined) return work();
    const own: Scope = { sink, makers: new Map(), checks: new Map() };
    scope = own;
    try {
        return work();
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

/** Runs `work` and counts its seconds to a maker, where a log is on */
export function timedMaker<T>(maker: string, work: () => T): T {
    const own = scope;
    if (own === undefined) return work();
    const started = now();
    try {
        return work();
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
