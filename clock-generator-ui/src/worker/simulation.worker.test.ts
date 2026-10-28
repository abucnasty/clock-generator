import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import grenadeSample from '../../../clock-generator/resources/config-samples/real/owner/grenade/grenade.json?raw';
import militarySample from '../../../clock-generator/resources/config-samples/science/military-science/military-science-1-inserter.json?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LATEST_SIDECAR_VERSION, type Config, type DebugSteps } from 'clock-generator/browser';
import type { EngineAnswers, EngineQuery, LiveCoverage, PastedEntities, PrimaryCompletedResponse, ValidationFailedResponse, WorkerRequest, WorkerResponse } from './types';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';
import { applyPaste } from '../utils/pastePreview';
import { buildValidationIssues } from '../utils/buildValidation';

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
const nothingLive: LiveCoverage = { issues: [], refusal: null, pickupNotTested: null, laneSharedByCopies: null, sideLoadedDrop: null,
    lanesExactlyFull: null, copyGapNeeded: null, dropRoom: null, machinePrototypes: [] };

/** The issues the App lists for a live answer, folded in as App.tsx does it, for a build with no field problems or chest issues */
const listed = (live: LiveCoverage, machines: { id: number }[], failure?: { message: string }) => buildValidationIssues({
    fieldProblems: [], chests: [], inserters: [], chestIssues: [], machines, failure,
    coverage: live.issues, scopeRefusal: live.refusal, pickupNotTested: live.pickupNotTested, laneSharedByCopies: live.laneSharedByCopies,
    sideLoadedDrop: live.sideLoadedDrop, lanesExactlyFull: live.lanesExactlyFull, copyGapNeeded: live.copyGapNeeded,
    machinePrototypes: live.machinePrototypes, coverageText: issue => `${issue.kind} ${issue.item_name}`,
});

/** Pastes every kind of entity into a new build and gives the form state the page saves, read back */
const pastedAndSaved = (pasted: PastedEntities) => readSavedConfig(serializeConfig(applyPaste(createDefaultConfig(), pasted,
    { target: false, machines: true, drills: true, inserters: true, belts: true, chests: true })))!;

const noDebug: DebugSteps = { prepare: false, warm_up: false, simulate: false };

/** Plans a generation of the config; the last response the worker posts for it is the primary clock */
async function primaryOf(config: Config, streamLogs = false) {
    const completed = await send({ type: 'plan', runId: 1, config, debugSteps: noDebug, streamLogs });
    expect(completed).toMatchObject({ type: 'primary-completed', runId: 1 });
    return completed as PrimaryCompletedResponse;
}

it('answers output-transfer queries from the engine for both recycler products and their actual separate routes', async () => {
    const config: Config = {
        target_output: { recipe: 'supercapacitor', items_per_second: 1, copies: 1 },
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

it.each(['blocked', 'markers'] as const)('keeps blocked container slots through Sidecar paste (%s), save/reload and engine validation', async spelling => {
    // Sidecar exports both game markers as blocked slots; an export of the 0.20.0 drafts named the marker as the item
    const slot_filters = [{ slot: 1, item: 'iron-plate' }, ...Array.from({ length: 79 }, (_, i) => spelling === 'blocked'
        ? { slot: i + 2, blocked: true } : { slot: i + 2, item: i % 2 ? 'no-item' : 'deconstruction-planner' })];
    const pasted = await ask({
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
    });
    const config = formDataToConfig(pastedAndSaved(pasted));
    config.target_output = { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 };
    expect(config.chests![0]).toEqual({ id: 1, type: 'car',
        slot_filters: [{ slot: 1, item: 'iron-plate' }, ...Array.from({ length: 79 }, (_, i) => ({ slot: i + 2, blocked: true }))] });
    expect(await send({ type: 'validate', requestId: 201, config })).toMatchObject({ type: 'validated' });
});

it('keeps an out-of-order recycler machine target, byproduct belt, and bend capture through Sidecar paste and saved-config mapping', async () => {
    const capture = { status: 'supported' as const, model: 'belt' as const, model_version: 3, entity_type: 'transport-belt',
        entity_name: 'turbo-transport-belt', sidecar_version: '0.15.0' };
    const pasted = await ask({
        kind: 'pasted-entities', sidecar_version: LATEST_SIDECAR_VERSION, suggested_target: undefined, drills: [], chests: [],
        // IDs are deliberately sparse and the target machine precedes the recycler in raw Sidecar export order.
        machines: [
            { id: 44, recipe: 'supercapacitor', crafting_speed: 63.75, productivity: 175, prototype: 'electromagnetic-plant' },
            { id: 8, recipe: 'processing-unit-recycling', crafting_speed: 14.7805, productivity: 0, prototype: 'recycler',
                result_target: { type: 'machine', id: 44 } },
        ],
        belts: [
            { id: 90, type: 'turbo-transport-belt', lanes: [{ ingredient: 'advanced-circuit', stack_size: 4 }] },
            { id: 22, type: 'turbo-transport-belt', lanes: [{ ingredient: 'processing-unit', stack_size: 4 }] },
        ],
        inserters: [
            { id: 31, source: { type: 'machine', id: 8 }, sink: { type: 'belt', id: 90 }, filters: ['advanced-circuit'], prototype: 'stack-inserter', quality: 'legendary' },
            { id: 32, source: { type: 'belt', id: 22, near_lane: 1, pickup_length: 1, pickup_layout: 'bend-right-upstream', pickup_capture: capture },
                sink: { type: 'machine', id: 8 }, filters: ['processing-unit'], prototype: 'stack-inserter', quality: 'legendary' },
        ],
    });
    const roundTripped = formDataToConfig(configToFormData(formDataToConfig(pastedAndSaved(pasted))));
    expect(roundTripped.machines.find(machine => machine.id === 8)?.result_target).toEqual({ type: 'machine', id: 44 });
    expect(roundTripped.inserters.find(inserter => inserter.id === 31)).toMatchObject({ source: { type: 'machine', id: 8 },
        sink: { type: 'belt', id: 90 }, filters: ['advanced-circuit'] });
    expect(roundTripped.inserters.find(inserter => inserter.id === 32)?.source).toMatchObject({ id: 22,
        pickup_layout: 'bend-right-upstream', pickup_capture: capture });
});

describe('repeated units: the real engine separates Check and generation recovery, the recomputed conversion and query failure', () => {
    /** Eight gear assemblers between the same two belts, eight repeated units set as half a copy */
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
    const excessive: Config = { ...source, target_output: { ...source.target_output, items_per_second: 100 } };
    /** Each output inserter drops at a set place on its lane */
    const unsupported: Config = { ...source, inserters: source.inserters.map((inserter, i) => i % 2 === 1
        ? { ...inserter, sink: { type: 'belt', id: 2, drop: { lane: 1, position: 0 } } } : inserter) };
    const unknown: Config = { ...source, machines: source.machines.map(machine => ({ ...machine, recipe: 'not-a-real-recipe' })) };
    const invalidPrototype: Config = { ...source, inserters: source.inserters.map(inserter => ({ ...inserter, prototype: 'not-an-inserter' })) };
    /** One unit, its gears dropped into an infinity chest with no filter */
    const emptyOutput: Config = { ...source, machines: [source.machines[0]],
        inserters: [source.inserters[0], { ...source.inserters[1], sink: { type: 'chest', id: 7 } }],
        chests: [{ id: 7, type: 'infinity-chest', item_filter: [] }] };

    it.each([
        { why: 'the recovery of 8 units as 4 copies', config: source, failure: { recovery: { kind: 'repeated-units',
            sourceConfigKey: JSON.stringify(source), detectedCopies: 8, configuredCopies: 0.5, conversion: { kind: 'available', multiplicity: 8, copies: 4 } } } },
        { why: 'no recovery for an unknown inserter', config: invalidPrototype,
            failure: { message: expect.stringContaining('not-an-inserter'), recovery: undefined } },
        { why: 'a field diagnostic on the chest filter', config: emptyOutput,
            failure: { diagnostics: [{ kind: 'field', path: ['chests', 0, 'item_filter'], message: expect.stringContaining('Remove unfiltered items') }] } },
        { why: 'a coverage diagnostic for no outputs', config: { ...source, inserters: [] },
            failure: { diagnostics: expect.arrayContaining([{ kind: 'coverage', issue: expect.objectContaining({ kind: 'missing_output_inserter' }) }]) } },
    ])('Check fails with $why, and leaves the config as it was', async ({ config, failure }) => {
        const before = structuredClone(config);
        expect(await send({ type: 'validate', requestId: 6, config })).toMatchObject({ type: 'validation-failed', requestId: 6, ...failure });
        expect(config).toEqual(before);
    });

    it('generation stops with the same recovery, as an error of the run, and leaves the config as it was', async () => {
        const before = structuredClone(source);
        expect(await send({ type: 'plan', runId: 1, config: source, debugSteps: noDebug, streamLogs: false }))
            .toMatchObject({ type: 'error', runId: 1, recovery: { conversion: { kind: 'available', copies: 4 } } });
        expect(source).toEqual(before);
    });

    it.each([
        { why: 'gives 4 copies of one unit', config: source, response: { type: 'answer', answer: { kind: 'available',
            plan: { copies: 4, candidate: { machines: [source.machines[0]], target_output: { ...source.target_output, copies: 4 } } } } } },
        { why: 'is refused at Check for a high target', config: excessive, response: { type: 'answer', answer: { kind: 'unavailable',
            stage: 'check', repeatedGroups: 8, reason: { code: 'candidate-check-failed', message: expect.stringContaining("No clock can hold this build's target") } } } },
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

    // a target no clock can hold is the target rate field's problem, in the engine's words
    it('Check marks the target rate field when no clock can hold the target', async () => {
        const unheld: Config = { ...source, target_output: { ...source.target_output, items_per_second: 100, copies: 1 }, machines: [source.machines[0]], inserters: source.inserters.slice(0, 2) };
        const noClock = expect.stringContaining("No clock can hold this build's target");
        expect(await send({ type: 'validate', requestId: 9, config: unheld })).toMatchObject({ type: 'validation-failed', message: noClock,
            diagnostics: [{ kind: 'field', path: ['target_output', 'items_per_second'], message: noClock }] });
    });
});

it('replays detailed activity through the real worker query without changing the saved config', async () => {
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
    expect(await send({ type: 'query', requestId: 40, query: { kind: 'timeline-recording', request: { config, mode: 'plan', period_ticks: 240, terminal_swing_count: 1, windows: {} } } }))
        .toMatchObject({ type: 'answer', requestId: 40, answer: { mode: 'plan', start_tick: 0, end_tick: 240, entities: expect.arrayContaining([expect.objectContaining({ id: 'machine:1', recipe: 'iron-gear-wheel' })]) } });
    expect(JSON.stringify(config)).toBe(before);
});

describe('a captured inserter kind, quality and filter mode', () => {
    // An export of the current Sidecar (its pickups captured as 0.11.0 captures them): a legendary stack inserter picks up from a straight belt, a normal fast inserter empties the machine
    const pickup = { type: 'belt', id: 1, near_lane: 1, pickup_length: 1, pickup_layout: 'side-straight', pickup_capture: { status: 'supported',
        entity_type: 'transport-belt', entity_name: 'turbo-transport-belt', sidecar_version: '0.11.0', model: 'belt', model_version: 2 } };
    const exported = (input: object = {}, output: object = {}) => ({
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
        const pasted = await ask(query);
        expect(pasted.guidance).toMatchObject({ _tag: 'None' });
        const saved = formDataToConfig(pastedAndSaved(pasted));
        expect((await ask({ kind: 'saved-config', config: saved })).problem).toBeNull();
        return { ...formDataToConfig(configToFormData(saved)), target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 } } as Config;
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
    ])('keeps $name through paste, save and reload, and refuses it live and in Check only when out of scope', async ({ input, output, kept, refusal }) => {
        const config = await pastedSavedReloaded(exported(input, output));
        expect(config.inserters).toMatchObject(kept);
        const blocking = listed(await coverageOf(config), config.machines).filter(issue => issue.blocksGeneration);
        expect(blocking.map(({ source, text }) => ({ source, text }))).toEqual(refusal ? [{ source: 'engine', text: expect.stringContaining(refusal) }] : []);
        expect(await send({ type: 'validate', requestId: 52, config }))
            .toMatchObject(refusal ? { type: 'validation-failed', message: expect.stringContaining(refusal) } : { type: 'validated' });
    });

    it('lists the refused blacklist once when a Check stopped at the same refusal', async () => {
        const config = await pastedSavedReloaded(exported({}, blacklist));
        const checked = await send({ type: 'validate', requestId: 54, config }) as ValidationFailedResponse;
        expect(listed(await coverageOf(config), config.machines, { message: checked.message })).toHaveLength(1);
    });
});

describe('live advice on a gear assembler, which does not block', () => {
    /** A gear assembler fed by a legendary stack inserter with its full hand, from a belt of the given stack size */
    const gears = ({ stack_size = 4, ...target }: { stack_size?: number } & Partial<Config['target_output']> = {}) => ({
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1, ...target },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: 'belt', id: 1, pickup_length: 1 }, sink: { type: 'machine', id: 1 } },
            { id: 2, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 } },
        ],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size }] }],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
    } as Config);
    /** The engine's warning for gears({ stack_size: 2 }), live and in the generation log */
    const pickupNotTested = 'Not tested: Inserter 1 picks up iron-plate from belt 1 in 2-item belt stacks. Belt pickup timing is calibrated '
        + 'with 16-item hands on 4-item belt stacks only; at other belt stack sizes and hand sizes it has not been compared with the '
        + 'game, so the clock may not match the game.';

    it.each([
        { name: 'a belt pickup of untested timing', config: gears({ stack_size: 2 }), field: 'pickupNotTested', source: 'calibration',
            warning: pickupNotTested },
        // 100 copies of a gear assembler, each taking 1.5 iron plates a second, if they shared a lane that carries 120
        { name: 'a lane the copies ask too much of', config: gears({ items_per_second: 75, copies: 100 }),
            field: 'laneSharedByCopies', source: 'lanes',
            warning: 'If the 100 copies share lane 1 of belt 1, they take 1.25 times what it carries (100 × 1.5 = 150 a second, of 120). '
                + 'The config cannot say yet whether its copies share these lanes, so this is only a warning: a build whose copies have '
                + 'belts of their own is not affected.' },
    ] as const)('warns live of $name, and Check goes on', async ({ config, field, source, warning }) => {
        const live = await coverageOf(config);
        expect(live).toEqual({ ...nothingLive, [field]: warning });
        expect(listed(live, config.machines).map(({ source, severity, blocksGeneration, text }) => ({ source, severity, blocksGeneration, text })))
            .toEqual([{ source, severity: 'warning', blocksGeneration: false, text: warning }]);
        expect(await send({ type: 'validate', requestId: 61, config })).toMatchObject({ type: 'validated' });
    });

    it('says nothing of a pickup from 4-item belt stacks, and notes a drop the Sidecar marked as side-loading', async () => {
        expect(await coverageOf(gears())).toEqual(nothingLive);
        // the live answer carries the note as the log and the result say it, and blocks nothing
        const fed = gears();
        const marked = { ...fed, inserters: [fed.inserters[0], { ...fed.inserters[1], sink: { type: 'belt', id: 2, drop_capture: { status: 'side-loaded', tiles: 3 } } }],
            belts: [...fed.belts, { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-gear-wheel', stack_size: 4 }] }] } as Config;
        expect((await coverageOf(marked)).sideLoadedDrop).toBe('Inserter 2 drops onto a 3 tile belt buffer that side-loads onto another belt. '
            + 'The clock may make less in the game than shown here, most of all when these inserters are switched on at the same time as others '
            + 'that drop onto the belt. Give each of these drops a belt of its own, or check the clock in the game.');
    });

    it('logs the untested belt pickup in generation, as it warns of it live, and makes the clock with it as an insight', async () => {
        const { primary } = await primaryOf(gears({ stack_size: 2 }), true);
        expect(primary?.alternatives[0].insights.filter(insight => insight.id === 'belt-pickup-not-tested')).toHaveLength(1);
        const warned = posted.flatMap(response => response.type === 'log' ? response.messages : []).filter(message => message.level === 'warn');
        expect(warned.map(message => message.message)).toEqual([pickupNotTested]);
    });
});

it("gives the crafting machines, fills a prototype's rule on import and paste, and warns live of a machine that cannot make its recipe", async () => {
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

    const live = await coverageOf({ ...config, machines: [{ ...furnace, prototype: 'cryogenic-plant' }] } as Config);
    expect(live.machinePrototypes.map(issue => issue.kind)).toEqual(['recipe-not-made']);
    expect(listed({ ...nothingLive, machinePrototypes: live.machinePrototypes }, [{ id: 1 }])
        .map(({ source, severity, blocksGeneration, fieldTarget }) => ({ source, severity, blocksGeneration, fieldTarget })))
        .toEqual([{ source: 'machine', severity: 'warning', blocksGeneration: false, fieldTarget: { kind: 'machine-recipe', machineId: 1 } }]);
});

it('says live whether the copies\' drops fit at the gap given, for the period estimated from the settings', async () => {
    const live = (copy_offset: { x: number; y: number } | undefined) => {
        const grenade = JSON.parse(grenadeSample) as Config;
        return coverageOf({ ...grenade, target_output: { ...grenade.target_output, copy_offset } });
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
    const { primary } = await primaryOf(JSON.parse(militarySample) as Config);
    expect(primary?.alternatives.map(it => [it.id, it.deciders])).toEqual([['planned-belt-slack', 5]]);
    expect(primary?.also?.flatMap(run => run.alternatives.map(it => [it.id, it.deciders, it.verdict]))).toEqual([['planned-belt-slack-shared', 4, 'stable']]);
}, 30_000);

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
