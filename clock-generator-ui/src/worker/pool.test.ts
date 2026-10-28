import { describe, expect, it, vi } from 'vitest';
import { busyWorkersOf, checkToResend, crashOutcome, replaceWorkers } from './pool';

const fakeWorker = (name: string) => ({ name, terminate: vi.fn() });
const workers = (...names: string[]) => names.map((name) => fakeWorker(name));

describe('busyWorkersOf', () => {
    const pool = workers('a', 'b', 'c');
    const [a, b, c] = pool;

    // what it is, the state of the pool, and the busy workers
    it.each([
        ['is the first worker while it plans', { running: [], planning: true, checking: false }, [a]],
        ['is the workers running a task, in the pool\'s order', { running: [c, b], planning: false, checking: false }, [b, c]],
        ['includes the first worker while it checks', { running: [c], planning: false, checking: true }, [a, c]],
        ['is nothing when nothing runs, of any iterable', { running: new Map().keys(), planning: false, checking: false }, []],
    ])('%s', (_, state, busy) => {
        expect(busyWorkersOf(pool, state)).toEqual(busy);
    });
});

describe('replaceWorkers', () => {
    it('terminates exactly the busy workers and starts one in each of their places', () => {
        const pool = workers('a', 'b', 'c');
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
        const pool = workers('a', 'b');
        const start = vi.fn(() => fakeWorker('new'));
        const next = replaceWorkers(pool, [], start);
        expect(next).toEqual(pool);
        expect(start).not.toHaveBeenCalled();
        pool.forEach((worker) => expect(worker.terminate).not.toHaveBeenCalled());
    });
});

describe('checkToResend', () => {
    const [a, b, c] = workers('a', 'b', 'c');
    const check = { requestId: 4, config: {} };

    // what it sends, the pool that followed [a, b], the check waiting, and the check sent again
    it.each([
        ['sends a waiting check again when the first worker was replaced (a Cancel or an error during a generation)', [c, b], check, check],
        ['sends nothing when the first worker stayed', [a, c], check, null],
        ['sends nothing when no check waits', [c, b], null, null],
    ])('%s', (_, after, waiting, resent) => {
        expect(checkToResend([a, b], after, waiting)).toBe(resent);
    });
});

describe('crashOutcome', () => {
    const base = { started: true, isCheckWorker: true, checkRunning: true, runOnScreen: false };

    // what it ends, how the crash differs from `base`, and the outcome
    it.each([
        ['ends a check waiting on the worker that stopped, and replaces it', {}, { settleCheck: true, endRun: false, replace: true }],
        ['ends the check also when the worker stopped while it was still loading the data, without starting another', { started: false },
            { settleCheck: true, endRun: false, replace: false }],
        ['ends the generation on screen whichever worker stopped', { isCheckWorker: false, checkRunning: false, runOnScreen: true },
            { settleCheck: false, endRun: true, replace: true }],
        ['leaves a check on another worker alone', { isCheckWorker: false }, { settleCheck: false, endRun: false, replace: true }],
    ])('%s', (_, changes, outcome) => {
        expect(crashOutcome({ ...base, ...changes })).toEqual(outcome);
    });
});
