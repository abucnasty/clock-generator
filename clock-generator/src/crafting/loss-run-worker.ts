import "../data/factorio-data-file";
import { OpenRange } from "../data-types";
import type { LossRunRequest } from "./loss-run-pool";
import { serveSyncWorker } from "./sync-worker-pool";
import { lossRunOnBuild } from "./trial";

/** A worker thread of the loss runs of a disturbance trial (loss-run-pool.ts): makes the run of one loss at a time, as `disturbanceTrialOf` does */
const logger = { log: () => { }, warn: () => { }, debug: () => { }, error: (message: string) => console.error(message) };
serveSyncWorker((request: LossRunRequest) => {
    const windows = new Map(Object.entries(request.windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    return lossRunOnBuild(request.config, windows, request.window_cycle_ticks, logger, request.swings, request.trial);
});
