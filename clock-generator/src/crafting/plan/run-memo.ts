import type { BuildRun, RunOptions } from "./plan-run";
import type { Config } from "../../config";
import type { BackpressureLossAssessment } from "../trial";

/**
 * A run shorter than this is simulated again rather than kept. A run of 100,000 ticks takes seconds; a shorter one
 * costs less to make again than the memory of its histories, so a generation of builds with short periods keeps none.
 */
export const RUN_MEMO_MIN_TICKS = 100_000;

/** How deep a value may nest to be written: a config is a few levels deep, so more is a value that refers to itself */
const MAX_DEPTH = 64;

/**
 * What a value is, written out as a key, or null where it holds something a key cannot tell apart from another value:
 * a function, a class instance, a number that is not finite, a value that nests without end. Plain objects are written with their members in the
 * order they have (two configs that differ in it are two keys, so a hit never rests on the order not mattering), a
 * member that is undefined apart from one that is not there, and a Map or a Set in the order of its entries.
 */
export function canonicalKey(value: unknown): string | null {
    const out: string[] = [];
    return write(value, out, 0) ? out.join("") : null;
}

function write(value: unknown, out: string[], depth: number): boolean {
    switch (typeof value) {
        case "string":
            out.push(JSON.stringify(value));
            return true;
        case "boolean":
        case "undefined":
            out.push(String(value));
            return true;
        case "number":
            if (!Number.isFinite(value)) return false;
            out.push(Object.is(value, -0) ? "-0" : String(value));
            return true;
        case "object":
            return depth < MAX_DEPTH && writeObject(value, out, depth + 1);
        default:
            return false;
    }
}

function writeObject(value: object | null, out: string[], depth: number): boolean {
    if (value === null) {
        out.push("null");
        return true;
    }
    if (Array.isArray(value)) {
        out.push("[");
        for (let index = 0; index < value.length; index++) {
            if (index > 0) out.push(",");
            if (!write(value[index], out, depth)) return false;
        }
        out.push("]");
        return true;
    }
    if (value instanceof Map || value instanceof Set) {
        out.push(value instanceof Map ? "Map{" : "Set{");
        let first = true;
        for (const entry of value instanceof Map ? value.entries() : value.values()) {
            if (!first) out.push(",");
            first = false;
            if (!write(entry, out, depth)) return false;
        }
        out.push("}");
        return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    out.push("{");
    let first = true;
    for (const [member, entry] of Object.entries(value)) {
        if (!first) out.push(",");
        first = false;
        out.push(JSON.stringify(member), ":");
        if (!write(entry, out, depth)) return false;
    }
    out.push("}");
    return true;
}

/**
 * The runs of a build that one generation makes more than once. A run (`runBuild`) is a function of its config and its
 * options and of nothing else that changes while a generation lasts, so the second run of the same pair is the first's
 * result: the lower swing counts are planned again by their own alternatives, and alternatives with the same windows
 * are checked from the same starts. The memo lives as long as the generation that opened it (`withRunMemo`), so no
 * generation meets the runs of another, and a change of the game data or of the engine between two of them cannot
 * leave a run behind.
 *
 * It also keeps what the backpressure loss trials of a clock found (`backpressureLoss`): the trials are many short runs
 * of the build, each too short to be kept above, and a clock is tried by the alternative that picks its windows and by
 * the one that assesses it.
 */
export class RunMemo {
    /** Runs handed out again, to count what the memo saved */
    hits = 0;
    private readonly kept = new Map<string, BuildRun>();

    constructor(readonly min_ticks: number = RUN_MEMO_MIN_TICKS) { }

    /** Runs kept so far */
    get size(): number {
        return this.kept.size;
    }

    /** What the backpressure loss trials of a clock found, by what they are a function of (see `backpressureLoss`) */
    private readonly losses = new Map<string, BackpressureLossAssessment>();
    /** Verdicts handed out again */
    loss_hits = 0;

    /**
     * The verdict of the loss trials of a clock: the one kept, or the one `tried` makes. A clock that cannot be tried
     * is tried again, so that what is logged about it is logged by each.
     */
    backpressureLoss(key: string, tried: () => BackpressureLossAssessment): BackpressureLossAssessment {
        const kept = this.losses.get(key);
        if (kept !== undefined) {
            this.loss_hits++;
            return kept;
        }
        const verdict = tried();
        if (verdict.backpressure_loss !== null) {
            this.losses.set(key, verdict);
        }
        return verdict;
    }

    /**
     * Whether the memo takes a run with these options: not one that is debugged, nor one that records a series of
     * every tick (stock, fuel levels, a timeline), which is asked for once and is large to keep.
     */
    static accepts(options: RunOptions): boolean {
        return options.debug === undefined && options.debug_steps === undefined && options.timeline_recording === undefined
            && options.machine_stock !== true && options.fuel_levels !== true;
    }

    /** The run of this config and these options: the one kept, or the one `simulate` makes (kept when it is long enough) */
    run(config: Config, options: RunOptions, simulate: () => BuildRun): BuildRun {
        // the logger writes about the run and changes nothing in it; the options that would are all in the key
        const { logger, debug, debug_steps, ...read } = options;
        const key = canonicalKey([config, read]);
        const kept = key === null ? undefined : this.kept.get(key);
        if (kept !== undefined) {
            this.hits++;
            return handedOut(kept);
        }
        const run = simulate();
        if (key !== null && run.ticks_simulated >= this.min_ticks) {
            this.kept.set(key, handedOut(run));
        }
        return run;
    }
}

/**
 * A run for one caller to take. What a clock's check writes into its run, the stability check, is a copy of its own,
 * so that no caller finds what another wrote; the rest of a run is only read.
 */
function handedOut(run: BuildRun): BuildRun {
    return { ...run, stability_check: { ...run.stability_check } };
}

let open: RunMemo | undefined;

/** The memo of the generation that is running, if one is */
export function currentRunMemo(): RunMemo | undefined {
    return open;
}

/**
 * Runs a generation with a memo of its runs, which is gone when it ends, however it ends. A generation inside one that
 * is already running shares its memo. The generation has to be synchronous: the memo is closed when `generate` returns.
 */
export function withRunMemo<T>(generate: () => T, min_ticks?: number): T {
    if (open !== undefined) {
        return generate();
    }
    open = new RunMemo(min_ticks);
    try {
        return generate();
    } finally {
        open = undefined;
    }
}
