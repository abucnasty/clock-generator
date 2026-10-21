import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { afterEach, expect, it, vi } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { LiveCoverage, PastedEntities, WorkerRequest, WorkerResponse } from './types';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';
import { applyPaste } from '../utils/pastePreview';
import { buildValidationIssues } from '../utils/buildValidation';

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

it('keeps a captured inserter kind, quality and filter mode through paste, save and reload, and Check refuses what is out of scope', async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    const send = async (data: WorkerRequest) => { await port.onmessage!({ data }); return posted.at(-1)!; };
    await send({ type: 'initialize', factorioData });
    // A Sidecar 0.11.0 export: a legendary stack inserter picks up from a straight belt, a normal fast inserter empties the machine
    const pickup = { type: 'belt', id: 1, near_lane: 1, pickup_length: 1, pickup_layout: 'side-straight', pickup_capture: { status: 'supported',
        entity_type: 'transport-belt', entity_name: 'turbo-transport-belt', sidecar_version: '0.11.0', model: 'belt', model_version: 2 } };
    const exported = (output: object, input: object = {}) => ({
        kind: 'pasted-entities' as const, sidecar_version: '0.11.0', suggested_target: undefined, drills: [],
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, type: 'machine' }],
        inserters: [
            { source: pickup, sink: { type: 'machine', id: 1 }, prototype: 'stack-inserter', quality: 'legendary', stack_size: 16, ...input },
            { source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, prototype: 'fast-inserter', quality: 'normal', stack_size: 4, ...output },
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }],
        chests: [{ id: 1, type: 'infinity-chest', remove_unfiltered_items: true }],
    });
    /** Paste into a new build, save it and reload it the way the page does */
    const pastedSavedReloaded = async (query: ReturnType<typeof exported>) => {
        const answer = await send({ type: 'query', requestId: 50, query });
        expect(answer).toMatchObject({ type: 'answer', answer: { guidance: { _tag: 'None' } } });
        const pasted = (answer as { answer: PastedEntities }).answer;
        const form = applyPaste(createDefaultConfig(), pasted, { target: false, machines: true, drills: true, inserters: true, belts: true, chests: true });
        const saved = readSavedConfig(serializeConfig(form))!;
        expect(await send({ type: 'query', requestId: 51, query: { kind: 'saved-config', config: formDataToConfig(saved) } })).toMatchObject({ answer: null });
        const reloaded = configToFormData(formDataToConfig(saved));
        return { ...formDataToConfig(reloaded), target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 } } as Config;
    };

    /**
     * What the App lists for the build as the editor checks it live, before any Check: the 'inserter-coverage' query
     * useInserterValidation asks, folded into the issues that block Generate
     */
    const liveIssues = async (config: Config) => {
        const answer = await send({ type: 'query', requestId: 55, query: { kind: 'inserter-coverage', config } });
        expect(answer.type).toBe('answer');
        const coverage = (answer as { answer: LiveCoverage }).answer;
        return buildValidationIssues({ fieldProblems: [], coverage: coverage.issues, scopeRefusal: coverage.refusal, chests: [], inserters: [],
            machines: config.machines, chestIssues: [], coverageText: issue => `${issue.kind} ${issue.item_name}` })
            .filter(issue => issue.blocksGeneration).map(({ source, text }) => ({ source, text }));
    };

    const supported = await pastedSavedReloaded(exported({}));
    expect(supported.inserters.map(({ prototype, quality }) => ({ prototype, quality })))
        .toEqual([{ prototype: 'stack-inserter', quality: 'legendary' }, { prototype: 'fast-inserter', quality: 'normal' }]);
    expect(await liveIssues(supported)).toEqual([]);
    expect(await send({ type: 'validate', requestId: 52, config: supported })).toMatchObject({ type: 'validated' });

    const longHanded = await pastedSavedReloaded(exported({}, { prototype: 'long-handed-inserter', quality: 'normal', stack_size: 4 }));
    expect(longHanded.inserters[0]).toMatchObject({ prototype: 'long-handed-inserter', quality: 'normal' });
    const longHandedRefusal = 'Inserter 1: picking up from a belt with a normal long-handed-inserter is not supported yet';
    expect(await liveIssues(longHanded)).toEqual([{ source: 'engine', text: expect.stringContaining(longHandedRefusal) }]);
    expect(await send({ type: 'validate', requestId: 53, config: longHanded })).toMatchObject({ type: 'validation-failed',
        message: expect.stringContaining(longHandedRefusal) });

    // read as a whitelist, the blacklist would leave the gears without an output inserter and offer a new belt for them
    const blacklist = await pastedSavedReloaded(exported({ filters: ['iron-plate'], filter_mode: 'blacklist' }));
    expect(blacklist.inserters[1]).toMatchObject({ filters: ['iron-plate'], filter_mode: 'blacklist' });
    const blacklistRefusal = 'Inserter 2: `filter_mode` "blacklist" is refused';
    expect(await liveIssues(blacklist)).toEqual([{ source: 'engine', text: expect.stringContaining(blacklistRefusal) }]);
    const checked = await send({ type: 'validate', requestId: 54, config: blacklist });
    expect(checked).toMatchObject({ type: 'validation-failed', message: expect.stringContaining(blacklistRefusal) });
    // a Check that stopped at the same refusal adds no second issue for it
    const answer = await send({ type: 'query', requestId: 56, query: { kind: 'inserter-coverage', config: blacklist } });
    const coverage = (answer as { answer: LiveCoverage }).answer;
    expect(buildValidationIssues({ fieldProblems: [], coverage: coverage.issues, scopeRefusal: coverage.refusal, chests: [], inserters: [],
        machines: blacklist.machines, chestIssues: [], coverageText: () => '', failure: { message: (checked as { message: string }).message } }))
        .toHaveLength(1);
});

it('warns live of a belt pickup whose timing is not tested, as generation logs it, and Check and generation go on', async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    const send = async (data: WorkerRequest) => { await port.onmessage!({ data }); return posted.at(-1)!; };
    await send({ type: 'initialize', factorioData });
    /** A gear assembler fed by a legendary stack inserter with its full hand, from a belt of the given stack size */
    const gears = (stack_size: number) => ({
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'machine', id: 1 } },
            { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 } },
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size }] }],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
    } as Config);
    const live = async (config: Config) => {
        const answer = await send({ type: 'query', requestId: 60, query: { kind: 'inserter-coverage', config } });
        return (answer as { answer: LiveCoverage }).answer;
    };

    expect(await live(gears(4))).toEqual({ issues: [], refusal: null, pickupNotTested: null, laneSharedByCopies: null });
    const warning = 'Not tested: Inserter 1 picks up iron-plate from belt 1 in 2-item belt stacks. Belt pickup timing is calibrated '
        + 'with 16-item hands on 4-item belt stacks only; at other belt stack sizes and hand sizes it has not been compared with the '
        + 'game, so the clock may not match the game.';
    const untested = await live(gears(2));
    expect(untested).toEqual({ issues: [], refusal: null, pickupNotTested: warning, laneSharedByCopies: null });
    expect(buildValidationIssues({ fieldProblems: [], coverage: untested.issues, scopeRefusal: untested.refusal, pickupNotTested: untested.pickupNotTested,
        chests: [], inserters: [], machines: gears(2).machines, chestIssues: [], coverageText: () => '' })
        .map(({ source, severity, blocksGeneration, text }) => ({ source, severity, blocksGeneration, text })))
        .toEqual([{ source: 'calibration', severity: 'warning', blocksGeneration: false, text: warning }]);

    expect(await send({ type: 'validate', requestId: 61, config: gears(2) })).toMatchObject({ type: 'validated' });
    const planned = await send({ type: 'plan', runId: 3, config: gears(2), debugSteps: { prepare: false, warm_up: false, simulate: false }, streamLogs: true });
    expect(planned).toMatchObject({ type: 'primary-completed', runId: 3 });
    const { primary } = planned as Extract<WorkerResponse, { type: 'primary-completed' }>;
    expect(primary?.alternatives[0].insights.filter(insight => insight.id === 'belt-pickup-not-tested')).toHaveLength(1);
    const warned = posted.flatMap(response => response.type === 'log' ? response.messages : []).filter(message => message.level === 'warn');
    expect(warned.map(message => message.message)).toEqual([warning]);
});

it('warns live of a lane the copies would ask too much of if they shared it, as advice that does not block', async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    const send = async (data: WorkerRequest) => { await port.onmessage!({ data }); return posted.at(-1)!; };
    await send({ type: 'initialize', factorioData });
    // 100 copies of a gear assembler taking 1.5 iron plates a second off a lane that carries 120
    const config = {
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 75, copies: 100 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'machine', id: 1 } },
            { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 } },
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
    } as Config;
    const answer = await send({ type: 'query', requestId: 70, query: { kind: 'inserter-coverage', config } });
    const live = (answer as { answer: LiveCoverage }).answer;
    const warning = 'If the 100 copies share lane 1 of belt 1, they take 1.25 times what it carries (100 × 1.5 = 150 a second, of 120). '
        + 'The config cannot say yet whether its copies share these lanes, so this is only a warning: a build whose copies have '
        + 'belts of their own is not affected.';
    expect(live).toEqual({ issues: [], refusal: null, pickupNotTested: null, laneSharedByCopies: warning });
    expect(buildValidationIssues({ fieldProblems: [], coverage: live.issues, laneSharedByCopies: live.laneSharedByCopies,
        chests: [], inserters: [], machines: config.machines, chestIssues: [], coverageText: () => '' })
        .map(({ source, severity, blocksGeneration, text }) => ({ source, severity, blocksGeneration, text })))
        .toEqual([{ source: 'lanes', severity: 'warning', blocksGeneration: false, text: warning }]);
    expect(await send({ type: 'validate', requestId: 71, config })).toMatchObject({ type: 'validated' });
});
