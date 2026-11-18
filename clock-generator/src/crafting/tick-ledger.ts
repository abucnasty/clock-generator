/**
 * The tick ledger: every tick a generation simulates, counted to the purpose of the run it belongs to and to the loop
 * that ran it. A caller reads the count where it likes: the sink of `withTickLedger` is given it once the work ends. The
 * ledger has a switch of its own, as the maker log has, and writes nothing to a log.
 *
 * Off unless a caller opens a ledger with `withTickLedger`: with none open nothing is counted, no row is built, and
 * nothing a generation computes changes. The ledger only reads the runs a generation makes; it never asks for one.
 *
 * Four words tell what a tick was for:
 * - the maker: the generator's slot that asked for the run (`withTickMaker`), or none where no maker was running.
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

/** The ticks and runs of one maker and purpose in one loop */
export interface TickLedgerRow {
    /** The maker the runs were made inside (`withTickMaker`); null where no maker was running */
    maker: string | null;
    purpose: TickPurpose;
    stage: TickStage;
    loop: TickLoop;
    /** Loops that ran: a loop that ran no tick counts a run too */
    runs: number;
    ticks: number;
}

/**
 * What a warm-up gave, read against the judged cycle (the first window cycle of the recorded run that follows it):
 * - `found`: a warm-up window cycle gave the same output as the judged cycle (`cycle`, counted from 1).
 * - `none`: no window cycle the warm-up ran did.
 * - `no_warm_up`: the warm-up was asked for no whole window cycle, so it has none to read.
 * - `not_judged`: the run gave no judged cycle (it was shorter than a window cycle, or an error ended it).
 * - `not_whole`: the window cycle is not a whole number of ticks, so its output is not counted by the window cycle.
 * - `no_output`: the build has no output inserter to read.
 */
export const SHADOW_OUTCOMES = ["found", "none", "no_warm_up", "not_judged", "not_whole", "no_output"] as const;

export type ShadowOutcome = (typeof SHADOW_OUTCOMES)[number];

/** The warm-ups of one maker and purpose that ended in the same way: a count by cycle, never a line a run */
export interface TickShadowRow {
    maker: string | null;
    purpose: TickPurpose;
    outcome: ShadowOutcome;
    /** The first warm-up window cycle (from 1) whose output equals the judged cycle's; null unless `found` */
    cycle: number | null;
    /** Whether every window cycle the warm-up ran after `cycle` gave that output too; false unless `found` */
    stays: boolean;
    /** The window cycles the warm-up ran in whole (fewer than asked where it stopped at its repeat) */
    ran: number;
    /** The whole window cycles the warm-up was asked for */
    asked: number;
    runs: number;
}

/** What a ledger counted */
export interface TickLedgerCount {
    /** By maker (none first, then by name), by purpose, then by loop, in the order of `TICK_PURPOSES` and `TICK_LOOPS`; a row only where a loop ran */
    rows: TickLedgerRow[];
    /** Runs the run memo handed out again, by the maker and purpose that asked: runs asked with no tick simulated */
    memo_hits: { maker: string | null; purpose: TickPurpose; hits: number }[];
    /** The shadow count: every warm-up run, by maker, purpose and outcome (the runs of a maker and purpose add up to the `warmup_step` rows of it) */
    shadows: TickShadowRow[];
}

export type TickLedgerSink = (count: TickLedgerCount) => void;

/** A loop in progress; `close` counts it */
export interface OpenTickLoop {
    close(): void;
}

interface OpenLoop extends OpenTickLoop {
    maker: string | null;
    purpose: TickPurpose;
    loop: TickLoop;
    ticks: () => number;
}

interface Scope {
    sink: TickLedgerSink;
    rows: Map<string, TickLedgerRow>;
    memo_hits: Map<string, { maker: string | null; purpose: TickPurpose; hits: number }>;
    shadows: Map<string, TickShadowRow>;
    /** The shadows begun and not finished */
    shadows_open: Set<() => void>;
    /** The loops begun and not ended */
    open: Set<OpenLoop>;
    /** The maker whose work is now running */
    maker: string | null;
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

/** The key of a maker in a row: the null maker has a key no maker's name can have */
const makerKey = (maker: string | null): string => maker === null ? "" : `maker:${maker}`;

function count(own: Scope, maker: string | null, purpose: TickPurpose, loop: TickLoop, ticks: number): void {
    const key = `${makerKey(maker)}/${purpose}/${loop}`;
    const row = own.rows.get(key);
    if (row === undefined) {
        own.rows.set(key, { maker, purpose, stage: TICK_STAGE_OF_LOOP[loop], loop, runs: 1, ticks });
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
    const own: Scope = { sink, rows: new Map(), memo_hits: new Map(), shadows: new Map(), shadows_open: new Set(), open: new Set(), maker: null,
        purpose: "no_purpose", claimed: false };
    scope = own;
    try {
        return work();
    } finally {
        scope = undefined;
        // a loop that an error left open is counted as far as it went
        for (const open of own.open) count(own, open.maker, open.purpose, open.loop, open.ticks());
        own.open.clear();
        // a warm-up whose run an error ended before its judged cycle is counted as one with none
        for (const finish of [...own.shadows_open]) finish();
        const purposeOrder = (purpose: TickPurpose) => TICK_PURPOSES.indexOf(purpose);
        // the order does not depend on the order the runs were made in: two counts of one generation are the same
        const makerOrder = (a: string | null, b: string | null) => a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1;
        sink({
            rows: [...own.rows.values()].sort((a, b) => makerOrder(a.maker, b.maker) || purposeOrder(a.purpose) - purposeOrder(b.purpose)
                || TICK_LOOPS.indexOf(a.loop) - TICK_LOOPS.indexOf(b.loop)),
            memo_hits: [...own.memo_hits.values()].sort((a, b) => makerOrder(a.maker, b.maker) || purposeOrder(a.purpose) - purposeOrder(b.purpose)),
            shadows: [...own.shadows.values()].sort((a, b) => makerOrder(a.maker, b.maker) || purposeOrder(a.purpose) - purposeOrder(b.purpose)
                || SHADOW_OUTCOMES.indexOf(a.outcome) - SHADOW_OUTCOMES.indexOf(b.outcome) || (a.cycle ?? 0) - (b.cycle ?? 0)
                || Number(a.stays) - Number(b.stays) || a.ran - b.ran || a.asked - b.asked),
        });
    }
}

/**
 * Runs `work` with `maker` as the maker its runs are counted to, where a ledger is open. The scopes nest; the innermost maker
 * is the one counted.
 */
export function withTickMaker<T>(maker: string, work: () => T): T {
    const own = scope;
    if (own === undefined) return work();
    const before = own.maker;
    own.maker = maker;
    try {
        return work();
    } finally {
        own.maker = before;
    }
}

/**
 * Runs `work` with `purpose` as the purpose of the runs in it, where a ledger is open. Inside a scope that claims its runs
 * (`claim: true`) the purpose stays that scope's.
 */
export function withTickPurpose<T>(purpose: TickPurpose, work: () => T, options: { claim?: boolean } = {}): T {
    purposes_running.push(purpose);
    try {
        return countedUnderPurpose(purpose, work, options);
    } finally {
        purposes_running.pop();
    }
}

/** The purposes of the work running now, outermost first, whether a ledger is open or not (see `runsThatMakeWindows`) */
const purposes_running: TickPurpose[] = [];

/** The runs that make or try the windows of a clock: the ones the judged start leaves cold (`judged_start`) */
const WINDOW_MAKING_PURPOSES: readonly TickPurpose[] = ["margin_check", "window_derivation", "pitch_pickups", "fuel_view"];

/** Whether the work running now is inside a run that makes or tries windows, not one that judges a clock */
export function runsThatMakeWindows(): boolean {
    return purposes_running.some(purpose => WINDOW_MAKING_PURPOSES.includes(purpose));
}

function countedUnderPurpose<T>(purpose: TickPurpose, work: () => T, options: { claim?: boolean }): T {
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
        maker: own.maker,
        purpose: own.purpose,
        loop,
        ticks,
        close: () => {
            if (own.open.delete(open)) count(own, open.maker, open.purpose, open.loop, ticks());
        },
    };
    own.open.add(open);
    return open;
}

/** Counts a run the run memo handed out again to the purpose that asked, where a ledger is open */
export function countRunMemoHit(): void {
    const own = scope;
    if (own === undefined) return;
    const key = `${makerKey(own.maker)}/${own.purpose}`;
    const row = own.memo_hits.get(key);
    if (row === undefined) own.memo_hits.set(key, { maker: own.maker, purpose: own.purpose, hits: 1 });
    else row.hits++;
}

/**
 * Where the output of a window cycle first equals the judged cycle's. `warm_up` holds what each warm-up window cycle gave
 * (an item count for each output, in one order), `judged` what the judged cycle gave. The cycle counts from 1. Exact: every
 * output gives the same count. `stays` says that every later warm-up window cycle gave that output too.
 */
export function shadowOf(warm_up: readonly (readonly number[])[], judged: readonly number[]): { cycle: number | null; stays: boolean } {
    const same = (output: readonly number[]) => output.length === judged.length && output.every((items, index) => items === judged[index]);
    const first = warm_up.findIndex(same);
    return first === -1 ? { cycle: null, stays: false } : { cycle: first + 1, stays: warm_up.slice(first).every(same) };
}

/** A warm-up's window cycles, watched: the warm-up step tells it where each one ends */
export interface WindowCycleWatch {
    window_cycle_ticks: number;
    /** The warm-up has run one more whole window cycle */
    cycle_ended(): void;
}

/**
 * The shadow of one run: a record of the output at the end of each warm-up window cycle and at the end of the judged cycle.
 * It only reads, and it never asks for a run. The run gives it a reader of its outputs; it counts to the maker and purpose
 * that were set when it began.
 */
export interface ShadowWatch {
    /** For the warm-up step; undefined where the output of a window cycle is not counted (`not_whole`, `no_output`) */
    warm_up: WindowCycleWatch | undefined;
    /** A recorder for the step of the recorded run, which reads the output at the end of its first window cycle; undefined as `warm_up` */
    judged(ticks_run: () => number): { record(): void } | undefined;
    /** Ends the shadow: counts the run. A shadow not finished when the ledger closes is counted as `not_judged` */
    finish(): void;
}

/**
 * Begins the shadow of a run that warms up for `asked` whole window cycles of `window_cycle_ticks` ticks, where a ledger is
 * open. `read` gives the items each of the `outputs` output inserters has dropped, in total, in one order. Returns undefined
 * where no ledger is open: nothing is read or built.
 */
export function beginShadow(window_cycle_ticks: number, asked: number, outputs: number, read: () => number[]): ShadowWatch | undefined {
    const own = scope;
    if (own === undefined) return undefined;
    const { maker, purpose } = own;
    const fixed: ShadowOutcome | undefined = !(Number.isInteger(window_cycle_ticks) && window_cycle_ticks > 0) ? "not_whole" : outputs === 0 ? "no_output" : undefined;
    // the totals at the start of the warm-up and after each window cycle of it
    const warm_up: number[][] = fixed === undefined ? [read()] : [];
    let judged_start: number[] | undefined;
    let judged: number[] | undefined;
    let finished = false;
    const countOutcome = (outcome: ShadowOutcome, cycle: number | null, stays: boolean, ran: number) => {
        const key = `${makerKey(maker)}/${purpose}/${outcome}/${cycle}/${stays}/${ran}/${asked}`;
        const row = own.shadows.get(key);
        if (row === undefined) own.shadows.set(key, { maker, purpose, outcome, cycle, stays, ran, asked, runs: 1 });
        else row.runs++;
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        own.shadows_open.delete(finish);
        const ran = Math.max(0, warm_up.length - 1);
        if (fixed !== undefined) return countOutcome(fixed, null, false, 0);
        if (asked === 0) return countOutcome("no_warm_up", null, false, ran);
        if (judged === undefined) return countOutcome("not_judged", null, false, ran);
        const cycles = warm_up.slice(1).map((totals, index) => totals.map((items, output) => items - warm_up[index][output]));
        const { cycle, stays } = shadowOf(cycles, judged);
        countOutcome(cycle === null ? "none" : "found", cycle, stays, ran);
    };
    own.shadows_open.add(finish);
    if (fixed !== undefined) return { warm_up: undefined, judged: () => undefined, finish };
    return {
        warm_up: { window_cycle_ticks, cycle_ended: () => { warm_up.push(read()); } },
        judged: ticks_run => {
            judged_start = read();
            return { record: () => {
                if (judged === undefined && ticks_run() >= window_cycle_ticks) judged = read().map((items, output) => items - judged_start![output]);
            } };
        },
        finish,
    };
}
