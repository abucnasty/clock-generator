import type { Config } from "../config";
import type { SerializableClockWindows } from "./clock";
import type { LossOutcome } from "./disturbance-trial";
import type { ClockTrialOptions } from "./trial";
import { syncWorkerPool, type SyncWorkerPool } from "./sync-worker-pool";

/** One run of a loss of a disturbance trial (trial.ts `disturbanceTrialOf`), as plain data a worker thread can take */
export interface LossRunRequest {
    config: Config;
    windows: SerializableClockWindows;
    window_cycle_ticks: number;
    options: ClockTrialOptions;
}

let pool: SyncWorkerPool<LossRunRequest, LossOutcome> | null | undefined;

/**
 * The worker threads the runs of a disturbance trial are made in ahead of the trial (an experiment,
 * prototype/parallel-losses): as many as `BOOK_PARALLEL_LOSSES` asks, made once a process; null where it asks for
 * fewer than 2, and where worker threads are not there (see syncWorkerPool)
 */
export function lossRunPool(): SyncWorkerPool<LossRunRequest, LossOutcome> | null {
    if (pool === undefined) {
        const count = typeof process === "undefined" ? 0 : Number(process.env?.BOOK_PARALLEL_LOSSES ?? 0);
        pool = syncWorkerPool<LossRunRequest, LossOutcome>("loss-run-worker.js", null, count);
    }
    return pool;
}
