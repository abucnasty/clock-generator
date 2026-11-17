/**
 * The tick ledger: every tick a generation simulates, counted to the purpose of the run it belongs to and to the loop
 * that ran it. A caller reads the count where it likes: the sink of `withTickLedger` is given it once the work ends. The
 * ledger has a switch of its own, as the maker log has, and writes nothing to a log.
 *
 * Off unless a caller opens a ledger with `withTickLedger`: with none open nothing is counted, no row is built, and
 * nothing a generation computes changes. The ledger only reads the runs a generation makes; it never asks for one.
 *
 * Three words tell what a tick was for:
 * - the purpose: the question the run answered (`TickPurpose`). A run sets its purpose with `withTickPurpose`.
 * - the stage: where in its run the tick fell: `prepare`, `warm_up` or `judged`.
 * - the loop: which tick loop of the engine ran it (`TickLoop`). The stage follows from the loop, and the loops of a
 *   stage can be told apart. `judged` holds the ticks of the recorded run (`simulate_step`), and also those of the loops
 *   that judge a clock without a run of that kind: the loss trials and the proof of every start phase. A reader that
 *   wants the recorded ticks alone takes the loop `simulate_step`.
 *
 * The count is added to the ledger when a loop ends, never in a tick: a loop that stops with an error is counted at the
 * moment the ledger closes, from the ticks it had run by then.
 *
 * A purpose is set around the work that asks for a run. The scopes nest; a tick goes to the innermost purpose, unless an
 * outer scope claims its ticks (`claim: true`): then every run inside goes to that purpose. A check that is made of
 * several kinds of run (the quick trial, the trials on the copies) claims, so that its row holds its whole cost.
 */

/** What a run was made for */
export const TICK_PURPOSES = [
    // the planning run of a clock: the crafting cycle and the windows are read off it
    "planning",
    // the checks of a clock made of its windows alone (`runAsBuiltCheck`)
    "first_span", "long_run", "taker_order", "start_phase",
    // a clock-only check of a search that makes no long run
    "quick_trial",
    // what a clock is tried on after its check
    "trial_one_copy", "trial_copies", "shared_lane_check", "fewer_copies",
    // what only a log asks for: the repeat check runs a clock again on its narrowed windows
    "repeat_check",
    // the checks that a clock is judged by besides the above
    "start_dependence", "wakeups_from_starts",
    // the runs that make or try the windows of a clock: a window moved a tick, the windows read off a run of the output
    // inserters alone, the search of the full-hand windows, the fuel a clock's run burns
    "margin_check", "window_derivation", "pitch_pickups", "fuel_view",
    // the check of a configuration alone (`validateConfig`), which makes no clock
    "config_check",
    // a tick no scope gave a purpose: a fault of the ledger, the tests have none
    "no_purpose",
] as const;

export type TickPurpose = (typeof TICK_PURPOSES)[number];

/** Where in a run a tick fell */
export type TickStage = "prepare" | "warm_up" | "judged";

/** The tick loops of the engine, in the order a count lists them */
export const TICK_LOOPS = ["prepare_step", "warmup_step", "simulate_step", "loss_trials", "phase_proof"] as const;

export type TickLoop = (typeof TICK_LOOPS)[number];

/** The stage of each loop */
export const TICK_STAGE_OF_LOOP: Record<TickLoop, TickStage> = {
    prepare_step: "prepare",
    warmup_step: "warm_up",
    simulate_step: "judged",
    loss_trials: "judged",
    phase_proof: "judged",
};

/** The ticks and runs of one purpose in one loop */
export interface TickLedgerRow {
    purpose: TickPurpose;
    stage: TickStage;
    loop: TickLoop;
    /** Loops that ran: a loop that ran no tick counts a run too */
    runs: number;
    ticks: number;
}

/** What a ledger counted */
export interface TickLedgerCount {
    /** By purpose, then by loop, in the order of `TICK_PURPOSES` and `TICK_LOOPS`; a row only where a loop ran */
    rows: TickLedgerRow[];
    /** Runs the run memo handed out again, by the purpose that asked: runs asked with no tick simulated */
    memo_hits: { purpose: TickPurpose; hits: number }[];
}

export type TickLedgerSink = (count: TickLedgerCount) => void;

/** A loop in progress; `close` counts it */
export interface OpenTickLoop {
    close(): void;
}

interface OpenLoop extends OpenTickLoop {
    purpose: TickPurpose;
    loop: TickLoop;
    ticks: () => number;
}

interface Scope {
    sink: TickLedgerSink;
    rows: Map<string, TickLedgerRow>;
    memo_hits: Map<TickPurpose, number>;
    /** The loops begun and not ended */
    open: Set<OpenLoop>;
    /** The purpose of the work now running */
    purpose: TickPurpose;
    /** Whether the work now running is inside a scope that claims every run in it */
    claimed: boolean;
}

/** The ledger being made: set while a generation that asked for one runs, as the maker log's is */
let scope: Scope | undefined;

/** Whether a ledger is open: where none is, build no row and count nothing */
export function tickLedgerOn(): boolean {
    return scope !== undefined;
}

function count(own: Scope, purpose: TickPurpose, loop: TickLoop, ticks: number): void {
    const key = `${purpose}/${loop}`;
    const row = own.rows.get(key);
    if (row === undefined) {
        own.rows.set(key, { purpose, stage: TICK_STAGE_OF_LOOP[loop], loop, runs: 1, ticks });
    } else {
        row.runs++;
        row.ticks += ticks;
    }
}

/**
 * Runs `work` with a ledger open, then gives the sink the count. Without a sink it runs `work` as it is. The ledger is not
 * nested: a generation inside another's `work` counts to the first.
 */
export function withTickLedger<T>(sink: TickLedgerSink | undefined, work: () => T): T {
    if (sink === undefined || scope !== undefined) return work();
    const own: Scope = { sink, rows: new Map(), memo_hits: new Map(), open: new Set(), purpose: "no_purpose", claimed: false };
    scope = own;
    try {
        return work();
    } finally {
        scope = undefined;
        // a loop that an error left open is counted as far as it went
        for (const open of own.open) count(own, open.purpose, open.loop, open.ticks());
        own.open.clear();
        const purposeOrder = (purpose: TickPurpose) => TICK_PURPOSES.indexOf(purpose);
        sink({
            rows: [...own.rows.values()].sort((a, b) => purposeOrder(a.purpose) - purposeOrder(b.purpose)
                || TICK_LOOPS.indexOf(a.loop) - TICK_LOOPS.indexOf(b.loop)),
            memo_hits: [...own.memo_hits].map(([purpose, hits]) => ({ purpose, hits })).sort((a, b) => purposeOrder(a.purpose) - purposeOrder(b.purpose)),
        });
    }
}

/**
 * Runs `work` with `purpose` as the purpose of the runs in it, where a ledger is open. Inside a scope that claims its runs
 * (`claim: true`) the purpose stays that scope's.
 */
export function withTickPurpose<T>(purpose: TickPurpose, work: () => T, options: { claim?: boolean } = {}): T {
    const own = scope;
    if (own === undefined || own.claimed) return work();
    const before = own.purpose;
    own.purpose = purpose;
    own.claimed = options.claim === true;
    try {
        return work();
    } finally {
        own.purpose = before;
        own.claimed = false;
    }
}

/**
 * Begins a loop of ticks, where a ledger is open: `ticks` reads the ticks it has run so far. Call `close` on the returned
 * loop when the loop ends. Returns undefined where no ledger is open.
 */
export function beginTickLoop(loop: TickLoop, ticks: () => number): OpenTickLoop | undefined {
    const own = scope;
    if (own === undefined) return undefined;
    const open: OpenLoop = {
        purpose: own.purpose,
        loop,
        ticks,
        close: () => {
            if (own.open.delete(open)) count(own, open.purpose, open.loop, ticks());
        },
    };
    own.open.add(open);
    return open;
}

/** Counts a run the run memo handed out again to the purpose that asked, where a ledger is open */
export function countRunMemoHit(): void {
    const own = scope;
    if (own !== undefined) own.memo_hits.set(own.purpose, (own.memo_hits.get(own.purpose) ?? 0) + 1);
}
