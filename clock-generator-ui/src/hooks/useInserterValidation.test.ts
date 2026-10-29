// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { LiveCoverage } from '../worker/types';
import { useInserterValidation } from './useInserterValidation';

const askEngine = vi.hoisted(() => vi.fn());
vi.mock('../worker/engineClient', () => ({ askEngine }));

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
const refused: LiveCoverage = { issues: [], refusal: 'Inserter 2: `filter_mode` "blacklist" is refused', pickupNotTested: null, laneSharedByCopies: null, sideLoadedDrop: null, lanesExactlyFull: null, copyGapNeeded: null, dropRoom: null, machinePrototypes: [] };
const targeting = { ...blacklisting(), machines: [{ ...blacklisting().machines[0], result_target: { type: 'machine', id: 8 } as const }] } as Config;
const wagon = { ...blacklisting(), chests: [{ id: 1, type: 'cargo-wagon', quality: 'normal' }] } as unknown as Config;
const retarget = (target: Config['machines'][number]['result_target']) => (config: Config) => ({ ...config, machines: [{ ...config.machines[0], result_target: target }] });

/** Renders the hook and lets its debounced engine question go out */
function render(config: Config) {
    const view = renderHook(({ config }) => useInserterValidation(config, true), { initialProps: { config } });
    act(() => { vi.advanceTimersByTime(200); });
    return view;
}

beforeEach(() => { vi.useFakeTimers(); askEngine.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('the live connection check', () => {
    it('hands on the refusal of an inserter that is out of scope with its coverage', async () => {
        askEngine.mockResolvedValue(refused);
        const { result, rerender } = render(blacklisting());
        expect(result.current).toBeNull();
        expect(askEngine).toHaveBeenCalledExactlyOnceWith({ kind: 'inserter-coverage', config: blacklisting() });
        await act(() => vi.runAllTimersAsync());
        rerender({ config: blacklisting() });
        expect(result.current).toEqual(refused);
    });

    it.each([
        { change: 'the filter mode', from: blacklisting(), edit: () => blacklisting({ filter_mode: undefined }) },
        { change: 'the inserter kind', from: blacklisting(), edit: () => blacklisting({ prototype: 'fast-inserter' }) },
        { change: 'the quality', from: blacklisting(), edit: () => blacklisting({ quality: 'rare' }) },
        { change: 'the hand', from: blacklisting(), edit: () => blacklisting({ stack_size: 8 }) },
        { change: 'a lane stack size', from: blacklisting(), edit: (config: Config) => ({ ...config, belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 2 }] }] }) },
        { change: 'a direct target being selected', from: blacklisting(), edit: retarget({ type: 'machine', id: 8 }) },
        { change: 'a direct target being cleared', from: targeting, edit: retarget(undefined) },
        { change: 'the direct target kind and ID', from: targeting, edit: retarget({ type: 'chest', id: 9 }) },
        { change: 'a cargo wagon quality', from: wagon, edit: (config: Config) => ({ ...config, chests: [{ ...config.chests![0], quality: 'legendary' }] }) },
        // and so what a lane is asked for against what it carries
        { change: 'the belt type', from: blacklisting(), edit: (config: Config) => ({ ...config, belts: [{ ...config.belts[0], type: 'transport-belt' }] }) },
        { change: 'the target rate', from: blacklisting(), edit: (config: Config) => ({ ...config, target_output: { ...config.target_output, items_per_second: 2 } }) },
        { change: 'the copies', from: blacklisting(), edit: (config: Config) => ({ ...config, target_output: { ...config.target_output, copies: 3 } }) },
        { change: 'the productivity', from: blacklisting(), edit: (config: Config) => ({ ...config, machines: [{ ...config.machines[0], productivity: 50 }] }) },
    ])('shows no result checked before $change changed, and checks again', async ({ from, edit }) => {
        askEngine.mockResolvedValue(refused);
        const { result, rerender } = render(from);
        await act(() => vi.runAllTimersAsync());
        expect(result.current).toEqual(refused);

        // the new answer never comes: what is shown meanwhile is under test
        askEngine.mockReturnValue(new Promise(() => {}));
        const edited = edit(from) as Config;
        rerender({ config: edited });
        expect(result.current).toBeNull();
        act(() => { vi.advanceTimersByTime(200); });
        expect(askEngine).toHaveBeenLastCalledWith({ kind: 'inserter-coverage', config: edited });
    });
});
