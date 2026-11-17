/**
 * Worker threads that answer a thread which cannot wait for messages. The generation is synchronous, so the thread that
 * generates waits on a shared counter (`Atomics.wait`) that a worker bumps after each answer, and reads the answers with
 * `receiveMessageOnPort`. The answers come back in the order of the requests, whatever order the workers finish in.
 *
 * Node only. The pool reaches the Node modules through `process.getBuiltinModule`, so that no bundle of the web app
 * has an import of them: where there is no `process` (a browser, a web worker) there are no worker threads, and the
 * caller runs its requests itself.
 */

/**
 * A failure of the worker threads themselves (a worker that stopped, a wait that ran out, a script that is not there, a switch
 * that is not a number), not of a run in one: the generation does not take it for a trial it could not make
 */
export class WorkerThreadsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WorkerThreadsError";
    }
}

/** What a worker made of one request: the answer, or the error it threw (as text, with its stack) */
export type WorkerResult<Answer> = { answer: Answer } | { error: string };

export interface SyncWorkerPool<Request, Answer> {
    readonly workers: number;
    /** How many requests the workers have answered since the pool was made */
    readonly runs_made: number;
    /** False once a failure of the pool itself (a worker that stopped, a wait that ran out) has closed it */
    readonly open: boolean;
    /**
     * Makes every request on the workers, and gives their results in the order of the requests. A request that throws in a worker is
     * a result with an error, so that the caller decides whether it matters. A worker that stops, or no answer from any of them for
     * `stall_ms`, throws here, closes the pool and ends every worker: no run of it is left going.
     */
    run(requests: readonly Request[]): WorkerResult<Answer>[];
    close(): void;
}

export interface SyncWorkerPoolOptions {
    /** The longest the pool waits with no answer from any worker, in ms (a worker that died without a word leaves no other sign) */
    stall_ms?: number;
}

/** Ten minutes: a run of the generator takes seconds, the slowest of the sample builds under a minute */
export const DEFAULT_STALL_MS = 600_000;

type Threads = typeof import("node:worker_threads");

/** Node's `worker_threads`, or null where this is not Node (no bundler sees this: it is no import) */
function nodeThreads(): Threads | null {
    if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") return null;
    return process.getBuiltinModule("node:worker_threads") ?? null;
}

/** Whether this runs where worker threads exist */
export function workerThreadsExist(): boolean {
    return nodeThreads() !== null;
}

/**
 * `count` worker threads that each run `script` (an absolute path of a file that calls `serveSyncWorker`). Null where worker
 * threads are not there. Throws when they are but `script` is not a file: asking for workers and getting none would hide a
 * missing build as a run that is simply serial.
 */
export function syncWorkerPool<Request, Answer>(script: string, count: number, options: SyncWorkerPoolOptions = {}): SyncWorkerPool<Request, Answer> | null {
    const threads = nodeThreads();
    if (threads === null || count < 1) return null;
    const fs = process.getBuiltinModule("node:fs")!;
    if (!fs.existsSync(script)) throw new WorkerThreadsError(`The worker threads asked for have no script to run: ${script} is not a file (is the generator built?)`);
    const stall_ms = options.stall_ms ?? DEFAULT_STALL_MS;
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const pool = Array.from({ length: count }, () => {
        const channel = new threads.MessageChannel();
        const worker = new threads.Worker(script, { workerData: { signal, port: channel.port2 }, transferList: [channel.port2] });
        // an error of the worker that the generating thread is not waiting for is read as a message (below); this keeps it from ending the process
        worker.on("error", () => { });
        worker.unref();
        return { worker, port: channel.port1 };
    });
    let open = true;
    let runs_made = 0;
    const close = () => {
        open = false;
        pool.forEach(({ worker, port }) => { port.close(); void worker.terminate(); });
    };
    const run = (requests: readonly Request[]): WorkerResult<Answer>[] => {
        if (!open) throw new WorkerThreadsError(`The worker threads of ${script} were closed by an earlier failure`);
        const results = new Array<WorkerResult<Answer>>(requests.length);
        let next = 0, done = 0;
        const send = (w: number) => {
            if (next < requests.length) {
                pool[w].port.postMessage({ index: next, request: requests[next] });
                next++;
            }
        };
        try {
            pool.forEach((_, w) => send(w));
            let seen = Atomics.load(signal, 0);
            let last_answer = Date.now();
            while (done < requests.length) {
                let got = false;
                pool.forEach(({ port }, w) => {
                    for (let message = threads.receiveMessageOnPort(port); message !== undefined; message = threads.receiveMessageOnPort(port)) {
                        const { index, answer, error, fatal } = message.message as { index?: number; answer?: Answer; error?: string; fatal?: string };
                        if (fatal !== undefined) throw new WorkerThreadsError(`A worker thread of ${script} stopped: ${fatal}`);
                        results[index!] = error !== undefined ? { error } : { answer: answer! };
                        done++;
                        got = true;
                        send(w);
                    }
                });
                if (got) last_answer = Date.now();
                else if (done < requests.length) {
                    const waited = Date.now() - last_answer;
                    if (waited >= stall_ms) {
                        throw new WorkerThreadsError(`No worker thread of ${script} answered in ${(waited / 1000).toFixed(1)} s: ${requests.length - done} of ${requests.length} runs are not made `
                            + "(a worker may have died without a word)");
                    }
                    Atomics.wait(signal, 0, seen, Math.min(1000, stall_ms - waited));
                    seen = Atomics.load(signal, 0);
                }
            }
            runs_made += requests.length;
            return results;
        } catch (error) {
            close();
            throw error instanceof WorkerThreadsError ? error : new WorkerThreadsError(`The worker threads of ${script} could not be given their runs: ${(error as Error)?.message ?? error}`);
        }
    };
    return { workers: count, run, close, get open() { return open; }, get runs_made() { return runs_made; } };
}

/** The worker side: answers each request with `answer`, and bumps the shared counter after it */
export function serveSyncWorker<Request, Answer>(answer: (request: Request) => Answer): void {
    const threads = nodeThreads();
    if (threads === null) throw new Error("serveSyncWorker runs in a worker thread of Node");
    const { signal, port } = threads.workerData as { signal: Int32Array; port: import("node:worker_threads").MessagePort };
    const tell = (message: unknown) => {
        port.postMessage(message);
        Atomics.add(signal, 0, 1);
        Atomics.notify(signal, 0);
    };
    // a worker that stops in any other way than an error of a request would leave the generating thread waiting: say so, as its last act
    process.on("uncaughtException", error => tell({ fatal: String(error?.stack ?? error) }));
    process.on("exit", code => tell({ fatal: `it exited with code ${code}` }));
    port.on("message", ({ index, request }: { index: number; request: Request }) => {
        try {
            tell({ index, answer: answer(request) });
        } catch (error) {
            tell({ index, error: String((error as Error)?.stack ?? error) });
        }
    });
}
