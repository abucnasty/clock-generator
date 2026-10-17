import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializableMachineFacts } from 'clock-generator/browser';

const stub = vi.hoisted(() => ({
    askEngine: vi.fn(),
    effects: [] as (() => (() => void) | void)[],
    setState: vi.fn(),
}));
vi.mock('../worker/engineClient', () => ({ askEngine: stub.askEngine }));
// These tests mount independent consumers; React rendering is not part of the cache contract.
vi.mock('react', () => ({
    useEffect: (effect: () => (() => void) | void) => { stub.effects.push(effect); },
    useState: (initial: unknown) => [initial, stub.setState],
    useMemo: (create: () => unknown) => create(),
}));

const params = { recipe: 'iron-plate', crafting_speed: 1, productivity: 0 };
const facts: SerializableMachineFacts = {
    ...params, type: 'furnace', output_item: 'iron-plate', output_per_craft: 1,
    output_rate_per_second: 2, output_block_size: 1, overload_multiplier: 1,
    ticks_per_craft: 30, ticks_per_bonus_craft: 0, insertion_duration_ticks: 1, inputs: [],
};
let hooks: typeof import('./useMachineFacts');

function deferred() {
    let resolve!: (value: SerializableMachineFacts | null) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<SerializableMachineFacts | null>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function mountFacts() {
    const result = hooks.useMachineFacts(params);
    const cleanup = stub.effects.pop()?.();
    return { result, cleanup };
}

function mountMax() {
    const result = hooks.useMachinesMax('iron-plate', [{ ...params, id: 1 }, { ...params, id: 2 }]);
    stub.effects.pop()?.();
    return result;
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

beforeEach(async () => {
    vi.resetModules();
    stub.askEngine.mockReset();
    stub.setState.mockReset();
    stub.effects = [];
    hooks = await import('./useMachineFacts');
});

describe('shared machine facts cache', () => {
    it('deduplicates pending work across machine facts and capacity consumers, then serves cached facts immediately', async () => {
        const pending = deferred();
        stub.askEngine.mockReturnValue(pending.promise);
        expect(mountFacts().result.updating).toBe(true);
        expect(mountMax()).toBeNull();
        expect(stub.askEngine).toHaveBeenCalledExactlyOnceWith({ kind: 'machine-facts', params });

        pending.resolve(facts);
        await settle();
        expect(mountFacts().result).toEqual({ facts, error: null, updating: false });
        expect(mountMax()).toEqual({ machineIds: [1, 2], perCopy: 4 });
        expect(stub.askEngine).toHaveBeenCalledOnce();
    });

    it('retries rejected work for the next consumer instead of caching failure', async () => {
        const pending = deferred();
        stub.askEngine.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(facts);
        mountFacts();
        mountFacts();
        expect(stub.askEngine).toHaveBeenCalledOnce();
        pending.reject(new Error('Worker unavailable'));
        await settle();
        expect(stub.setState).toHaveBeenCalledWith(expect.objectContaining({ facts: null, error: 'Worker unavailable' }));

        expect(mountFacts().result.updating).toBe(true);
        expect(stub.askEngine).toHaveBeenCalledTimes(2);
        await settle();
        expect(mountFacts().result).toEqual({ facts, error: null, updating: false });
        expect(stub.askEngine).toHaveBeenCalledTimes(2);
    });

    it.each([facts, null])('reuses an answer that arrives before a capacity consumer commits its effect', async answer => {
        const pending = deferred();
        stub.askEngine.mockReturnValue(pending.promise);
        mountFacts();
        expect(hooks.useMachinesMax('iron-plate', [{ ...params, id: 1 }])).toBeNull();
        const commitMax = stub.effects.pop()!;
        pending.resolve(answer);
        await settle();

        commitMax();
        await settle();
        expect(stub.askEngine).toHaveBeenCalledOnce();
        expect(mountMax()).toEqual(answer === null ? null : { machineIds: [1, 2], perCopy: 4 });
    });

    it('retains null as a completed answer without repeatedly asking the worker', async () => {
        stub.askEngine.mockResolvedValue(null);
        mountFacts();
        await settle();
        expect(mountFacts().result).toEqual({ facts: null, error: null, updating: false });
        expect(mountMax()).toBeNull();
        expect(stub.askEngine).toHaveBeenCalledOnce();
    });

    it('keeps facts for future consumers when the requesting consumer unmounts before resolution', async () => {
        const pending = deferred();
        stub.askEngine.mockReturnValue(pending.promise);
        mountFacts().cleanup?.();
        pending.resolve(facts);
        await settle();
        expect(stub.setState).not.toHaveBeenCalled();
        expect(mountFacts().result).toEqual({ facts, error: null, updating: false });
        expect(stub.askEngine).toHaveBeenCalledOnce();
    });
});
