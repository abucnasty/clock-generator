// A worker script for sync-worker-pool.generation.test.ts: answers a number with its double, and does what a request says otherwise
const { serveSyncWorker } = require("../../dist/crafting/sync-worker-pool");
serveSyncWorker(request => {
    if (request === "throw") throw new Error("this request fails");
    if (request === "exit") process.exit(3);
    if (request === "hang") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    return request * 2;
});
