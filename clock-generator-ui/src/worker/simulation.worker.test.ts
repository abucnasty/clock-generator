import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import grenadeSample from '../../../clock-generator/resources/config-samples/real/owner/grenade/grenade.json?raw';
import militarySample from '../../../clock-generator/resources/config-samples/science/military-science/military-science-1-inserter.json?raw';
import { afterEach, expect, it, vi } from 'vitest';
import { LATEST_SIDECAR_VERSION, type Config } from 'clock-generator/browser';
import type { EngineAnswers, EngineQuery, LiveCoverage, PastedEntities, WorkerRequest, WorkerResponse } from './types';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';
import { applyPaste } from '../utils/pastePreview';
import { buildValidationIssues } from '../utils/buildValidation';

afterEach(() => { vi.unstubAllGlobals(); });

it.each(['blocked', 'markers'] as const)('keeps blocked container slots through Sidecar paste (%s), save/reload and engine validation', async spelling => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    const send = async (data: WorkerRequest) => { await port.onmessage!({ data }); return posted.at(-1)!; };
    await send({ type: 'initialize', factorioData });
    // Sidecar exports both game markers as blocked slots; an export of the 0.20.0 drafts named the marker as the item
    const slot_filters = [{ slot: 1, item: 'iron-plate' }, ...Array.from({ length: 79 }, (_, i) => spelling === 'blocked'
        ? { slot: i + 2, blocked: true } : { slot: i + 2, item: i % 2 ? 'no-item' : 'deconstruction-planner' })];
    const result = await send({ type: 'query', requestId: 200, query: {
        kind: 'pasted-entities', sidecar_version: LATEST_SIDECAR_VERSION, suggested_target: undefined, drills: [], belts: [],
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        chests: [
            { id: 1, type: 'car', slot_filters },
            { id: 2, type: 'infinity-chest', item_filter: [{ item_name: 'iron-plate', request_count: 200 }] },
            { id: 3, type: 'infinity-chest', remove_unfiltered_items: true },
        ],
        inserters: [
            { id: 1, source: { type: 'chest', id: 2 }, sink: { type: 'chest', id: 1 }, prototype: 'stack-inserter', quality: 'legendary' },
            { id: 2, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, prototype: 'stack-inserter', quality: 'legendary' },
            { id: 3, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 3 }, prototype: 'stack-inserter', quality: 'legendary' },
        ],
    } });
    expect(result.type).toBe('answer');
    const pasted = (result as { answer: PastedEntities }).answer;
    const form = applyPaste(createDefaultConfig(), pasted, { target: false, machines: true, drills: true, inserters: true, belts: true, chests: true });
    const config = formDataToConfig(readSavedConfig(serializeConfig(form))!);
    config.target_output = { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 };
    expect(config.chests![0]).toEqual({ id: 1, type: 'car',
        slot_filters: [{ slot: 1, item: 'iron-plate' }, ...Array.from({ length: 79 }, (_, i) => ({ slot: i + 2, blocked: true }))] });
    expect(await send({ type: 'validate', requestId: 201, config })).toMatchObject({ type: 'validated' });
});

it('uses the real engine for typed Check/generation recovery and recomputed conversion, separating planning refusal from query failure', async () => {
    vi.resetModules();
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
    expect(refused).toMatchObject({ type: 'answer', answer: { kind: 'unavailable', stage: 'check', repeatedGroups: 8, reason: { code: 'candidate-check-failed', message: expect.stringContaining('cannot meet the target') } } });
    const unsupported = structuredClone(source);
    unsupported.inserters.filter((_, i) => i % 2 === 1).forEach(ins => { ins.sink = { type: 'belt', id: 2, drop: { lane: 1, position: 0 } }; });
    expect(await send({ type: 'query', requestId: 4, query: { kind: 'repeated-unit-conversion', config: unsupported } }))
        .toMatchObject({ type: 'answer', answer: { kind: 'unavailable', stage: 'proof', repeatedGroups: 8, reason: { code: 'unsupported-boundary' } } });
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
    // An export of the current Sidecar (its pickups captured as 0.11.0 captures them): a legendary stack inserter picks up from a straight belt, a normal fast inserter empties the machine
    const pickup = { type: 'belt', id: 1, near_lane: 1, pickup_length: 1, pickup_layout: 'side-straight', pickup_capture: { status: 'supported',
        entity_type: 'transport-belt', entity_name: 'turbo-transport-belt', sidecar_version: '0.11.0', model: 'belt', model_version: 2 } };
    const exported = (output: object, input: object = {}) => ({
        kind: 'pasted-entities' as const, sidecar_version: LATEST_SIDECAR_VERSION, suggested_target: undefined, drills: [],
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
        expect(await send({ type: 'query', requestId: 51, query: { kind: 'saved-config', config: formDataToConfig(saved) } })).toMatchObject({ answer: { problem: null } });
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

    expect(await live(gears(4))).toEqual({ issues: [], refusal: null, pickupNotTested: null, laneSharedByCopies: null, sideLoadedDrop: null, lanesExactlyFull: null, copyGapNeeded: null, dropRoom: null, machinePrototypes: [] });
    const warning = 'Not tested: Inserter 1 picks up iron-plate from belt 1 in 2-item belt stacks. Belt pickup timing is calibrated '
        + 'with 16-item hands on 4-item belt stacks only; at other belt stack sizes and hand sizes it has not been compared with the '
        + 'game, so the clock may not match the game.';
    // a drop the Sidecar marked: the live answer carries the note as the log and the result say it, and blocks nothing
    const marked = { ...gears(4), inserters: [
        { id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'machine', id: 1 } },
        { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 2, drop_capture: { status: 'side-loaded', tiles: 3 } } },
    ], belts: [...gears(4).belts, { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 4 }] }] } as Config;
    expect((await live(marked)).sideLoadedDrop).toBe('Inserter 2 drops onto a 3 tile belt buffer that side-loads onto another belt. '
        + 'The clock may make less in the game than shown here, most of all when these inserters are switched on at the same time as others '
        + 'that drop onto the belt. Give each of these drops a belt of its own, or check the clock in the game.');
    const untested = await live(gears(2));
    expect(untested).toEqual({ issues: [], refusal: null, pickupNotTested: warning, laneSharedByCopies: null, sideLoadedDrop: null, lanesExactlyFull: null, copyGapNeeded: null, dropRoom: null, machinePrototypes: [] });
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
    expect(live).toEqual({ issues: [], refusal: null, pickupNotTested: null, laneSharedByCopies: warning, sideLoadedDrop: null, lanesExactlyFull: null, copyGapNeeded: null, dropRoom: null, machinePrototypes: [] });
    expect(buildValidationIssues({ fieldProblems: [], coverage: live.issues, laneSharedByCopies: live.laneSharedByCopies,
        chests: [], inserters: [], machines: config.machines, chestIssues: [], coverageText: () => '' })
        .map(({ source, severity, blocksGeneration, text }) => ({ source, severity, blocksGeneration, text })))
        .toEqual([{ source: 'lanes', severity: 'warning', blocksGeneration: false, text: warning }]);
    expect(await send({ type: 'validate', requestId: 71, config })).toMatchObject({ type: 'validated' });
});

it("gives the crafting machines, fills a prototype's rule on import and paste, and warns live of a machine that cannot make its recipe", async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    const send = async (data: WorkerRequest) => { await port.onmessage!({ data }); return posted.at(-1)!; };
    await send({ type: 'initialize', factorioData });
    const ask = async <K extends EngineQuery['kind']>(query: Extract<EngineQuery, { kind: K }>) =>
        ((await send({ type: 'query', requestId: 70, query })) as unknown as { answer: EngineAnswers[K] }).answer;

    const lookups = await ask({ kind: 'lookups' });
    expect(lookups.craftingMachines.machines.map(machine => machine.name)).toContain('cryogenic-plant');
    expect(lookups.craftingMachines.recipeCategories['lithium-plate']).toEqual(['smelting']);

    const furnace = { id: 1, recipe: 'iron-plate', crafting_speed: 2, productivity: 0, prototype: 'electric-furnace' };
    const config = {
        target_output: { recipe: 'iron-plate', items_per_second: 1, copies: 1 },
        machines: [furnace], inserters: [], belts: [],
    };
    // a former type is read as the machine, in a build file, a saved build and a paste from an older Sidecar
    const typed = { id: 1, recipe: 'iron-plate', crafting_speed: 2, productivity: 0, type: 'furnace' };
    expect((await ask({ kind: 'config-file', config: { ...config, machines: [typed] } })).machines[0]).toEqual(furnace);
    const saved = await ask({ kind: 'saved-config', config: { ...config, machines: [{ ...typed, _uuid: 'm' }, { ...furnace, id: 2, type: 'machine' }] } });
    expect(saved.problem).toBeNull();
    expect((saved.form as { machines: unknown[] }).machines).toEqual([{ ...furnace, _uuid: 'm', _prototype_source: 'recipe' }, { ...furnace, id: 2 }]);
    const pasted = await ask({ kind: 'pasted-entities', machines: [typed, { ...furnace, id: 2 }], drills: [], inserters: [], belts: [], chests: [] } as Extract<EngineQuery, { kind: 'pasted-entities' }>);
    expect(pasted.machines).toEqual([furnace, { ...furnace, id: 2 }]);
    expect(pasted.picked_machines).toEqual([1]);

    const live = await ask({ kind: 'inserter-coverage', config: { ...config, machines: [{ ...furnace, prototype: 'cryogenic-plant' }] } as Config });
    expect(live.machinePrototypes.map(issue => issue.kind)).toEqual(['recipe-not-made']);
    expect(buildValidationIssues({ fieldProblems: [], coverage: [], machinePrototypes: live.machinePrototypes, chests: [], inserters: [],
        machines: [{ id: 1 }], chestIssues: [], coverageText: () => '' })
        .map(({ source, severity, blocksGeneration, fieldTarget }) => ({ source, severity, blocksGeneration, fieldTarget })))
        .toEqual([{ source: 'machine', severity: 'warning', blocksGeneration: false, fieldTarget: { kind: 'machine-recipe', machineId: 1 } }]);
});

it('says live whether the copies\' drops fit at the gap given, for the period estimated from the settings', async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    const send = async (data: WorkerRequest) => { await port.onmessage!({ data }); return posted.at(-1)!; };
    await send({ type: 'initialize', factorioData });
    const live = async (copy_offset: { x: number; y: number } | undefined) => {
        const grenade = JSON.parse(grenadeSample) as Config;
        const config = { ...grenade, target_output: { ...grenade.target_output, copy_offset } };
        const answer = await send({ type: 'query', requestId: 80, query: { kind: 'inserter-coverage', config } });
        return (answer as { answer: LiveCoverage }).answer;
    };
    const lead = "At about 112 ticks a period (estimated from the target rate: one output hand at the machine's rate), the hands of the 7 copies";
    expect((await live({ x: 12, y: 0 })).dropRoom).toBe(`${lead} fit between each other on belt 1, if the inserters of a copy start together. `
        + 'They would also fit with the copies 16, 18, 20, 22 or 24 tiles apart, and at any of these plus 14. This assumes every copy drops onto the belt the way this one does.');
    expect((await live({ x: 13, y: 0 })).dropRoom).toBe(`${lead} land on each other on belt 1, if the inserters of a copy start together, and some of them wait for room. `
        + 'They would fit with the copies 12, 16, 18, 20, 22 or 24 tiles apart, or 13 tiles apart with the inserters of a copy 7 tiles apart, and at any of these plus 14. This assumes every copy drops onto the belt the way this one does.');
    const without = await live(undefined);
    expect(without.dropRoom).toBeNull();
    expect(without.copyGapNeeded).not.toBeNull();
});

// A real plan of five copies: about 2 s alone, over vitest's 5 s default on a loaded CI runner. Fewer copies make no shared-windows clock.
it('passes on the clock made with shared windows after the clock it shares, with each clock\'s decider count', async () => {
    vi.resetModules();
    const posted: WorkerResponse[] = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    await port.onmessage!({ data: { type: 'initialize', factorioData } });
    await port.onmessage!({ data: { type: 'plan', runId: 50, config: JSON.parse(militarySample) as Config, debugSteps: { prepare: false, warm_up: false, simulate: false }, streamLogs: false } });
    const completed = posted.find(response => response.type === 'primary-completed');
    expect(completed?.type).toBe('primary-completed');
    const primary = completed?.type === 'primary-completed' ? completed.primary : null;
    expect(primary?.alternatives.map(it => [it.id, it.deciders])).toEqual([['planned-belt-slack', 5]]);
    expect(primary?.also?.flatMap(run => run.alternatives.map(it => [it.id, it.deciders, it.verdict]))).toEqual([['planned-belt-slack-shared', 4, 'stable']]);
}, 30_000);
