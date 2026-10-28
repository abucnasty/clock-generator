// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import type { SerializableMachineFacts } from 'clock-generator/browser';

const askEngine = vi.hoisted(() => vi.fn());
vi.mock('../worker/engineClient', () => ({ askEngine }));

const params = { recipe: 'iron-plate', crafting_speed: 1, productivity: 0 };
const facts: SerializableMachineFacts = {
    ...params, type: 'furnace', output_item: 'iron-plate', output_per_craft: 1,
    output_rate_per_second: 2, output_block_size: 1, overload_multiplier: 1,
    ticks_per_craft: 30, ticks_per_bonus_craft: 0, insertion_duration_ticks: 1, inputs: [],
};
let hooks: typeof import('./useMachineFacts');

/** A worker answer the test delivers; the cache takes it in at once, so it can come between a render and its effect */
function deferred() {
    type Handlers = [(facts: SerializableMachineFacts | null) => unknown, (error: Error) => unknown];
    let deliver!: (settle: (...handlers: Handlers) => unknown) => void;
    const promise = { then: (...handlers: Handlers) => new Promise((resolve, reject) => {
        deliver = settle => { try { resolve(settle(...handlers)); } catch (error) { reject(error); } };
    }) };
    return { promise, resolve: (answer: SerializableMachineFacts | null) => deliver(yes => yes(answer)), reject: (error: Error) => deliver((_, no) => no(error)) };
}

const renderFacts = () => renderHook(() => hooks.useMachineFacts(params));
const renderMax = () => renderHook(() => hooks.useMachinesMax('iron-plate', [{ ...params, id: 1 }, { ...params, id: 2 }])).result.current;
const settle = () => act(() => new Promise(resolve => setTimeout(resolve)));

beforeEach(async () => {
    // the cache lives in the module: each test starts with an empty one
    vi.resetModules();
    askEngine.mockReset();
    hooks = await import('./useMachineFacts');
});

describe('shared machine facts cache', () => {
    it('deduplicates pending work across machine facts and capacity consumers, then serves cached facts immediately', async () => {
        const pending = deferred();
        askEngine.mockReturnValue(pending.promise);
        expect(renderFacts().result.current.updating).toBe(true);
        expect(renderMax()).toBeNull();
        expect(askEngine).toHaveBeenCalledExactlyOnceWith({ kind: 'machine-facts', params });

        pending.resolve(facts);
        await settle();
        expect(renderFacts().result.current).toEqual({ facts, error: null, updating: false });
        expect(renderMax()).toEqual({ machineIds: [1, 2], perCopy: 4 });
        expect(askEngine).toHaveBeenCalledOnce();
    });

    it('retries rejected work for the next consumer instead of caching failure', async () => {
        const pending = deferred();
        askEngine.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(facts);
        const first = renderFacts();
        renderFacts();
        expect(askEngine).toHaveBeenCalledOnce();
        pending.reject(new Error('Worker unavailable'));
        await settle();
        expect(first.result.current).toEqual({ facts: null, error: 'Worker unavailable', updating: false });

        expect(renderFacts().result.current.updating).toBe(true);
        expect(askEngine).toHaveBeenCalledTimes(2);
        await settle();
        expect(renderFacts().result.current).toEqual({ facts, error: null, updating: false });
        expect(askEngine).toHaveBeenCalledTimes(2);
    });

    it.each([facts, null])('reuses an answer that arrives before a capacity consumer commits its effect', async answer => {
        const pending = deferred();
        askEngine.mockReturnValue(pending.promise);
        renderFacts();
        const max = renderHook(() => {
            const value = hooks.useMachinesMax('iron-plate', [{ ...params, id: 1 }]);
            // layout effects run before the consumer's own effect
            useLayoutEffect(() => pending.resolve(answer), []);
            return value;
        });
        await settle();
        expect(askEngine).toHaveBeenCalledOnce();
        expect(max.result.current).toEqual(answer === null ? null : { machineIds: [1], perCopy: 2 });
        expect(renderMax()).toEqual(answer === null ? null : { machineIds: [1, 2], perCopy: 4 });
    });

    it('retains null as a completed answer without repeatedly asking the worker', async () => {
        askEngine.mockResolvedValue(null);
        renderFacts();
        await settle();
        expect(renderFacts().result.current).toEqual({ facts: null, error: null, updating: false });
        expect(renderMax()).toBeNull();
        expect(askEngine).toHaveBeenCalledOnce();
    });

    it('keeps facts for future consumers when the requesting consumer unmounts before resolution', async () => {
        const pending = deferred();
        askEngine.mockReturnValue(pending.promise);
        renderFacts().unmount();
        pending.resolve(facts);
        await settle();
        expect(renderFacts().result.current).toEqual({ facts, error: null, updating: false });
        expect(askEngine).toHaveBeenCalledOnce();
    });
});
