import "../data/factorio-data-file";
import { OpenRange } from "../data-types";
import type { LossRunRequest } from "./loss-run-pool";
import { serveSyncWorker } from "./sync-worker-pool";
import { runClockOnBuild } from "./trial";

/** A worker thread of the disturbance trials (loss-run-pool.ts): makes one run of a loss at a time, as `disturbanceTrialOf` does */
const quiet = { log: () => { }, warn: () => { }, error: () => { }, debug: () => { }, info: () => { } };
serveSyncWorker((request: LossRunRequest) => {
    const windows = new Map(Object.entries(request.windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    return runClockOnBuild(request.config, windows, request.window_cycle_ticks, quiet, request.options).disturbance_trial!;
});
