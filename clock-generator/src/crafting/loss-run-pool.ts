import type { Config } from "../config";
import type { DisturbanceTrialOptions, LossOutcome } from "./disturbance-trial";
import type { SerializableClockWindows } from "./clock";
import type { FractionalSwings } from "./plan/unclocked-run";
import { syncWorkerPool, WorkerThreadsError, type SyncWorkerPool } from "./sync-worker-pool";

/** The environment variable that sends the loss runs of a disturbance trial to worker threads: how many, 0 or unset for none */
export const LOSS_WORKERS_VARIABLE = "CLOCK_LOSS_WORKERS";

/** One run of a loss of a disturbance trial (`disturbanceTrialOf`), as plain data a worker thread can take */
export interface LossRunRequest {
    /** The config the runs are made on (the one the trial checks: its windows are not derived) */
    config: Config;
    windows: SerializableClockWindows;
    window_cycle_ticks: number;
    swings: FractionalSwings;
    /** The options of the loss, `loss` among them */
    trial: DisturbanceTrialOptions;
}

/** How many worker threads the environment asks for; 0 where it asks for none or there is no environment (a browser) */
export function lossWorkersAsked(): number {
    if (typeof process === "undefined") return 0;
    const asked = process.env?.[LOSS_WORKERS_VARIABLE];
    if (asked === undefined || asked === "") return 0;
    const count = Number(asked);
    if (!Number.isInteger(count) || count < 0) throw new WorkerThreadsError(`${LOSS_WORKERS_VARIABLE} is a whole number of 0 or more, not "${asked}"`);
    return count;
}

let pool: SyncWorkerPool<LossRunRequest, LossOutcome> | null = null;
let pool_count = 0;

/**
 * The worker threads the loss runs of a disturbance trial are made in, as many as `CLOCK_LOSS_WORKERS` asks, made on the first
 * trial and kept for the process. Null when it asks for none, and where worker threads are not there (a browser, a web
 * worker): the trial then makes its runs itself, as it always did. Throws where they are there and the built script is not
 * (the TypeScript sources run as they are), so that a switch that is on never does nothing without a word.
 */
export function lossRunPool(): SyncWorkerPool<LossRunRequest, LossOutcome> | null {
    const count = lossWorkersAsked();
    if (count === 0) {
        pool?.close();
        pool = null;
        return null;
    }
    if (pool !== null && pool.open && pool_count === count) return pool;
    pool?.close();
    // __dirname is the folder of the built file: the script is built beside this module
    pool = syncWorkerPool<LossRunRequest, LossOutcome>(`${__dirname}/loss-run-worker.js`, count);
    pool_count = count;
    return pool;
}
