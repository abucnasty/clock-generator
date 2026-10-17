import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { afterEach, expect, it, vi } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { WorkerRequest, WorkerResponse } from './types';

afterEach(() => { vi.unstubAllGlobals(); });

it('uses the real engine for typed Check/generation recovery and recomputed conversion, separating planning refusal from query failure', async () => {
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    const send = async (data: WorkerRequest) => { await port.onmessage!({ data }); return posted.at(-1)!; };
    await send({ type: 'initialize', factorioData });
    expect(posted.at(-1)?.type).toBe('initialized');
    const source: Config = {
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 4, copies: 0.5 },
        machines: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 })),
        inserters: Array.from({ length: 8 }, (_, i) => [
            { id: 2 * i + 1, source: { type: 'belt' as const, id: 1 }, sink: { type: 'machine' as const, id: i + 1 }, stack_size: 1, filters: ['iron-plate'] },
            { id: 2 * i + 2, source: { type: 'machine' as const, id: i + 1 }, sink: { type: 'belt' as const, id: 2 }, stack_size: 1, filters: ['iron-gear-wheel'] },
        ]).flat(),
        belts: [
            { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] },
            { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
        ], chests: [],
    } as Config;
    const before = structuredClone(source);
    const checked = await send({ type: 'validate', requestId: 1, config: source });
    expect(checked).toMatchObject({ type: 'validation-failed', recovery: { kind: 'repeated-units', sourceConfigKey: JSON.stringify(source),
        detectedCopies: 8, configuredCopies: 0.5, conversion: { kind: 'available', multiplicity: 8, copies: 4 } } });
    const planned = await send({ type: 'plan', runId: 1, config: source, debugSteps: { prepare: false, warm_up: false, simulate: false }, streamLogs: false });
    expect(planned).toMatchObject({ type: 'error', runId: 1, recovery: { conversion: { kind: 'available', copies: 4 } } });
    const answer = await send({ type: 'query', requestId: 2, query: { kind: 'repeated-unit-conversion', config: source } });
    expect(answer).toMatchObject({ type: 'answer', answer: { kind: 'available', plan: { copies: 4, candidate: { machines: [source.machines[0]], target_output: { ...source.target_output, copies: 4 } } } } });
    const excessive = { ...source, target_output: { ...source.target_output, items_per_second: 100 } };
    const refused = await send({ type: 'query', requestId: 3, query: { kind: 'repeated-unit-conversion', config: excessive } });
    expect(refused).toMatchObject({ type: 'answer', answer: { kind: 'unavailable', stage: 'check', reason: { code: 'candidate-check-failed', message: expect.stringContaining('cannot meet the target') } } });
    const unsupported = structuredClone(source);
    unsupported.inserters.filter((_, i) => i % 2 === 1).forEach(ins => { ins.sink = { type: 'belt', id: 2, drop: { lane: 1, position: 0 } }; });
    expect(await send({ type: 'query', requestId: 4, query: { kind: 'repeated-unit-conversion', config: unsupported } }))
        .toMatchObject({ type: 'answer', answer: { kind: 'unavailable', stage: 'proof', reason: { code: 'unsupported-boundary' } } });
    // The engine uses untyped errors for an unknown recipe; the worker must not misdiagnose one as a proved candidate refusal.
    const unknown = structuredClone(source);
    unknown.machines.forEach(machine => { machine.recipe = 'not-a-real-recipe'; });
    expect(await send({ type: 'query', requestId: 5, query: { kind: 'repeated-unit-conversion', config: unknown } }))
        .toMatchObject({ type: 'query-failed', message: expect.stringContaining('not-a-real-recipe') });
    const invalidPrototype = structuredClone(source);
    invalidPrototype.inserters.forEach(inserter => { inserter.prototype = 'not-an-inserter'; });
    const recoveryFailed = await send({ type: 'validate', requestId: 6, config: invalidPrototype });
    expect(recoveryFailed).toMatchObject({ type: 'validation-failed', requestId: 6, message: expect.stringContaining('not-an-inserter') });
    expect('recovery' in recoveryFailed && recoveryFailed.recovery).toBeUndefined();
    expect(source).toEqual(before);
    const emptyOutput = { ...source, machines: [source.machines[0]], inserters: [source.inserters[0], { ...source.inserters[1], sink: { type: 'chest' as const, id: 7 } }],
        chests: [{ id: 7, type: 'infinity-chest' as const, item_filter: [] }] };
    expect(await send({ type: 'validate', requestId: 7, config: emptyOutput })).toMatchObject({ type: 'validation-failed',
        diagnostics: [{ kind: 'field', path: ['chests', 0, 'item_filter'], message: expect.stringContaining('Remove unfiltered items') }] });
    expect(await send({ type: 'validate', requestId: 8, config: { ...source, inserters: [] } })).toMatchObject({ type: 'validation-failed',
        diagnostics: expect.arrayContaining([{ kind: 'coverage', issue: expect.objectContaining({ kind: 'missing_output_inserter' }) }]) });
});

it('replays detailed activity through the real worker query without changing the saved config', async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    await port.onmessage!({ data: { type: 'initialize', factorioData } });
    const config = {
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 1 },
            { source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 1 },
        ], belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1 }] }],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [{ item_name: 'iron-gear-wheel', request_count: 1 }] }],
    } as Config;
    const before = JSON.stringify(config);
    await port.onmessage!({ data: { type: 'query', requestId: 40, query: { kind: 'timeline-recording', request: { config, mode: 'plan', period_ticks: 240, terminal_swing_count: 1, windows: {} } } } });
    expect(posted.at(-1)).toMatchObject({ type: 'answer', requestId: 40, answer: { mode: 'plan', start_tick: 0, end_tick: 240, entities: expect.arrayContaining([expect.objectContaining({ id: 'machine:1', recipe: 'iron-gear-wheel' })]) } });
    expect(JSON.stringify(config)).toBe(before);
});
