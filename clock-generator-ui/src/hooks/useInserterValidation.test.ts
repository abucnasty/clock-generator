import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { LiveCoverage } from '../worker/types';

const stub = vi.hoisted(() => ({
    askEngine: vi.fn(),
    effects: [] as (() => (() => void) | void)[],
    state: null as unknown,
    setState: vi.fn(),
}));
vi.mock('../worker/engineClient', () => ({ askEngine: stub.askEngine }));
// One render at a time: the state is what the test sets, the effects run when the test runs them.
vi.mock('react', () => ({
    useEffect: (effect: () => (() => void) | void) => { stub.effects.push(effect); },
    useState: () => [stub.state, stub.setState],
    useMemo: (create: () => unknown) => create(),
    useRef: (current: unknown) => ({ current }),
}));

let hooks: typeof import('./useInserterValidation');

/** A gear build whose output inserter's filters are a blacklist of iron plates, as Sidecar captures one */
const blacklisting = (fields: object = {}): Config => ({
    target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
    inserters: [
        { id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'machine', id: 1 } },
        { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, filters: ['iron-plate'], filter_mode: 'blacklist', ...fields },
    ],
    belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }],
    chests: [{ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
} as Config);
const refused: LiveCoverage = { issues: [], refusal: 'Inserter 2: `filter_mode` "blacklist" is refused' };

/** Renders the hook, runs its effects and lets the debounced engine question go out */
function render(config: Config) {
    stub.effects = [];
    const result = hooks.useInserterValidation(config, true);
    stub.effects.forEach(effect => effect());
    vi.advanceTimersByTime(200);
    return result;
}

beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    stub.askEngine.mockReset();
    stub.setState.mockReset();
    stub.state = null;
    hooks = await import('./useInserterValidation');
});
afterEach(() => { vi.useRealTimers(); });

describe('the live connection check', () => {
    it('hands on the refusal of an inserter that is out of scope with its coverage', async () => {
        stub.askEngine.mockResolvedValue(refused);
        expect(render(blacklisting())).toBeNull();
        expect(stub.askEngine).toHaveBeenCalledExactlyOnceWith({ kind: 'inserter-coverage', config: blacklisting() });
        await vi.runAllTimersAsync();
        const update = stub.setState.mock.calls[0][0] as (previous: unknown) => unknown;
        stub.state = update(null);
        expect(render(blacklisting())).toEqual(refused);
    });

    it.each([
        { change: 'the filter mode', fields: { filter_mode: undefined } },
        { change: 'the inserter kind', fields: { prototype: 'fast-inserter' } },
        { change: 'the quality', fields: { quality: 'rare' } },
    ])('shows no result checked before $change changed', async ({ fields }) => {
        stub.askEngine.mockResolvedValue(refused);
        render(blacklisting());
        await vi.runAllTimersAsync();
        stub.state = (stub.setState.mock.calls[0][0] as (previous: unknown) => unknown)(null);
        stub.askEngine.mockResolvedValue({ issues: [], refusal: null });
        expect(render(blacklisting(fields))).toBeNull();
        expect(stub.askEngine).toHaveBeenLastCalledWith({ kind: 'inserter-coverage', config: blacklisting(fields) });
    });
});
