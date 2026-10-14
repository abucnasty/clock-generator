/**
 * The main thread's way to the engine. The engine is bundled once, in the simulation worker: the main thread imports
 * only its types (and the constants of 'clock-generator/light'), and asks a worker of its own for everything else.
 */

import type { EngineAnswers, EngineQuery, WorkerRequest, WorkerResponse } from './types';

const FACTORIO_DATA_URL = '/data-filtered.json';

let factorioData: Promise<string> | null = null;

/** The text of the game data, fetched once and handed to every worker */
export function loadFactorioData(): Promise<string> {
    factorioData ??= fetch(FACTORIO_DATA_URL)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.text();
        })
        .catch((error) => {
            factorioData = null;
            throw new Error(`Failed to fetch the game data: ${error instanceof Error ? error.message : String(error)}`);
        });
    return factorioData;
}

export function createSimulationWorker(): Worker {
    return new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
}

interface QueryWorker {
    worker: Worker;
    ready: Promise<void>;
}

let queryWorker: QueryWorker | null = null;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (answer: unknown) => void; reject: (error: Error) => void }>();

/** The worker that answers the queries, started on the first one; it lives until it crashes */
function startQueryWorker(): QueryWorker {
    const worker = createSimulationWorker();
    const ready = new Promise<void>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const response = event.data;
            if (response.type === 'initialized') {
                resolve();
            } else if (response.type === 'error') {
                reject(new Error(response.message));
            } else if (response.type === 'answer' || response.type === 'query-failed') {
                const request = pending.get(response.requestId);
                pending.delete(response.requestId);
                if (response.type === 'answer') {
                    request?.resolve(response.answer);
                } else {
                    request?.reject(new Error(response.message));
                }
            }
        };
        worker.onerror = (event) => {
            const error = new Error(event.message || 'Engine worker failed');
            reject(error);
            // once it is ready, the queries it was answering are failed, and the next query starts a new worker
            for (const request of pending.values()) {
                request.reject(error);
            }
            pending.clear();
            worker.terminate();
            if (queryWorker?.worker === worker) {
                queryWorker = null;
            }
        };
        loadFactorioData().then(
            data => worker.postMessage({ type: 'initialize', factorioData: data } satisfies WorkerRequest),
            reject,
        );
    });
    ready.catch(() => {
        // the next query starts a new worker
        worker.terminate();
        queryWorker = null;
    });
    return { worker, ready };
}

/** Asks the engine, once its worker has the game data; rejects with the message of what the engine threw */
export async function askEngine<Q extends EngineQuery>(query: Q): Promise<EngineAnswers[Q['kind']]> {
    queryWorker ??= startQueryWorker();
    const { worker, ready } = queryWorker;
    await ready;
    const requestId = ++nextRequestId;
    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve: resolve as (answer: unknown) => void, reject });
        worker.postMessage({ type: 'query', requestId, query } satisfies WorkerRequest);
    });
}
