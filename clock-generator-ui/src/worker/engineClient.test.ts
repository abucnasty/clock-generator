import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './types';

/** Stands in for the query worker: it answers 'initialize' when told to, and never answers a query */
class FakeWorker {
    static last: FakeWorker;
    static startsUp = true;
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    onerror: ((event: { message?: string }) => void) | null = null;
    requests: WorkerRequest[] = [];
    terminated = false;

    constructor() {
        FakeWorker.last = this;
    }

    postMessage(request: WorkerRequest) {
        this.requests.push(request);
        if (request.type === 'initialize' && FakeWorker.startsUp) {
            queueMicrotask(() => this.onmessage?.({ data: { type: 'initialized' } }));
        }
    }

    terminate() {
        this.terminated = true;
    }

    crash(message?: string) {
        this.onerror?.({ message });
    }
}

async function freshEngineClient() {
    vi.resetModules();
    return import('./engineClient');
}

/** Lets the worker get the data, start up and receive the query */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    FakeWorker.startsUp = true;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('askEngine', () => {
    it('fails the queries waiting for an answer when the worker crashes after it started', async () => {
        const { askEngine } = await freshEngineClient();
        const answer = askEngine({ kind: 'lookups' });
        await settle();
        expect(FakeWorker.last.requests.map((request) => request.type)).toEqual(['initialize', 'query']);

        FakeWorker.last.crash('out of memory');
        await expect(answer).rejects.toThrow('out of memory');
        expect(FakeWorker.last.terminated).toBe(true);

        // and the next query starts a new worker
        const crashed = FakeWorker.last;
        void askEngine({ kind: 'lookups' });
        await settle();
        expect(FakeWorker.last).not.toBe(crashed);
    });

    it('fails when the worker cannot start', async () => {
        FakeWorker.startsUp = false;
        const { askEngine } = await freshEngineClient();
        const answer = askEngine({ kind: 'lookups' });
        await settle();
        FakeWorker.last.crash();
        await expect(answer).rejects.toThrow('Engine worker failed');
    });

    it('fails when the game data cannot be fetched', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
        const { askEngine } = await freshEngineClient();
        await expect(askEngine({ kind: 'lookups' })).rejects.toThrow('HTTP 404');
    });
});
