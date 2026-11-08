/**
 * Worker threads answered synchronously (an experiment, prototype/book-parallel-strategies, then prototype/parallel-losses): the generation is synchronous,
 * so the generating thread waits on a shared counter (Atomics.wait) that a worker bumps after each answer, and reads the
 * answers with receiveMessageOnPort. Answers come back in the order of the requests, whatever order the workers finish in.
 * Null where worker threads are not there (a browser, or the TypeScript sources a test runs).
 */
export interface SyncWorkerPool<Request, Answer> {
    run(requests: Request[]): Answer[];
    readonly workers: number;
    close(): void;
}

export function syncWorkerPool<Request, Answer>(script_name: string, worker_data: unknown, count: number): SyncWorkerPool<Request, Answer> | null {
    if (count < 2 || typeof process === "undefined" || !process.versions?.node) return null;
    let threads: typeof import("node:worker_threads");
    let fs: typeof import("node:fs");
    let path: typeof import("node:path");
    try {
        /* eslint-disable @typescript-eslint/no-require-imports -- Node only, and not in a browser bundle */
        threads = require("node:worker_threads");
        fs = require("node:fs");
        path = require("node:path");
        /* eslint-enable @typescript-eslint/no-require-imports */
    } catch { return null; }
    const script = path.join(__dirname, script_name);
    if (!fs.existsSync(script)) return null;
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const pool = Array.from({ length: count }, () => {
        const channel = new threads.MessageChannel();
        const worker = new threads.Worker(script, { workerData: { data: worker_data, signal, port: channel.port2 }, transferList: [channel.port2] });
        worker.unref();
        return { worker, port: channel.port1 };
    });
    const run = (requests: Request[]): Answer[] => {
        const out = new Array<Answer>(requests.length);
        let next = 0, done = 0;
        const send = (w: number) => { if (next < requests.length) { pool[w].port.postMessage({ index: next, request: requests[next] }); next++; } };
        pool.forEach((_, w) => send(w));
        let seen = Atomics.load(signal, 0);
        while (done < requests.length) {
            let got = false;
            pool.forEach(({ port }, w) => {
                for (let message = threads.receiveMessageOnPort(port); message !== undefined; message = threads.receiveMessageOnPort(port)) {
                    const { index, answer, error } = message.message as { index: number; answer?: Answer; error?: string };
                    if (error !== undefined) throw new Error(`a worker of ${script_name} failed: ${error}`);
                    out[index] = answer!;
                    done++;
                    got = true;
                    send(w);
                }
            });
            if (!got && done < requests.length) {
                Atomics.wait(signal, 0, seen, 60_000);
                seen = Atomics.load(signal, 0);
            }
        }
        return out;
    };
    return { workers: count, run, close: () => pool.forEach(({ worker, port }) => { port.close(); void worker.terminate(); }) };
}

/** The worker side: answers each request with `answer`, and bumps the shared counter after it */
export function serveSyncWorker<Request, Answer>(answer: (request: Request) => Answer): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node only
    const { workerData } = require("node:worker_threads");
    const { signal, port } = workerData as { signal: Int32Array; port: import("node:worker_threads").MessagePort };
    port.on("message", ({ index, request }: { index: number; request: Request }) => {
        try {
            port.postMessage({ index, answer: answer(request) });
        } catch (error) {
            port.postMessage({ index, error: String((error as Error)?.stack ?? error) });
        }
        Atomics.add(signal, 0, 1);
        Atomics.notify(signal, 0);
    });
}

/** The worker count asked for by an environment variable, else the cores less one, at most `cap` */
export function workerCount(variable: string, cap: number = 8): number {
    if (typeof process === "undefined") return 0;
    const asked = process.env?.[variable];
    if (asked !== undefined) return Number(asked);
    let cores = 1;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node only
    try { cores = require("node:os").cpus().length; } catch { /* not Node */ }
    return Math.min(cap, cores - 1);
}
