import { applyRepeatedUnitConversion } from '../utils/configForm/repeatedUnitConversion';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import grenadeSample from '../../../clock-generator/resources/config-samples/intermediates/grenade/grenade-240-fills-belt-exactly.json?raw';
import militarySample from '../../../clock-generator/resources/config-samples/science/military/military-240.json?raw';
import ironScaffold from '../../../clock-generator/resources/config-samples/smelting/iron-plate/iron-plate-80-car-chest.scaffold?raw';
import chestChainScaffold from '../../../clock-generator/resources/config-samples/intermediates/productivity-module/productivity-module-80-chest-chain.scaffold?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyResearch, BeltConfigSchema, decodeBlueprintFileBrowser, encodeBlueprintFileBrowser, ChestConfigSchema, ConfigSchema, importBlueprint, InserterConfigSchema, MachineConfigurationSchema, MiningDrillConfigSchema, researchDifferences,
    type Config, type DebugSteps, type FactorioData, type ImportInputs } from 'clock-generator/browser';
import { REFUSED_CONFIG_ERRORS, refusedConfigOf, type EngineAnswers, type EngineQuery, type LiveCoverage, type PrimaryCompletedResponse, type ValidationFailedResponse, type WorkerRequest, type WorkerResponse } from './types';
import { readConfigFile, readSavedBuild, readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig, type ConfigFormData } from '../utils/configForm/formData';
import { decodeShareLink, encodeShareLink, readShareHash } from '../utils/shareLink';
import { buildValidationIssues, refusedInserterIdsOf, type ValidationDiagnostic } from '../utils/buildValidation';
import { timelineRequestFor } from '../utils/timelineRequest';
import { Option } from 'clock-generator/light';
import type { ClockAlternativeView } from './types';

/** Every response the worker posted in this test, in order */
let posted: WorkerResponse[];
/** Hands the worker a request and gives the last response it posted */
let send: (data: WorkerRequest) => Promise<WorkerResponse>;

// each test starts a fresh worker and loads the game data into it, as the page does
beforeEach(async () => {
    vi.resetModules();
    posted = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    send = async data => { await port.onmessage!({ data }); return posted.at(-1)!; };
    expect(await send({ type: 'initialize', factorioData })).toEqual({ type: 'initialized' });
});
afterEach(() => { vi.unstubAllGlobals(); });

/** The engine's answer to a query, which must be an answer */
async function ask<K extends EngineQuery['kind']>(query: Extract<EngineQuery, { kind: K }>): Promise<EngineAnswers[K]> {
    const response = await send({ type: 'query', requestId: 90, query });
    expect(response.type).toBe('answer');
    return (response as unknown as { answer: EngineAnswers[K] }).answer;
}

/** What the editor asks of the build live, before any Check (the 'inserter-coverage' query of useInserterValidation) */
const coverageOf = (config: Config) => ask({ kind: 'inserter-coverage', config });

/** A live answer with nothing to say */
const nothingLive: LiveCoverage = { issues: [], refusal: null, refusal_inserters: [], pickupsNotTested: [], laneSharedByCopies: null, laneSharedByCopiesInserters: [],
    sideLoadedDrops: [], lanesExactlyFull: null, lanesExactlyFullInserters: [], copyGapNeeded: null, dropRoom: null, machinePrototypes: [] };

/** The issues the App lists for a live answer, folded in as App.tsx does it, for a build with no field problems or chest issues */
const listed = (live: LiveCoverage, machines: { id: number }[], failure?: { message: string; diagnostics?: ValidationDiagnostic[] }) => buildValidationIssues({
    fieldProblems: [], chests: [], inserters: [], chestIssues: [], machines, failure,
    coverage: live.issues, scopeRefusal: live.refusal, scopeRefusalInserters: live.refusal_inserters, pickupsNotTested: live.pickupsNotTested,
    laneSharedByCopies: live.laneSharedByCopies, laneSharedByCopiesInserters: live.laneSharedByCopiesInserters, sideLoadedDrops: live.sideLoadedDrops,
    lanesExactlyFull: live.lanesExactlyFull, lanesExactlyFullInserters: live.lanesExactlyFullInserters, copyGapNeeded: live.copyGapNeeded,
    machinePrototypes: live.machinePrototypes, coverageText: issue => `${issue.kind} ${issue.item_name}`,
});

const noDebug: DebugSteps = { prepare: false, warm_up: false, simulate: false };

/** Plans a generation of the config; the last response the worker posts for it is the primary clock */
async function primaryOf(config: Config, streamLogs = false) {
    const completed = await send({ type: 'plan', runId: 1, config, debugSteps: noDebug, streamLogs });
    expect(completed).toMatchObject({ type: 'primary-completed', runId: 1 });
    return completed as PrimaryCompletedResponse;
}

it('answers output-transfer queries from the engine for both recycler products and their actual separate routes', async () => {
    const config: Config = {
        setpoint: { item: 'supercapacitor', items_per_second: 1, copies: 1 },
        machines: [
            { id: 1, recipe: 'processing-unit-recycling', crafting_speed: 1, productivity: 0, prototype: 'recycler', result_target: { type: 'machine', id: 2 } },
            { id: 2, recipe: 'supercapacitor', crafting_speed: 1, productivity: 0, prototype: 'electromagnetic-plant' },
        ],
        inserters: [{ id: 7, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 3 }, filters: ['advanced-circuit'], stack_size: 1 }],
        belts: [{ id: 3, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }],
        chests: [],
    } as Config;
    const answer = await send({ type: 'query', requestId: 701, query: { kind: 'output-transfers', config } });
    expect(answer).toMatchObject({ type: 'answer', requestId: 701, answer: {
        generation_issues: [],
        transfers: expect.arrayContaining([
            { source: { type: 'machine', id: 1 }, physical_target: { type: 'machine', id: 2 }, mechanism: 'result-placement', status: 'known', results: [
                { item_name: 'electronic-circuit', direct: 'accepted', inserters: [], coverage: 'covered' },
                { item_name: 'advanced-circuit', direct: 'rejected', inserters: [{ inserter_id: 7, target: { type: 'belt', id: 3 } }], coverage: 'covered' },
            ] },
        ]),
    } });
});

it('answers a region-orbits query with the finder\'s plain data, which a copy between threads keeps', async () => {
    const config = JSON.parse(grenadeSample) as Config;
    const found = await ask({ kind: 'region-orbits', config });
    expect(found).not.toBeNull();
    expect(structuredClone(found)).toEqual(found);
    const orbit = found![0].kind === 'orbit' ? found![0].orbit : null;
    expect(orbit?.anchor[0]).toBe('machine:3');
    expect(orbit?.regions.map(region => region.nodes.filter(node => node.startsWith('machine:')).sort())).toEqual([['machine:1', 'machine:2'], ['machine:4', 'machine:5']]);
    // a build with one machine has no copies of a region
    expect(await ask({ kind: 'region-orbits', config: { ...config, machines: config.machines.slice(0, 1), inserters: [], belts: [], chests: [], drills: undefined } as Config })).toBeNull();
});

describe('repeated units: Check clocks them as given and offers the recomputed conversion; query failure', () => {
    /**
     * Eight gear assemblers between the same two belts, eight repeated units set as half a copy; as 4 copies they take 7
     * plates a second from the plate lane they share, of the 7.5 it gets
     */
    const source: Config = {
        setpoint: { item: 'iron-gear-wheel', items_per_second: 3.5, copies: 0.5 },
        machines: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 })),
        inserters: Array.from({ length: 8 }, (_, i) => [
            { id: 2 * i + 1, source: { type: 'belt' as const, id: 1 }, sink: { type: 'machine' as const, id: i + 1 }, stack_size: 1, filters: ['iron-plate'] },
            { id: 2 * i + 2, source: { type: 'machine' as const, id: i + 1 }, sink: { type: 'belt' as const, id: 2 }, stack_size: 1, filters: ['iron-gear-wheel'] },
        ]).flat(),
        belts: [
            { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1, lane_end: { kind: 'infinite' } }] },
            { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 1 }] },
        ], chests: [],
    } as Config;
    const excessive: Config = { ...source, setpoint: { ...source.setpoint, items_per_second: 100 } };
    /** Each output inserter drops at a set place on its lane */
    const unsupported: Config = { ...source, inserters: source.inserters.map((inserter, i) => i % 2 === 1
        ? { ...inserter, sink: { type: 'belt', id: 2, drop: { lane: 1, position: 0 } } } : inserter) };
    const unknown: Config = { ...source, machines: source.machines.map(machine => ({ ...machine, recipe: 'not-a-real-recipe' })) };
    const invalidPrototype: Config = { ...source, inserters: source.inserters.map(inserter => ({ ...inserter, prototype: 'not-an-inserter' })) };
    /** One unit, its gears dropped into an infinity chest with no filter */
    const emptyOutput: Config = { ...source, machines: [source.machines[0]],
        inserters: [source.inserters[0], { ...source.inserters[1], sink: { type: 'chest', id: 7 } }],
        chests: [{ id: 7, type: 'infinity-chest', item_filter: [] }] };

    /** The 8 units as one copy, as an export of all of them gives it: 3.5 a second of the 7.5 plates the lane brings */
    const whole: Config = { ...source, setpoint: { ...source.setpoint, copies: 1 } };

    // a build of 8 repeated units passes Check: it is clocked as given, and the copies come with the one copy that can be offered
    it('Check passes on 8 units and offers them as 8 copies, and leaves the config as it was', async () => {
        const before = structuredClone(whole);
        expect(await send({ type: 'validate', requestId: 6, config: whole })).toMatchObject({ type: 'validated', requestId: 6, recovery: { kind: 'repeated-units',
            sourceConfigKey: JSON.stringify(whole), detectedCopies: 8, configuredCopies: 1, conversion: { kind: 'available', multiplicity: 8, copies: 8 } } });
        expect(whole).toEqual(before);
    });

    // as given at half a copy, the 8 units ask 14 plates a second of the 7.5: Check refuses the target, not the copies
    it('Check refuses 8 units at half a copy for their target, as one copy of them', async () => {
        expect(await send({ type: 'validate', requestId: 7, config: source })).toMatchObject({ type: 'validation-failed', requestId: 7,
            message: expect.stringContaining("No clock can hold this build's setpoint of 3.5 a second over 0.5 copies") });
    });

    it.each([
        { why: 'the message for an unknown inserter', config: invalidPrototype,
            failure: { message: expect.stringContaining('not-an-inserter') } },
        { why: 'a field diagnostic on the chest filter', config: emptyOutput,
            failure: { diagnostics: [{ kind: 'field', path: ['chests', 0, 'item_filter'], message: expect.stringContaining('Remove unfiltered items') }] } },
        { why: 'a coverage diagnostic for no outputs', config: { ...source, inserters: [] },
            failure: { diagnostics: expect.arrayContaining([{ kind: 'coverage', issue: expect.objectContaining({ kind: 'missing_output_inserter' }) }]) } },
    ])('Check fails with $why, and leaves the config as it was', async ({ config, failure }) => {
        const before = structuredClone(config);
        expect(await send({ type: 'validate', requestId: 6, config })).toMatchObject({ type: 'validation-failed', requestId: 6, ...failure });
        expect(config).toEqual(before);
    });

    it.each([
        { why: 'gives 4 copies of one unit', config: source, response: { type: 'answer', answer: { kind: 'available',
            plan: { copies: 4, candidate: { machines: [source.machines[0]], setpoint: { ...source.setpoint, copies: 4 } } } } } },
        { why: 'is refused at Check for a high target', config: excessive, response: { type: 'answer', answer: { kind: 'unavailable',
            stage: 'check', repeatedGroups: 8, reason: { code: 'candidate-check-failed', message: expect.stringContaining("No clock can hold this build's setpoint") } } } },
        { why: 'is refused at the proof for lane drops', config: unsupported, response: { type: 'answer',
            answer: { kind: 'unavailable', stage: 'proof', repeatedGroups: 8, reason: { code: 'unsupported-boundary' } } } },
        // The engine uses untyped errors for an unknown recipe; the worker must not misdiagnose one as a proved candidate refusal.
        { why: 'fails as a query for an unknown recipe', config: unknown,
            response: { type: 'query-failed', message: expect.stringContaining('not-a-real-recipe') } },
    ])('the conversion to copies $why, and leaves the config as it was', async ({ config, response }) => {
        const before = structuredClone(config);
        expect(await send({ type: 'query', requestId: 2, query: { kind: 'repeated-unit-conversion', config } })).toMatchObject({ requestId: 2, ...response });
        expect(config).toEqual(before);
    });

    // a target no clock can hold is a refusal of the build: the engine's opening once and each problem in its own words
    it('Check hands over the opening and each problem when no clock can hold the target', async () => {
        const unheld: Config = { ...source, setpoint: { ...source.setpoint, items_per_second: 100, copies: 1 }, machines: [source.machines[0]], inserters: source.inserters.slice(0, 2) };
        const noClock = expect.stringContaining("No clock can hold this build's setpoint");
        const response = await send({ type: 'validate', requestId: 9, config: unheld });
        expect(response).toMatchObject({ type: 'validation-failed', message: noClock,
            diagnostics: [{ kind: 'refusal', opening: "No clock can hold this build's setpoint:", problems: expect.any(Array) }] });
        const [refusal] = (response as { diagnostics: { opening: string; problems: string[] }[] }).diagnostics;
        expect(refusal.problems.length).toBeGreaterThan(0);
        expect((response as { message: string }).message).toBe(`${refusal.opening} ${refusal.problems.join(' ')}`);
    });
});

it('replays detailed activity through the real worker query without changing the saved config', async () => {
    const config = {
        setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 1 },
            { source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 1 },
        ], belts: [{ id: 1, type: 'transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 1, lane_end: { kind: 'infinite' } }] }],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [{ item_name: 'iron-gear-wheel', request_count: 1 }] }],
    } as Config;
    const before = JSON.stringify(config);
    expect(await send({ type: 'query', requestId: 40, query: { kind: 'timeline-recording', request: { config, mode: 'plan', window_cycle_ticks: 240, terminal_swing_count: 1, windows: {} } } }))
        .toMatchObject({ type: 'answer', requestId: 40, answer: { mode: 'plan', start_tick: 0, end_tick: 240, entities: expect.arrayContaining([expect.objectContaining({ id: 'machine:1', recipe: 'iron-gear-wheel' })]) } });
    expect(JSON.stringify(config)).toBe(before);
});

describe('a captured inserter kind, quality and filter mode', () => {
    // A build file (its pickup captured as the Sidecar 0.11.0 captured it): a legendary stack inserter picks up from a straight belt, a normal fast inserter empties the machine
    const pickup = { type: 'belt', id: 1, near_lane: 1, pickup_length: 1, pickup_layout: 'side-straight', pickup_capture: { status: 'supported',
        entity_type: 'transport-belt', entity_name: 'turbo-transport-belt', model: 'belt', model_version: 2 } };
    const exported = (input: object = {}, output: object = {}) => ({
        format: 1, setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { source: pickup, sink: { type: 'machine', id: 1 }, prototype: 'stack-inserter', quality: 'legendary', stack_size: 16, ...input },
            { source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, prototype: 'fast-inserter', quality: 'normal', stack_size: 4, ...output },
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4, lane_end: { kind: 'infinite' } }] }],
        chests: [{ id: 1, type: 'infinity-chest', remove_unfiltered_items: true }],
    });
    /** Open the file, save the build and reload it the way the page does */
    const openedSavedReloaded = async (file: ReturnType<typeof exported>) => {
        const opened = await ask({ kind: 'config-file', config: file });
        const text = serializeConfig(configToFormData(opened));
        const reloaded = await ask({ kind: 'saved-config', config: readSavedBuild(text) });
        expect(reloaded.problem).toBeNull();
        return formDataToConfig(reloaded.form as ConfigFormData);
    };
    // read as a whitelist, the blacklist would leave the gears without an output inserter and offer a new belt for them
    const blacklist = { filters: ['iron-plate'], filter_mode: 'blacklist' };

    it.each([
        { name: 'the stack and fast inserters exported', refusal: null,
            kept: [{ prototype: 'stack-inserter', quality: 'legendary' }, { prototype: 'fast-inserter', quality: 'normal' }] },
        { name: 'a normal long-handed belt pickup', input: { prototype: 'long-handed-inserter', quality: 'normal', stack_size: 4 },
            kept: [{ prototype: 'long-handed-inserter', quality: 'normal' }, {}],
            refusal: 'Inserter 1: picking up from a belt with a normal long-handed-inserter is not supported yet' },
        { name: 'a blacklist on the output inserter', output: blacklist, kept: [{}, blacklist],
            refusal: 'Inserter 2: `filter_mode` "blacklist" is refused' },
    ])('keeps $name through a file, save and reload, and refuses it live and in Check only when out of scope', async ({ input, output, kept, refusal }) => {
        const config = await openedSavedReloaded(exported(input, output));
        expect(config.inserters).toMatchObject(kept);
        const blocking = listed(await coverageOf(config), config.machines).filter(issue => issue.blocksGeneration);
        expect(blocking.map(({ source, text }) => ({ source, text }))).toEqual(refusal ? [{ source: 'engine', text: expect.stringContaining(refusal) }] : []);
        expect(await send({ type: 'validate', requestId: 52, config }))
            .toMatchObject(refusal ? { type: 'validation-failed', message: expect.stringContaining(refusal) } : { type: 'validated' });
    });

    it('lists the refused blacklist once when a Check stopped at the same refusal', async () => {
        const config = await openedSavedReloaded(exported({}, blacklist));
        const checked = await send({ type: 'validate', requestId: 54, config }) as ValidationFailedResponse;
        expect(listed(await coverageOf(config), config.machines, { message: checked.message })).toHaveLength(1);
    });

    it('Check shows the refused blacklist as a refusal, not as an internal error', async () => {
        const config = await openedSavedReloaded(exported({}, blacklist));
        const checked = await send({ type: 'validate', requestId: 55, config }) as ValidationFailedResponse;
        expect(checked.message).toContain('`filter_mode` "blacklist" is refused');
        expect(checked.internal).toBeUndefined();
    });
});

describe('inserters that take from a belt into chests (#650)', () => {
    // the shape of the build in the issue: belts fill two chests by inserter (3 and 5), and a machine takes from one of them
    const config = {
        setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'machine', id: 1 } },
            { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 } },
            { id: 3, source: { type: 'belt', id: 2, pickup_length: 1 }, sink: { type: 'chest', id: 2 } },
            { id: 4, source: { type: 'chest', id: 2 }, sink: { type: 'machine', id: 1 } },
            { id: 5, source: { type: 'belt', id: 3, pickup_length: 1 }, sink: { type: 'chest', id: 3 } },
        ],
        belts: [
            { id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4, lane_end: { kind: 'infinite' } }] },
            { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'steel-plate', stack_size: 4, lane_end: { kind: 'infinite' } }] },
            { id: 3, type: 'turbo-transport-belt', lanes: [{ ingredient: 'stone', stack_size: 4, lane_end: { kind: 'infinite' } }] },
        ],
        chests: [
            { id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true },
            { id: 2, type: 'buffer-chest', storage_size: 1, item_filter: 'steel-plate', prototype: 'wooden-chest' },
            { id: 3, type: 'buffer-chest', storage_size: 1, item_filter: 'stone', prototype: 'wooden-chest' },
        ],
    } as unknown as Config;
    const says = 'Inserters 3 and 5 take from a belt and drop into something a belt pickup cannot drop into: '
        + 'Inserter 3 takes from Belt 2 and drops into Chest 2; Inserter 5 takes from Belt 3 and drops into Chest 3. '
        + 'A belt pickup can drop into a machine or into a steel chest, and nowhere else, so this build cannot be clocked. '
        + 'Make each of them drop into a machine or into a steel chest.';

    it('names inserters 3 and 5 live, in the one error the Build validation lists', async () => {
        const response = await send({ type: 'query', requestId: 55, query: { kind: 'inserter-coverage', config } });
        const live = { ...nothingLive, refusal: says, refusal_inserters: [3, 5] };
        expect(response).toStrictEqual({ type: 'answer', requestId: 55, answer: live });
        const blocking = listed(live, config.machines).filter(issue => issue.blocksGeneration);
        expect(blocking).toHaveLength(1);
        expect(blocking[0]).toMatchObject({ source: 'engine', id: 'inserter-scope', inserters: [3, 5], text: says });
    });

    it('outlines rows 3 and 5 only while they take from a belt into a chest: none once they drop into a machine', async () => {
        const outlined = async (build: Config) => [...refusedInserterIdsOf(listed(await coverageOf(build), build.machines))];
        expect(await outlined(config)).toEqual([3, 5]);
        const fixed = { ...config, inserters: config.inserters.map(inserter => inserter.id === 3 || inserter.id === 5
            ? { ...inserter, sink: { type: 'machine', id: 1 } } : inserter) } as Config;
        expect(await outlined(fixed)).toEqual([]);
        // an advisory or a problem that names no inserter outlines nothing
        expect([...refusedInserterIdsOf([{ blocksGeneration: false, inserters: [3] }, { blocksGeneration: true }])]).toEqual([]);
    });

    it('Check refuses it with structured IDs, folding once beside the live refusal or by itself', async () => {
        const checked = await send({ type: 'validate', requestId: 56, config }) as ValidationFailedResponse;
        const live = await coverageOf(config);
        const failure = { message: checked.message, diagnostics: checked.diagnostics };
        const withCheck = listed(live, config.machines, failure);
        expect(withCheck).toHaveLength(1);
        expect(withCheck).toEqual(listed(live, config.machines));
        expect(withCheck).toEqual(listed(nothingLive, config.machines, failure));
        expect(checked).toStrictEqual({ type: 'validation-failed', requestId: 56, message: says, internal: undefined,
            diagnostics: [{ kind: 'inserters', ids: [3, 5], message: says }] });
    });

    it('returns the same text with the at-target preview failure shape', async () => {
        expect(await send({ type: 'query', requestId: 57, query: { kind: 'machine-target-rates', config } }))
            .toStrictEqual({ type: 'query-failed', requestId: 57, message: says });
    });

    it('still sends the refused plan as one run error with its class in the stack', async () => {
        const offset = posted.length;
        const error = await send({ type: 'plan', runId: 56, config, debugSteps: noDebug, streamLogs: true });
        expect(posted.slice(offset).map(response => response.type)).toEqual(['error']);
        expect(error).toStrictEqual({ type: 'error', runId: 56, message: says, stack: expect.any(String) });
        if (error.type !== 'error') throw new Error('Expected the run failure');
        expect(error.stack?.split('\n')[0]).toBe(`BeltPickupSinkError: ${says}`);
    });

    it('folds a diagnostic-free Check only when its text equals a live refusal', async () => {
        const live = await coverageOf(config);
        expect(live.refusal).toBeTypeOf('string');
        const same = { message: live.refusal! };
        const liveOnly = listed(live, config.machines);
        expect(liveOnly).toHaveLength(1);
        expect(listed(live, config.machines, same)).toEqual(liveOnly);
        expect(listed(live, config.machines, { ...same, diagnostics: [] })).toEqual(liveOnly);
        expect([...refusedInserterIdsOf(liveOnly)]).toEqual([3, 5]);

        const checkOnly = listed(nothingLive, config.machines, same);
        expect(checkOnly).toHaveLength(1);
        expect(checkOnly[0]).toMatchObject({ id: 'engine-check', source: 'engine', blocksGeneration: true, text: same.message });
        expect(checkOnly[0].inserters).toBeUndefined();
        expect([...refusedInserterIdsOf(checkOnly)]).toEqual([]);

        const both = listed(live, config.machines, { message: 'The check failed.' });
        expect(both).toMatchObject([liveOnly[0], { id: 'engine-check', source: 'engine', blocksGeneration: true, text: 'The check failed.' }]);
        expect(both[1].inserters).toBeUndefined();
        expect([...refusedInserterIdsOf(both)]).toEqual([3, 5]);
    });
});

describe('the shared hand of a recycler that places its results in a cargo wagon', () => {
    const config = ConfigSchema.parse({
        setpoint: { item: 'electronic-circuit', items_per_second: 0.1, copies: 1 },
        machines: [{ id: 1, recipe: 'processing-unit-recycling', prototype: 'recycler', crafting_speed: 1,
            productivity: 0, result_target: { type: 'chest', id: 14 } }],
        belts: [],
        chests: [
            { id: 11, type: 'infinity-chest', item_filter: [{ item_name: 'processing-unit', request_count: 100 }], remove_unfiltered_items: true },
            { id: 14, type: 'cargo-wagon' },
            { id: 15, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true },
        ],
        inserters: [
            { id: 2, source: { type: 'chest', id: 11 }, sink: { type: 'machine', id: 1 }, prototype: 'stack-inserter' },
            { id: 7, source: { type: 'chest', id: 14 }, sink: { type: 'chest', id: 15 }, prototype: 'stack-inserter',
                filters: ['electronic-circuit', 'advanced-circuit'] },
        ],
    });
    const opening = "No clock can hold this build's setpoint:";
    const problem = 'Inserter 7 takes electronic circuit and advanced circuit out of the cargo wagon. '
        + 'An inserter that holds part of a hand of one of them takes only more of that one, so the others pile up in '
        + 'the cargo wagon, and once it is full the one it waits for cannot come in: the build stops for good. Give each result an '
        + 'inserter of its own. An inserter whose filters the clock sets by signal would not wait; such a clock is not planned yet.';
    const message = `${opening} ${problem}`;

    it('sends the ordered problems in Check and lists one blocking issue for each', async () => {
        const checked = await send({ type: 'validate', requestId: 58, config }) as ValidationFailedResponse;
        expect(checked).toStrictEqual({ type: 'validation-failed', requestId: 58, message, internal: undefined,
            diagnostics: [{ kind: 'refusal', opening, problems: [problem] }] });
        const issues = listed(nothingLive, config.machines, checked);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ id: 'refusal:0', text: problem, blocksGeneration: true, source: 'refusal', lead: opening });
        expect([...refusedInserterIdsOf(issues)]).toEqual([]);
    });

    it('sends only the query ID and entire refusal in the at-target preview failure', async () => {
        expect(await send({ type: 'query', requestId: 58, query: { kind: 'machine-target-rates', config } }))
            .toStrictEqual({ type: 'query-failed', requestId: 58, message });
    });

    it('refuses repeated-unit conversion at proof before it can check the candidate', async () => {
        expect(await send({ type: 'query', requestId: 59, query: { kind: 'repeated-unit-conversion', config } })).toStrictEqual({
            type: 'answer', requestId: 59, answer: { kind: 'unavailable', stage: 'proof', repeatedGroups: 1, reason: {
                code: 'unsupported-boundary', message: 'A machine that places its results into a container is not supported in repeated copies.',
            } },
        });
    });

    it('keeps the plain planner refusal when the inserter takes without waiting for a full hand', async () => {
        const build: Config = {
            ...config,
            setpoint: { ...config.setpoint, item: 'processing-unit', counts: 'destroyed' },
            inserters: config.inserters.map(inserter => inserter.id === 7 ? { ...inserter, prototype: 'bulk-inserter' } : inserter),
        };
        const checked = await send({ type: 'validate', requestId: 67, config: build }) as ValidationFailedResponse;
        const preview = await send({ type: 'query', requestId: 69, query: { kind: 'machine-target-rates', config: build } });
        const offset = posted.length;
        const plan = await send({ type: 'plan', runId: 68, config: build, debugSteps: noDebug, streamLogs: true });

        expect.soft(checked).toStrictEqual({ type: 'validation-failed', requestId: 67, message: problem, internal: undefined, diagnostics: undefined });
        expect.soft(preview).toStrictEqual({ type: 'query-failed', requestId: 69, message: problem });
        const stream = posted.slice(offset);
        expect.soft(stream.some(response => response.type === 'log' && response.runId === 68)).toBe(true);
        expect.soft(stream.filter(response => response.type !== 'log').map(response => response.type)).toEqual(['error']);
        expect.soft(plan).toStrictEqual({ type: 'error', runId: 68, message: problem, stack: expect.any(String) });
        if (plan.type !== 'error') throw new Error('Expected the plain planner refusal');
        expect.soft(plan.stack?.split('\n')[0]).toBe(`Error: ${problem}`);

        const issues = listed(nothingLive, build.machines, checked);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ id: 'engine-check', text: checked.message, blocksGeneration: true, source: 'engine' });
        expect(issues[0].inserters).toBeUndefined();
        expect([...refusedInserterIdsOf(issues)]).toEqual([]);
    });
});

describe('live advice on a gear assembler, which does not block', () => {
    /** A gear assembler fed by a legendary stack inserter with its full hand, from a belt of the given stack size */
    const gears = ({ stack_size = 4, ...target }: { stack_size?: number } & Partial<Config['setpoint']> = {}) => ({
        setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1, ...target },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'machine', id: 1 } },
            { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 } },
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size, lane_end: { kind: 'infinite' } }] }],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
    } as Config);
    /** The engine's warning for gears({ stack_size: 2 }) in the generation log */
    const pickupNotTested = 'Not tested: The inserter (inserter 1) that takes iron plate picks up iron plate from the iron plate belt (belt 1) in 2-item belt stacks. Belt pickup timing is calibrated '
        + 'with 16-item hands on 4-item belt stacks only; at other belt stack sizes and hand sizes it has not been compared with the '
        + 'game, so the clock may not match the game.';

    it('warns live of a belt pickup of untested timing with the engine\'s data, which the site words, and Check goes on', async () => {
        const config = gears({ stack_size: 2 });
        const live = await coverageOf(config);
        const pickups = [{ inserter_id: 1, belt_id: 1, item: 'iron-plate', lane_stack_sizes: [2], hand_size: null, item_stack_size: null }];
        expect(live).toEqual({ ...nothingLive, pickupsNotTested: pickups });
        expect(listed(live, config.machines).map(({ source, severity, blocksGeneration, text, advisory }) => ({ source, severity, blocksGeneration, text, advisory })))
            .toEqual([{ source: 'calibration', severity: 'warning', blocksGeneration: false, text: 'Belt pickup not tested', advisory: { kind: 'pickup-not-tested', pickups } }]);
        expect(await send({ type: 'validate', requestId: 61, config })).toMatchObject({ type: 'validated' });
    });

    it('refuses at Check the copies taking more from a lane they share than it gets, and warns of nothing live', async () => {
        // 100 copies of a gear assembler, each taking 1.5 iron plates a second, from a lane they share that gets 120
        const config = gears({ items_per_second: 75, copies: 100 });
        expect(await coverageOf(config)).toEqual(nothingLive);
        expect(await send({ type: 'validate', requestId: 62, config })).toMatchObject({ type: 'validation-failed',
            message: expect.stringContaining('The 100 copies share lane 1 of belt 1. Together they take 100 × 1.5 = 150 a second from it. '
                + 'Its supply rate is 120 a second. Set the lane to per copy if the copies do not share it. If they share it, use a smaller number of copies.') });
    });

    it('says nothing of a pickup from 4-item belt stacks, and notes a drop the Sidecar marked as side-loading', async () => {
        expect(await coverageOf(gears())).toEqual(nothingLive);
        // the live answer carries the engine's data, which the site words; it blocks nothing
        const fed = gears();
        const marked = { ...fed, inserters: [fed.inserters[0], { ...fed.inserters[1], sink: { type: 'belt', id: 2, drop_capture: { status: 'side-loaded', tiles: 3 } } }],
            belts: [...fed.belts, { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 4 }] }] } as Config;
        const live = await coverageOf(marked);
        expect(live.sideLoadedDrops).toEqual([{ inserter_id: 2, tiles: 3 }]);
        expect(listed(live, marked.machines).map(({ text, blocksGeneration }) => ({ text, blocksGeneration })))
            .toEqual([{ text: 'Drops onto a belt that side-loads', blocksGeneration: false }]);
    });

    it('logs the untested belt pickup in generation, as it warns of it live, and makes the clock with it as an insight', async () => {
        const { primary } = await primaryOf(gears({ stack_size: 2 }), true);
        expect(primary?.alternatives[0].insights.filter(insight => insight.id === 'belt-pickup-not-tested')).toHaveLength(1);
        const warned = posted.flatMap(response => response.type === 'log' ? response.messages : []).filter(message => message.level === 'warn');
        expect(warned.map(message => message.message)).toEqual([pickupNotTested]);
    });
});

it('gives the crafting machines, and warns live of a machine that cannot make its recipe', async () => {
    const lookups = await ask({ kind: 'lookups' });
    expect(lookups.craftingMachines.machines.map(machine => machine.name)).toContain('cryogenic-plant');
    expect(lookups.craftingMachines.recipeCategories['lithium-plate']).toEqual(['smelting']);

    const furnace = { id: 1, recipe: 'iron-plate', crafting_speed: 2, productivity: 0, prototype: 'electric-furnace' };
    const config = {
        setpoint: { item: 'iron-plate', items_per_second: 1, copies: 1 },
        machines: [furnace], inserters: [], belts: [],
    };
    const live = await coverageOf({ ...config, machines: [{ ...furnace, prototype: 'cryogenic-plant' }] } as Config);
    expect(live.machinePrototypes.map(issue => issue.kind)).toEqual(['recipe-not-made']);
    expect(listed({ ...nothingLive, machinePrototypes: live.machinePrototypes }, [{ id: 1 }])
        .map(({ source, severity, blocksGeneration, advisory }) => ({ source, severity, blocksGeneration, advisory })))
        .toEqual([{ source: 'machine', severity: 'warning', blocksGeneration: false,
            advisory: { kind: 'machine-prototype', problem: 'recipe-not-made', machines: [{ machine_id: 1, message: live.machinePrototypes[0].message }] } }]);
});

it('says live whether the copies\' drops fit at the gap given, for the period estimated from the settings', async () => {
    const live = (copy_offset: { x: number; y: number } | undefined) => {
        const grenade = JSON.parse(grenadeSample) as Config;
        return coverageOf({ ...grenade, setpoint: { ...grenade.setpoint, copy_offset } });
    };
    const lead = "At about 112 ticks a window cycle (estimated from the setpoint: one output hand at the machine's rate), the hands of the 7 copies";
    expect((await live({ x: 12, y: 0 })).dropRoom).toBe(`${lead} fit between each other on the grenade belt (belt 1), if the inserters of a copy start together. `
        + 'They would also fit with the copies 16, 18, 20, 22 or 24 tiles apart, and at any of these plus 14. This assumes every copy drops onto the belt the way this one does.');
    expect((await live({ x: 13, y: 0 })).dropRoom).toBe(`${lead} land on each other on the grenade belt (belt 1), if the inserters of a copy start together, and some of them wait for room. `
        + 'They would fit with the copies 12, 16, 18, 20, 22 or 24 tiles apart, or 13 tiles apart with the inserters of a copy 7 tiles apart, and at any of these plus 14. This assumes every copy drops onto the belt the way this one does.');
    const without = await live(undefined);
    expect(without.dropRoom).toBeNull();
    expect(without.copyGapNeeded).not.toBeNull();
    // the note on the lanes the copies fill exactly comes with the inserters it is about, the chips of its line: the four
    // that drop onto the grenade belt
    expect({ note: without.lanesExactlyFull !== null, inserters: without.lanesExactlyFullInserters }).toEqual({ note: true, inserters: [1, 2, 7, 8] });
});

// A real plan of five copies: about 2 s alone, over vitest's 5 s default on a loaded CI runner. Fewer copies make no shared-windows clock.
it('passes on the clock made with shared windows after the clock it shares, with each clock\'s decider count', async () => {
    const { primary } = await primaryOf(JSON.parse(militarySample) as Config);
    expect(primary?.alternatives.map(it => [it.id, it.deciders])).toEqual([['round_robin_polling', 5]]);
    expect(primary?.also?.flatMap(run => run.alternatives.map(it => [it.id, it.deciders, it.verdict]))).toEqual([['round_robin_polling_shared', 4, 'stable']]);
}, 30_000);

// a real plan of five copies, as above
it('passes on what was checked on the shared lanes of each clock, and every lane of the build', async () => {
    const { primary } = await primaryOf(JSON.parse(militarySample) as Config);
    const [clock] = primary!.alternatives;
    expect(clock.checkedLanes?.line).toMatchObject({ run_with_copies: true, copies: 5, plain_output_belts: 2 });
    expect(clock.checkedLanes?.rows.map(row => [row.belt_id, row.lane, row.state.kind])).toEqual([
        [1, 1, 'rate_fits'], [2, 1, 'rate_fits'], [3, 1, 'holds'], [3, 2, 'holds'], [4, 1, 'holds'], [4, 2, 'holds']]);
    // the coal lanes are one per copy: in the list of lanes, with no row
    expect(clock.assumptions.lanes?.map(lane => [lane.belt_id, lane.lane, lane.role, lane.sharing])).toEqual([
        [1, 1, 'output', 'shared'], [2, 1, 'output', 'shared'], [3, 1, 'input', 'shared'], [3, 2, 'input', 'shared'], [4, 1, 'input', 'shared'],
        [4, 2, 'input', 'shared'], [5, 1, 'input', 'per_copy'], [5, 2, 'input', 'per_copy'], [6, 1, 'input', 'per_copy'], [6, 2, 'input', 'per_copy']]);
    // the machine each inserter that puts into one puts into, by the inserter's number: what a build of one copy names its inserters with
    const config = JSON.parse(militarySample) as Config;
    const expected = config.inserters.flatMap((inserter, index) => inserter.sink.type === 'machine' ? [[inserter.id ?? index + 1, inserter.sink.id]] : []);
    expect(expected.length).toBeGreaterThan(0);
    expect(Object.entries(clock.assumptions.machineOfInserter ?? {}).map(([id, machine]) => [Number(id), machine])).toEqual(expected);
}, 30_000);

describe('a build that states no lane end', () => {
    /** The military sample with no lane end stated: the engine gives each lane the end of its role */
    const statingNothing = () => {
        const sample = JSON.parse(militarySample) as Config;
        const belts = sample.belts.map(belt => ({ ...belt, lanes: belt.lanes.map(lane => {
            const stated: { lane_end?: unknown } = { ...lane };
            delete stated.lane_end;
            return stated;
        }) }));
        return { ...sample, belts } as Config;
    };

    it('reads as backed up, loaded and generated', async () => {
        const loaded = formDataToConfig(readSavedConfig(serializeConfig(configToFormData(statingNothing())))!);
        const { primary } = await primaryOf(loaded);
        expect(primary?.alternatives.map(it => [it.beltLabel, it.backedUpBelts, it.replayReadsConfig])).toEqual([['backed-up', true, true]]);
    }, 30_000);
});

describe("a clock's replay", () => {
    // one input lane states an infinite end, another input lane and the output lane state nothing
    const mixed = {
        setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }, { id: 2, recipe: 'copper-cable', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } },
            { source: { type: 'belt', id: 2 }, sink: { type: 'machine', id: 2 } },
            { source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 3 } },
        ],
        belts: [
            { id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4, lane_end: { kind: 'infinite' } }] },
            { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'copper-plate', stack_size: 4 }] },
            { id: 3, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 4 }] },
        ],
    } as Config;
    const clock = { simulationDurationTicks: 100, terminalSwingCount: 2, clockWindows: {}, fuelView: null } as unknown as ClockAlternativeView;
    const endsOf = async (config: Config) => {
        const { laneFactsOfConfig } = await import('clock-generator/browser');
        const facts = laneFactsOfConfig(config);
        return config.belts.map(belt => facts.lanesOf(belt.id).map(lane => lane.lane_end.kind));
    };

    it('gives each lane of a clock of this engine the end its generation gave it, whatever belt the clock was made for', async () => {
        const generation = await endsOf(mixed);
        expect(generation).toEqual([['infinite'], ['dead_end'], ['infinite']]);
        for (const made_for of [{ beltLabel: 'moving', backedUpBelts: false }, { beltLabel: 'backed-up', backedUpBelts: true }]) {
            const request = timelineRequestFor(mixed, { ...clock, ...made_for, replayReadsConfig: true }, 'clock');
            expect(await endsOf(request!.config)).toEqual(generation);
        }
    });

    it('gives a clock kept before the belt it was made for on every lane, a lane that states its end too', async () => {
        const request = timelineRequestFor(mixed, { ...clock, beltLabel: 'backed-up', backedUpBelts: true }, 'clock');
        expect(await endsOf(request!.config)).toEqual([['dead_end'], ['dead_end'], ['dead_end']]);
    });
});

it('posts the state transitions in columns with their own reasons, which a structured clone carries and which read back the same', async () => {
    const completed = await primaryOf(JSON.parse(grenadeSample) as Config);
    const alternative = completed.primary!.alternatives[0];
    const history = alternative.stateTransitionHistory;
    expect(history.entities.length).toBeGreaterThan(0);
    expect(history.entities[0].columns.tick).toBeInstanceOf(Int32Array);
    expect(new Set(history.entities.flatMap(entity => Array.from(entity.columns.reason))).size).toBe(history.reasons.length);
    const { expandStateTransitionHistory } = await import('clock-generator/light');
    const expanded = expandStateTransitionHistory(history);
    expect(expanded.entities.some(entity => entity.transitions.length > 0 && entity.transitions.every(it => it.reason.length > 0))).toBe(true);
    // what the page receives
    const received = structuredClone(completed);
    expect(expandStateTransitionHistory(received.primary!.alternatives[0].stateTransitionHistory)).toEqual(expanded);
    expect(alternative).not.toHaveProperty('clockOnlyStateTransitionHistory');
}, 30_000);

describe('an unexpected error in the check is not an engine refusal', () => {
    const config = JSON.parse(militarySample) as Config;

    it('refusals carry no internal error', async () => {
        const response = await send({ type: 'validate', requestId: 31, config: { ...config, machines: 'none' as unknown as Config['machines'] } });
        expect(response).toMatchObject({ type: 'validation-failed' });
        expect((response as ValidationFailedResponse).internal).toBeUndefined();
    });

    it('an error the engine does not own is internal, with its stack', async () => {
        const engine = await import('clock-generator/browser');
        const spy = vi.spyOn(engine, 'validateConfig').mockImplementation(() => { throw new TypeError('Cannot convert undefined or null to object'); });
        try {
            const response = await send({ type: 'validate', requestId: 32, config }) as ValidationFailedResponse;
            expect(response.type).toBe('validation-failed');
            expect(response.internal).toMatchObject({ message: 'Cannot convert undefined or null to object', dataMismatch: false });
            expect(response.internal?.stack).toContain('TypeError');
        } finally {
            spy.mockRestore();
        }
    });

    it('a plain Error from a planning refusal is a refusal', async () => {
        const engine = await import('clock-generator/browser');
        const spy = vi.spyOn(engine, 'validateConfig').mockImplementation(() => { throw new Error('Machine 1: the target is not made'); });
        try {
            const response = await send({ type: 'validate', requestId: 34, config }) as ValidationFailedResponse;
            expect(response).toMatchObject({ type: 'validation-failed', message: 'Machine 1: the target is not made' });
            expect(response.internal).toBeUndefined();
        } finally {
            spy.mockRestore();
        }
    });

    it('a thrown value that is not an Error is internal', async () => {
        const engine = await import('clock-generator/browser');
        const spy = vi.spyOn(engine, 'validateConfig').mockImplementation(() => { throw 'oops'; });
        try {
            expect((await send({ type: 'validate', requestId: 35, config }) as ValidationFailedResponse).internal).toMatchObject({ message: 'oops' });
        } finally {
            spy.mockRestore();
        }
    });

    it('says the data does not match when the loaded game data lacks a section the engine reads', async () => {
        const older = JSON.parse(factorioData);
        delete older.quality_inventory;
        expect(await send({ type: 'initialize', factorioData: JSON.stringify(older) })).toEqual({ type: 'initialized' });
        const engine = await import('clock-generator/browser');
        const spy = vi.spyOn(engine, 'validateConfig').mockImplementation(() => { throw new TypeError('x'); });
        try {
            const response = await send({ type: 'validate', requestId: 33, config }) as ValidationFailedResponse;
            expect(response.internal).toMatchObject({ dataMismatch: true });
        } finally {
            spy.mockRestore();
        }
    });
});

describe('a setpoint named by a recipe, as the picker stores it', () => {
    /** One biochamber on jellynut-processing, which makes jelly, with an inserter for each ingredient and each result */
    const jellynut = (recipe: string) => {
        const supply = (id: number, ingredient: string) => ({ id, type: 'transport-belt', flow_direction: 0,
            lanes: [{ ingredient, stack_size: 1, lane_end: { kind: 'unknown' } }, { ingredient, stack_size: 1, lane_end: { kind: 'unknown' } }] });
        return { setpoint: { item: recipe, items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: 'jellynut-processing', productivity: 0, crafting_speed: 2, prototype: 'biochamber' }],
            inserters: [
                { id: 1, source: { type: 'belt', id: 3, pickup_length: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 1 },
                { id: 2, source: { type: 'belt', id: 4, pickup_length: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 1 },
                { id: 3, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 1, filters: ['jelly'] },
                { id: 4, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 2 }, stack_size: 1, filters: ['jellynut-seed'] },
            ],
            belts: [
                { id: 1, type: 'transport-belt', lanes: [{ ingredient: 'jelly', stack_size: 1 }, { ingredient: 'jelly', stack_size: 1 }] },
                { id: 2, type: 'transport-belt', lanes: [{ ingredient: 'jellynut-seed', stack_size: 1 }] },
                supply(3, 'jellynut'), supply(4, 'nutrients'),
            ],
            chests: [] } as unknown as Config;
    };

    it('Check finds the machines that make the recipe main product, and leaves the config as it was', async () => {
        const named = jellynut('jellynut-processing');
        const before = structuredClone(named);
        expect(await send({ type: 'validate', requestId: 31, config: jellynut('jelly') })).toMatchObject({ type: 'validated' });
        expect(await send({ type: 'validate', requestId: 32, config: named })).toMatchObject({ type: 'validated' });
        expect(named).toEqual(before);
    });

    it.each([false, true])('offers conversion of the original recipe and canonical rate (fraction %s)', async fractional => {
        const one = jellynut('jellynut-processing');
        // two units that share the belts, as 2 units set as one copy
        const repeated: Config = { ...one,
            machines: [one.machines[0], { ...one.machines[0], id: 2 }],
            inserters: [...one.inserters, ...one.inserters.map(inserter => ({ ...inserter, id: (inserter.id ?? 0) + 4,
                source: inserter.source.type === 'machine' ? { ...inserter.source, id: 2 } : inserter.source,
                sink: inserter.sink.type === 'machine' ? { ...inserter.sink, id: 2 } : inserter.sink }))] };
        const form = configToFormData(repeated);
        const named = formDataToConfig(form);
        if (fractional) named.setpoint.items_per_second = { denominator: 7, numerator: 16 };
        const canonical = { ...named, setpoint: { ...named.setpoint,
            items_per_second: fractional ? { numerator: 16, denominator: 7 } : named.setpoint.items_per_second } };
        const response = await send({ type: 'validate', requestId: 33, config: named });
        expect(response).toMatchObject({ type: 'validated', recovery: { kind: 'repeated-units', sourceConfigKey: JSON.stringify(canonical), detectedCopies: 2 } });
        const conversion = await ask({ kind: 'repeated-unit-conversion', config: named });
        expect(conversion).toMatchObject({ kind: 'available' });
        if (conversion.kind === 'available') {
            expect(conversion.plan.sourceConfigKey).toBe(JSON.stringify(canonical));
            form.setpoint.items_per_second = named.setpoint.items_per_second;
            const applied = applyRepeatedUnitConversion(form, conversion.plan);
            expect(applied?.setpoint).toMatchObject({ item: 'jellynut-processing', items_per_second: canonical.setpoint.items_per_second, copies: 2 });
            expect(conversion.plan.candidate.setpoint).toMatchObject({ item: 'jellynut-processing', items_per_second: canonical.setpoint.items_per_second });
        }
    });

    it('is answered as the item in the queries, and kept as the recipe in an imported file', async () => {
        const named = jellynut('jellynut-processing');
        expect(await ask({ kind: 'target-rate-max', config: named })).toEqual(await ask({ kind: 'target-rate-max', config: jellynut('jelly') }));
        expect((await ask({ kind: 'config-file', config: { format: 1, ...named } })).setpoint.item).toBe('jellynut-processing');
    });

    const seedReason = { code: 'not-counted-yet', item: 'jellynut-seed', choice: 'jelly' };
    const technical = 'not-counted-yet: item=jellynut-seed choice=jelly';

    it('Check refuses an output the engine does not count yet, with the code in the field diagnostic and the technical string as the message', async () => {
        const response = await send({ type: 'validate', requestId: 41, config: jellynut('jellynut-seed') }) as ValidationFailedResponse;
        expect(response.type).toBe('validation-failed');
        expect(response.message).toContain(technical);
        expect(response.diagnostics).toEqual([{ kind: 'field', path: ['setpoint', 'item'], message: technical, reason: seedReason }]);
        expect(await send({ type: 'validate', requestId: 42, config: jellynut('jelly') })).toMatchObject({ type: 'validated' });
    });

    it('a run of a refused build answers an error with the technical string', async () => {
        const response = await send({ type: 'plan', runId: 7, config: jellynut('jellynut-seed'), debugSteps: noDebug, streamLogs: false });
        expect(response).toMatchObject({ type: 'error', runId: 7, message: expect.stringContaining(technical) });
        expect(response).not.toHaveProperty('diagnostics');
    });

    it('Check refuses a recipe with no item result, with the code of it', async () => {
        const config = { ...jellynut('jelly'), setpoint: { item: 'sulfuric-acid', items_per_second: 1, copies: 1 } } as Config;
        const response = await send({ type: 'validate', requestId: 43, config }) as ValidationFailedResponse;
        expect(response.diagnostics).toEqual([{ kind: 'field', path: ['setpoint', 'item'], message: 'no-countable-output: recipe=sulfuric-acid',
            reason: { code: 'no-countable-output', recipe: 'sulfuric-acid' } }]);
    });

    it('a saved form and an imported file that hold such a setpoint open as they are, for Check to refuse', async () => {
        const form = { format: 1, ...jellynut('jellynut-seed'), chests: [] };
        expect((await ask({ kind: 'saved-config', config: form })).problem).toBeNull();
        expect((await ask({ kind: 'config-file', config: form })).setpoint.item).toBe('jellynut-seed');
    });

    it('carries, in the lookups, what each recipe offers as the setpoint output', async () => {
        const { recipes } = await ask({ kind: 'lookups' });
        expect(recipes.get('jellynut-processing')?.output).toEqual({ kind: 'output', item: 'jelly', choices: ['jellynut-seed', 'jelly'] });
        expect(recipes.get('iron-bacteria')?.output).toEqual({ kind: 'output', item: 'spoilage', choices: ['iron-bacteria', 'spoilage'] });
        expect(recipes.get('kovarex-enrichment-process')?.output).toEqual({ kind: 'output', item: 'uranium-235', choices: [] });
        expect(recipes.get('sulfuric-acid')?.output).toEqual({ kind: 'none' });
    });
});

it('keeps a pair on saved and file reads, then refuses both strict actions until Copies is corrected', async () => {
    const config: Config = JSON.parse(grenadeSample);
    config.setpoint = { ...config.setpoint, copies: 2, items_per_second: { denominator: 100000000000000, numerator: 1 } };
    const saved = await ask({ kind: 'saved-config', config });
    expect(saved.problem).toBeNull();
    for (const opened of [saved.form as Config, await ask({ kind: 'config-file', config })]) {
        expect(JSON.stringify(opened.setpoint.items_per_second)).toBe('{"numerator":1,"denominator":100000000000000}');
        expect(opened.setpoint.copies).toBe(2);
    }
    expect(await send({ type: 'validate', requestId: 320, config })).toMatchObject({ type: 'validation-failed', message: expect.stringMatching(/precision/i) });
    expect(await send({ type: 'plan', runId: 321, config, streamLogs: false, debugSteps: noDebug }))
        .toMatchObject({ type: 'error', message: expect.stringMatching(/precision/i) });
});

it('checks and plans the exact entered rate after a structured-clone handoff', async () => {
    const config = structuredClone({
        setpoint: { item: 'iron-gear-wheel', items_per_second: { denominator: 7, numerator: 16 }, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', prototype: 'assembling-machine-3', productivity: 0, crafting_speed: 4 }],
        inserters: [
            { id: 1, source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 2 },
            { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 2 }, stack_size: 1 },
        ], belts: [],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [{ item_name: 'iron-plate', request_count: 100 }] },
            { id: 2, type: 'buffer-chest', prototype: 'steel-chest', item_filter: 'iron-gear-wheel', storage_size: 4800 }],
        overrides: { terminal_swing_count: 1, lcm: 1 },
    } satisfies Config);
    expect(await send({ type: 'validate', requestId: 323, config })).toMatchObject({ type: 'validated' });
    const { primary } = await primaryOf(config);
    expect(primary?.alternatives.length).toBeGreaterThan(0);
    const received = await ask({ kind: 'config-file', config: { format: 1, ...config } });
    expect(JSON.stringify(received.setpoint.items_per_second)).toBe('{"numerator":16,"denominator":7}');
});

describe('a pasted blueprint', () => {
    const data = JSON.parse(factorioData) as FactorioData;
    const iron = ironScaffold.trim();
    const noResearch: ImportInputs['research'] = { profile: 'No research', template: 'no-research',
        bonuses: { mining_drill_productivity_bonus: 0, inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0, recipes: {} } };
    const pastedOf = (text: string, answers: Record<string, string> = {}) => ask({ kind: 'pasted-blueprint', text, inputs: { research: noResearch, answers } });
    /** A blueprint string of the JSON, as the game writes it */
    const pack = (json: unknown) => encodeBlueprintFileBrowser(json as Parameters<typeof encodeBlueprintFileBrowser>[0]);
    const unpack = (text: string) => decodeBlueprintFileBrowser(text.trim()) as unknown as { blueprint: { entities: Record<string, unknown>[] } };
    const listsOf = (pasted: { machines: unknown; drills: unknown; inserters: unknown; belts: unknown; chests: unknown }) =>
        ({ machines: pasted.machines, drills: pasted.drills, inserters: pasted.inserters, belts: pasted.belts, chests: pasted.chests });

    it('first asks the drill\'s ore with short lists that each schema takes, then gives the import\'s own lists once it is answered', async () => {
        const first = await pastedOf(iron);
        if (first.kind !== 'build') throw new Error('no build');
        expect(first.questions.map(question => question.kind)).toEqual(['drill-ore']);
        const schemas = [[MachineConfigurationSchema, first.machines], [MiningDrillConfigSchema, first.drills], [InserterConfigSchema, first.inserters],
            [BeltConfigSchema, first.belts], [ChestConfigSchema, first.chests]] as const;
        for (const [schema, list] of schemas) for (const row of list as unknown[]) expect(schema.safeParse(row).success).toBe(true);
        // a short list: what waits on the answer is not in it yet
        expect(first.drills).toEqual([]);
        expect(first.guidance).toEqual(Option.none);

        const answers = { [first.questions[0].key]: 'iron-ore' };
        const second = await pastedOf(iron, answers);
        if (second.kind !== 'build') throw new Error('no build');
        expect(second.questions).toEqual([]);
        const direct = importBlueprint(iron, { research: noResearch, answers }, data);
        if (direct.kind !== 'build') throw new Error('no build');
        // the import's lists as each schema reads them, with its defaults
        const parsed = <T,>(schema: { parse: (row: unknown) => T }, rows: readonly unknown[]) => rows.map(row => schema.parse(row));
        expect(listsOf(second)).toEqual({ machines: parsed(MachineConfigurationSchema, direct.machines), drills: parsed(MiningDrillConfigSchema, direct.drills),
            inserters: parsed(InserterConfigSchema, direct.inserters), belts: parsed(BeltConfigSchema, direct.belts), chests: parsed(ChestConfigSchema, direct.chests) });
        expect(second.drills.map(drill => drill.mined_item_name)).toEqual(['iron-ore']);
        expect(second.suggested_target).toEqual(Option.fromNullable(direct.suggested_target));
        expect({ notes: second.notes, research: second.research, read: second.read, ignored: second.ignored, copy_offset: second.copy_offset, entities: second.entities, speeds: second.speeds })
            .toEqual({ notes: direct.notes, research: direct.research, read: direct.read, ignored: direct.ignored, copy_offset: direct.copy_offset, entities: direct.entities, speeds: direct.speeds });
        expect(second.guidance).toEqual(Option.none);
    });

    it.each([
        ['book', pack({ blueprint_book: { blueprints: [{ index: 0, blueprint: { item: 'blueprint', entities: [] } }], item: 'blueprint-book', version: 562949954076673 } })],
        ['not-a-blueprint', '0notablueprint'],
    ] as const)('gives the problem %s, and no throw', async (problem, text) => {
        expect(await pastedOf(text)).toEqual({ kind: 'problem', problem });
    });

    it('goes on past a chest whose limit leaves it no slot: the chest and the inserters at it are left out, each with a note', async () => {
        const json = unpack(chestChainScaffold);
        const chest = json.blueprint.entities.find(entity => typeof entity.name === 'string' && /-chest$/.test(entity.name) && entity.name !== 'infinity-chest')!;
        chest.bar = 0;
        const pasted = await pastedOf(pack(json));
        if (pasted.kind !== 'build') throw new Error('no build');
        expect(pasted.notes).toContainEqual(expect.objectContaining({ code: 'chest:no-slots', entity_number: chest.entity_number }));
        expect(pasted.chests.map(row => row.position)).not.toContainEqual(chest.position);
    });

    it('puts another profile on a build from its block, and finds the values changed by hand', async () => {
        const answers = { 'drill-ore:1': 'iron-ore' };
        const direct = importBlueprint(iron, { research: noResearch, answers }, data);
        if (direct.kind !== 'build') throw new Error('no build');
        const build = { machines: direct.machines, drills: { configs: direct.drills }, inserters: direct.inserters, belts: direct.belts, chests: direct.chests };
        const choice = { profile: 'Mine', template: null, bonuses: { ...noResearch.bonuses, mining_drill_productivity_bonus: 100, belt_stack_size_bonus: 3 } };
        const applied = await ask({ kind: 'apply-research', build, base: direct.research.base, choice });
        expect(applied).toEqual(applyResearch(build, direct.research.base, choice, data));
        expect(applied.build.drills!.configs.map(drill => drill.productivity)).toEqual(direct.drills.map(drill => drill.productivity + 100));
        const edited = { ...applied.build, research: applied.block, machines: applied.build.machines.map((machine, i) => i === 0 ? { ...machine, productivity: machine.productivity + 7 } : machine) };
        const differences = await ask({ kind: 'research-differences', build: edited });
        expect(differences).toEqual(researchDifferences(edited, data));
        expect(differences.recorded && differences.edited.map(edit => edit.kind)).toEqual(['machine']);
        expect(await ask({ kind: 'research-differences', build })).toEqual({ recorded: false });
    });
});

describe("the format key at the site's doors", () => {
    const build = { setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }], inserters: [], belts: [], chests: [] };
    const failed = async (query: EngineQuery) => {
        const response = await send({ type: 'query', requestId: 91, query });
        expect(response.type).toBe('query-failed');
        return refusedConfigOf(new Error((response as { message: string }).message));
    };

    it('opens a build file of this format, and refuses one without the key or of a newer format before any check', async () => {
        expect((await ask({ kind: 'config-file', config: { format: 1, ...build } })).setpoint.item).toBe('iron-gear-wheel');
        expect(await failed({ kind: 'config-file', config: build })).toBe('old');
        expect(await failed({ kind: 'config-file', config: { format: 2, ...build } })).toBe('newer');
        // an old file the schema would refuse anyway is still refused for its format
        expect(await failed({ kind: 'config-file', config: { target_output: { recipe: 'iron-gear-wheel' } } })).toBe('old');
        expect(REFUSED_CONFIG_ERRORS.old).not.toBe(REFUSED_CONFIG_ERRORS.newer);
    });

    it('refuses a build file of this format that states a belt setting of the overrides, and says to state the end of each lane', async () => {
        for (const overrides of [{ backed_up_belts: true }, { backed_up_belts: false }, { non_moving_belts: true }]) {
            const key = Object.keys(overrides)[0];
            const response = await send({ type: 'query', requestId: 92, query: { kind: 'config-file', config: { format: 1, ...build, overrides } } });
            expect(response.type, key).toBe('query-failed');
            expect((response as { message: string }).message, key).toContain(`\`overrides.${key}\` is not read. State the end of each lane instead`);
        }
    });

    it('loads a saved build of this format, and refuses one without the key or of a newer format', async () => {
        expect(await ask({ kind: 'saved-config', config: { format: 1, ...build } })).toMatchObject({ problem: null });
        expect(await ask({ kind: 'saved-config', config: build })).toMatchObject({ refused: 'old', form: build });
        expect(await ask({ kind: 'saved-config', config: { format: 2, ...build } })).toMatchObject({ refused: 'newer' });
    });

    it('opens what the save, the file export and the share link write: their round trips', async () => {
        const form = { ...createDefaultConfig(), setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 } };
        const reloaded = readSavedBuild(serializeConfig(form));
        expect(await ask({ kind: 'saved-config', config: reloaded })).toMatchObject({ problem: null });
        const exported = JSON.stringify({ format: 1, ...formDataToConfig(form) }, null, 2);
        expect((await ask({ kind: 'config-file', config: readConfigFile(exported) })).setpoint.item).toBe('iron-gear-wheel');
        const link = await encodeShareLink({ name: 'Gears', config: formDataToConfig(form) }, 'https://example.test/');
        const decoded = await decodeShareLink(readShareHash(link.slice(link.indexOf('#'))) as { version: string; data: string });
        expect(decoded.kind).toBe('build');
        const shared = (decoded as { config: unknown }).config;
        expect(Object.keys(shared as object)[0]).toBe('format');
        expect((await ask({ kind: 'config-file', config: readConfigFile(JSON.stringify(shared)) })).setpoint.item).toBe('iron-gear-wheel');
    });
});
