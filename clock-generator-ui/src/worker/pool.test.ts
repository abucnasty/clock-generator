import { describe, expect, it, vi } from 'vitest';
import { busyWorkersOf, replaceWorkers } from './pool';

const fakeWorker = (name: string) => ({ name, terminate: vi.fn() });

describe('busyWorkersOf', () => {
    const pool = [fakeWorker('a'), fakeWorker('b'), fakeWorker('c')];

    it('is the first worker while it plans', () => {
        expect(busyWorkersOf(pool, { running: [], planning: true, checking: false })).toEqual([pool[0]]);
    });

    it('is the workers running a task', () => {
        expect(busyWorkersOf(pool, { running: [pool[2], pool[1]], planning: false, checking: false })).toEqual([pool[1], pool[2]]);
    });

    it('includes the first worker while it checks', () => {
        expect(busyWorkersOf(pool, { running: [pool[2]], planning: false, checking: true })).toEqual([pool[0], pool[2]]);
    });

    it('is nothing when nothing runs', () => {
        expect(busyWorkersOf(pool, { running: new Map().keys(), planning: false, checking: false })).toEqual([]);
    });
});

describe('replaceWorkers', () => {
    it('terminates exactly the busy workers and starts one in each of their places', () => {
        const pool = [fakeWorker('a'), fakeWorker('b'), fakeWorker('c')];
        let started = 0;
        const start = vi.fn(() => fakeWorker(`new${++started}`));
        const next = replaceWorkers(pool, [pool[0], pool[2]], start);
        expect(pool[0].terminate).toHaveBeenCalledOnce();
        expect(pool[1].terminate).not.toHaveBeenCalled();
        expect(pool[2].terminate).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledTimes(2);
        expect(next.map((worker) => worker.name)).toEqual(['new1', 'b', 'new2']);
        expect(next[1]).toBe(pool[1]);
    });

    it('keeps the same workers when none is busy', () => {
        const pool = [fakeWorker('a'), fakeWorker('b')];
        const start = vi.fn(() => fakeWorker('new'));
        const next = replaceWorkers(pool, [], start);
        expect(next).toEqual(pool);
        expect(start).not.toHaveBeenCalled();
        pool.forEach((worker) => expect(worker.terminate).not.toHaveBeenCalled());
    });
});
