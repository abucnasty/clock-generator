import { canonicalRate, Option } from 'clock-generator/light';
import { missingDataSections, type InternalError } from '../utils/internalError';
/**
 * Web Worker for running clock-generator simulation.
 *
 * The main thread runs a pool of these: one plans a generation (the primary alternative and the task list),
 * then every worker takes tasks (one alternative each) until all are done. Logs and progress stream back.
 * One more answers the main thread's queries (see EngineQuery), as only the workers load the engine.
 */

import type { z } from 'zod';
import type { SetpointReason } from 'clock-generator/light';
import type { ClockAlternativeRun, Config, DebugSteps, FactorioData, LogMessage, Logger, MachineToName, NotMadeClock, SearchRangeEdge } from 'clock-generator/browser';
import { parseFormConfig } from './formConfig';
import { laneRolesAnswer } from './laneRoles';
import { laneTakersOf } from '../utils/laneTakers';
import { installFactsOf } from './installFacts';
import { createReadyGate } from './requestGate';
import { NO_NAMES, hiddenRecipeIds, type GameNames } from '../utils/gameNames';
import type { CheckedRepeatedUnitConversion, RepeatedUnitsRecovery, CheckedShiftRow, ClockAlternativeRunView, ClockAlternativeView, EngineAnswers, EngineQuery, FactorioLookups, FuelViewData, ShiftOptionsView, ShiftRangeEdge, WorkerRequest, WorkerResponse } from './types';
import { REFUSED_CONFIG_ERRORS } from './types';

type ClockGenerator = typeof import('clock-generator/browser');

// imported dynamically in the worker context
let clockGenerator: ClockGenerator;
let liveCoverage: ReturnType<ClockGenerator['createInserterCoverageValidator']>;
/** The data's in-game names, kept here so that the main thread does not parse the whole data for them */
let gameNames: GameNames = NO_NAMES;
/** The recipes the data marks hidden, which the pickers leave out */
let hiddenRecipes: string[] = [];
/** The sections the loaded game data lacks, for telling a data file of another version from a bug */
let missingSections: string[] = [];
/** The loaded game data, which the blueprint import and research read as an argument */
let gameData: FactorioData;

const LOG_FLUSH_INTERVAL_MS = 100;

const ctx: Worker = self as unknown as Worker;

// a worker started in place of a cancelled or crashed one gets its requests before it has loaded the data
const gate = createReadyGate();

function postResponse(response: WorkerResponse): void {
    ctx.postMessage(response);
}

async function handleInitialize(factorioData: string): Promise<void> {
    try {
        // Dynamically import the clock-generator browser module
        clockGenerator = await import('clock-generator/browser');

        const parsed = JSON.parse(factorioData);
        clockGenerator.FactorioDataService.initialize(parsed);
        gameData = parsed as FactorioData;
        liveCoverage = clockGenerator.createInserterCoverageValidator();
        missingSections = missingDataSections(parsed);
        gameNames = parsed.names ?? NO_NAMES;
        hiddenRecipes = hiddenRecipeIds(parsed.recipe);

        gate.open();
        postResponse({ type: 'initialized' });
    } catch (error) {
        gate.fail(error instanceof Error ? error : new Error('Failed to initialize worker'));
        postResponse({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to initialize worker',
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
}

function shiftOptionsOf(result: ClockAlternativeRun['alternatives'][number]['result']): ShiftOptionsView | null {
    const search = result.search;
    if (!search || search.picked === null || (search.kind !== 'shifted cycle' && search.kind !== 'moved output swing')) {
        return null;
    }
    const rows = new Map<number, CheckedShiftRow>();
    for (const candidate of search.candidates) {
        const row = rows.get(candidate.row) ?? { index: candidate.row, shifts: [] };
        row.shifts.push({ shift_ticks: candidate.setting, holds: candidate.holds });
        rows.set(candidate.row, row);
    }
    const edge = (it: SearchRangeEdge | undefined): ShiftRangeEdge | null => it ? { shift_ticks: it.setting, is_search_limit: it.is_search_limit, notes: it.notes } : null;
    const shifted = search.kind === 'shifted cycle';
    return {
        moved: shifted ? 'swings' : 'output-swing',
        chosenIndex: search.picked.row,
        chosenShiftTicks: search.picked.setting,
        movedDescription: shifted
            ? (search.moved ?? []).map(it => `${it.entity_id.type} ${it.entity_id.number}: ${it.item_names.map(clockGenerator.textWords().item).join(', ')}`).join('; ')
            : `output swing ${search.picked.row}`,
        plannedTicks: shifted ? search.planned_ticks ?? null : null,
        rows: Array.from(rows.values()),
        earliest: edge(search.earliest),
        latest: edge(search.latest),
    };
}

/** The machines of a config as its texts name them: number, prototype and recipe */
function machinesToName(config: Config): MachineToName[] {
    return config.machines.map(machine => ({ id: machine.id, ...(machine.prototype !== undefined && { prototype: machine.prototype }), recipe: machine.recipe }));
}

/** The fuel plan with the part of the fuel run the page draws: the fuel levels and the fuel inserters' swings */
function fuelViewOf(result: ClockAlternativeRun['alternatives'][number]['result'], config: Config): FuelViewData | null {
    if (!result.fuel_plan) {
        return null;
    }
    const view = result.fuel_consumption_view;
    return {
        plan: result.fuel_plan,
        machines: machinesToName(config),
        entityNames: clockGenerator.entityNamesInSentence(config),
        run: view ? {
            window_cycles: view.window_cycles,
            durationTicks: view.duration_ticks,
            fuelSwingsRecorded: view.fuel_swings_recorded,
            ranOutOfFuel: view.ran_out_of_fuel,
            levels: view.fuel_levels,
            swings: Object.fromEntries(view.transfer_history.entities
                .filter(entity => view.fuel_inserter_ids.includes(entity.entity_id))
                .map(entity => [entity.entity_id, entity.transfers.map(transfer => (
                    { start: transfer.start_tick, end: transfer.end_tick, amount: transfer.amount }
                ))])),
        } : null,
    };
}

function toRunView(run: ClockAlternativeRun | null, config: Config): ClockAlternativeRunView | null {
    if (!run) {
        return null;
    }
    // the belts, inserters, chests and drills as the texts name them, by their items (the engine's entity-name.ts)
    const names = clockGenerator.buildToNameOf(config);
    const entityNames = clockGenerator.entityNamesInSentence(config);
    // every lane of the build once, which the rows of a clock's checked lanes are read with
    const lanes = clockGenerator.buildLanesOf(config);
    const alternatives: ClockAlternativeView[] = run.alternatives.map(({ result, ...alternative }) => ({
        id: alternative.id,
        label: alternative.label,
        description: alternative.description,
        inserterWindowCount: alternative.inserter_window_count,
        deciders: alternative.deciders,
        rankingWindowCount: alternative.ranking_window_count,
        assessment: alternative.assessment,
        assumptions: {
            machines: machinesToName(config),
            entityNames,
            lanes,
            laneTakers: laneTakersOf(config),
            machineOfInserter: Object.fromEntries(config.inserters.flatMap((inserter, index) =>
                inserter.sink.type === 'machine' ? [[inserter.id ?? index + 1, inserter.sink.id]] : [])),
            kickStarts: result.machine_facts.flatMap(machine => machine.facts.inputs
                .filter(input => clockGenerator.FactorioDataService.findRecipeOrThrow(machine.facts.recipe).results.some(output => output.name === input.item_name))
                .map(input => ({ machineId: machine.entity_id, item: input.item_name,
                    items: config.overrides?.kick_start_items ?? clockGenerator.DEFAULT_KICK_START_ITEMS }))),
            outputDrops: [...new Set(config.inserters.filter(ins => ins.sink.type === 'belt').map(ins => ins.sink.id))]
                .map(beltId => {
                    const inserters = config.inserters.filter(ins => ins.sink.type === 'belt' && ins.sink.id === beltId);
                    return { beltId, inserterIds: inserters.map(ins => ins.id ?? config.inserters.indexOf(ins) + 1),
                        mode: inserters.every(ins => ins.sink.type === 'belt' && ins.sink.drop !== undefined) ? 'shared-lanes' as const : 'free-lane' as const };
                }),
            overrides: config.overrides,
            machineFuel: config.machines.flatMap(machine => machine.fuel === undefined ? [] : [{ machineId: machine.id, fuel: machine.fuel }]),
        },
        copies: result.output_cycle_plan.production_rate.copies,
        ...(config.setpoint.counts === 'destroyed' && { counts: 'destroyed' as const }),
        verdict: alternative.verdict,
        ranking: alternative.ranking,
        deadlockRisk: clockGenerator.deadlockRiskNote(alternative.deadlock_risks, names),
        ...(alternative.checked_lanes !== undefined && { checkedLanes: alternative.checked_lanes }),
        ...(alternative.shared_lane_loss_note !== undefined && { sharedLaneLossNote: alternative.shared_lane_loss_note }),
        beltLabel: clockGenerator.clockBeltLabel(alternative.belt),
        belt: alternative.belt,
        asBuilt: result.stability_check.as_built ?? null,
        expectedOutputItems: result.stability_check.expected_output_items,
        terminalSwingCount: result.used_terminal_swing_count,
        cycleTicks: result.output_cycle_plan.total_duration.ticks,
        blueprintString: clockGenerator.encodeBlueprintFileBrowser(clockGenerator.blueprintFileFor(result)),
        install: installFactsOf(result),
        transferHistory: result.serializable_transfer_history,
        // the columns go as they are, copied by the structured clone (never transferred: alternatives share them)
        stateTransitionHistory: clockGenerator.toPortable(result.serializable_state_transition_history),
        fuelView: fuelViewOf(result, config),
        clockWindows: result.clock_windows,
        alwaysOnReasons: result.always_on_reasons ?? {},
        insights: alternative.insights,
        shiftOptions: shiftOptionsOf(result),
        simulationDurationTicks: result.simulation_duration.ticks,
        ...(alternative.rounded && { roundedWindowCycleTicks: alternative.rounded.window_cycle_ticks, roundedRunsFast: alternative.rounded.runs_fast }),
        strategy: alternative.strategy,
        swingBackoffReport: result.swing_backoff_report ?? null,
        inserterClocks: result.unplanned_inserter_clocks ?? {},
        backedUpBelts: alternative.belt?.kind === 'backed_up',
        replayReadsConfig: true,
    }));
    // the same clock made with shared windows, listed after it
    const also = run.also?.flatMap(it => toRunView(it, config) ?? []);
    // the clocks the run made, for the per-branch clock that is made from them
    return { signature: run.signature, alternatives, ...(also?.length ? { also } : {}), ...(run.parts !== undefined && { parts: run.parts }) };
}

/** Runs one plan or task with streamed logs and progress; errors are posted instead of thrown */
function runStreaming(
    runId: number,
    debugSteps: DebugSteps,
    streamLogs: boolean,
    work: (options: import('clock-generator/browser').GenerateClockOptions) => WorkerResponse,
): void {
    try {
        // Logs arrive far faster than the UI needs them, so post them in batches
        let pending_logs: LogMessage[] = [];
        let last_flush = 0;
        const flushLogs = () => {
            if (pending_logs.length > 0) {
                postResponse({ type: 'log', runId, messages: pending_logs });
                pending_logs = [];
            }
            last_flush = Date.now();
        };
        const logger: Logger = streamLogs
            ? new clockGenerator.StreamingLogger((message) => {
                pending_logs.push(message);
                if (Date.now() - last_flush >= LOG_FLUSH_INTERVAL_MS) {
                    flushLogs();
                }
            })
            : { log() { }, warn() { }, debug() { }, error: (message) => console.error(message) };
        const response = work({
            debug: clockGenerator.DebugSettingsProvider.mutable(),
            debug_steps: debugSteps,
            logger,
            on_progress_detail: (detail) => {
                flushLogs();
                postResponse({ type: 'progress', runId, detail });
            },
        });
        flushLogs();
        postResponse(response);
    } catch (error) {
        const failure = failureOf(error, 'Generate failed');
        postResponse({
            type: 'error',
            runId,
            ...failure,
        });
    }
}

function handleValidate(requestId: number, given: Config): void {
    try {
        const config = engineBuildOf(given);
        requireValidConfig(config);
        const validation = clockGenerator.validateConfig(config);
        // a build of several identical copies is clocked as given; Build check notes it, with one copy where it can be offered
        const repeated = clockGenerator.findRepeatedUnits(config);
        // the offer is of the build as the form holds it, which the page matches it with and writes the conversion into
        const recovery = repeated.gcd > 1 ? repeatedUnitsRecoveryOf(repeated.copies, given) : undefined;
        postResponse({ type: 'validated', requestId, validation, ...(recovery && { recovery }) });
    } catch (error) {
        const { message } = failureOf(error, 'Check failed');
        postResponse({
            type: 'validation-failed',
            requestId,
            message,
            internal: isEngineRefusal(error) ? undefined : internalErrorOf(error),
            diagnostics: error instanceof clockGenerator.InserterCoverageError
                ? error.issues.map(issue => ({ kind: 'coverage' as const, issue }))
                // inserters that take from a belt and drop where a belt pickup cannot: the text once, and the inserters it names
                : error instanceof clockGenerator.BeltPickupSinkError
                    ? [{ kind: 'inserters' as const, ids: error.inserter_ids, message: error.message }]
                : error instanceof clockGenerator.ConfigValidationError
                    ? error.zodError.issues.map(issue => ({ kind: 'field' as const, path: issue.path as (string | number)[], message: issue.message, ...reasonOf(issue) }))
                    // a build no clock can hold: its opening once, and each problem the engine found on its own
                    : error instanceof clockGenerator.FeasibilityError
                        ? [{ kind: 'refusal' as const, opening: error.opening, problems: error.problems }]
                        : error instanceof Error && error.message.startsWith('The current configuration cannot meet the setpoint.')
                            ? [{ kind: 'refusal' as const, problems: [error.message] }]
                            : undefined,
        });
    }
}

/**
 * Whether the engine refused the build with text for the user; anything else is an unexpected error.
 *
 * The engine's refusals are plain `Error`s today (the inserter-scope, planning and output-transfer refusals name the
 * inserter, machine or target), next to its own classes. So an error is internal only when it is not an `Error` at all
 * or is one of JavaScript's built-in subclasses, which the engine never throws on purpose: a bug or a data file of
 * another version. A typed base class for every engine refusal would make this exact instead of by exclusion.
 */
function isEngineRefusal(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error instanceof clockGenerator.ConfigValidationError
        || error instanceof clockGenerator.InserterCoverageError
        || error instanceof clockGenerator.FeasibilityError
        || error instanceof clockGenerator.LaneCapacityError
        || error instanceof clockGenerator.AssertionError) return true;
    return !BUILT_IN_ERRORS.some(builtIn => error instanceof builtIn);
}

const BUILT_IN_ERRORS = [TypeError, ReferenceError, RangeError, SyntaxError, EvalError, URIError];

function internalErrorOf(error: unknown): InternalError {
    return { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
        dataMismatch: missingSections.length > 0 };
}

/**
 * The build as the engine reads it: a setpoint that the site's picker named by a recipe counts that recipe's main product.
 * The form keeps the name it was given, so only what goes to the engine is read this way.
 */
function engineBuildOf(config: Config): Config {
    return canonicalRate(clockGenerator.readRecipeSetpointAsItem(config)) as Config;
}

/** Planning and Check share the strict schema; editable persisted drafts do not bypass spatial constraints. */
function requireValidConfig(config: Config): void {
    const parsed = clockGenerator.ConfigSchema.safeParse(config);
    if (!parsed.success) throw new clockGenerator.ConfigValidationError(parsed.error, config);
}

function checkRepeatedUnitConversion(config: Config): CheckedRepeatedUnitConversion {
    const plan = clockGenerator.planRepeatedUnitConversion(config);
    // the test Check refuses a build with copies inside it by
    const repeatedGroups = () => Math.max(1, clockGenerator.findRepeatedUnits(config).gcd);
    if (plan.kind === 'unavailable') return { kind: 'unavailable', stage: 'proof', reason: plan.reason, repeatedGroups: repeatedGroups() };
    try {
        requireValidConfig(plan.candidate);
        return { kind: 'available', plan, validation: clockGenerator.validateConfig(engineBuildOf(plan.candidate)) };
    } catch (error) {
        // Planning's existing assertion type includes target-capacity/period refusals, and the feasibility pass refuses
        // a target no clock could carry. Untyped errors and native programmer failures must remain query-failed, never a
        // structural diagnosis.
        if (!(error instanceof clockGenerator.ConfigValidationError)
            && !(error instanceof clockGenerator.InserterCoverageError)
            && !(error instanceof clockGenerator.FeasibilityError)
            && !(error instanceof clockGenerator.AssertionError)) throw error;
        return { kind: 'unavailable', stage: 'check', reason: { code: 'candidate-check-failed',
            message: error instanceof Error ? error.message : 'The check failed.' }, repeatedGroups: repeatedGroups() };
    }
}

function repeatedUnitsRecoveryOf(units: readonly { machine_ids: readonly number[] }[], config: Config): RepeatedUnitsRecovery {
    const checked = checkRepeatedUnitConversion(config);
    return {
        kind: 'repeated-units', sourceConfigKey: JSON.stringify(canonicalRate(config)),
        detectedCopies: units.length, configuredCopies: config.setpoint.copies,
        units: units.map(unit => ({ machine_ids: [...unit.machine_ids] })),
        conversion: checked.kind === 'available'
            ? { kind: 'available', multiplicity: checked.plan.multiplicity, copies: checked.plan.copies }
            : { kind: 'unavailable', stage: checked.stage, code: checked.reason.code, message: checked.reason.message },
    };
}

/** The message of a failed Check or run, with its stack */
function failureOf(error: unknown, fallback: string): { message: string; stack?: string } {
    return { message: error instanceof Error ? error.message : fallback, stack: error instanceof Error ? error.stack : undefined };
}

/** The engine's reason for a refused setpoint, where the issue carries one */
function reasonOf(issue: object): { reason?: SetpointReason } {
    const reason = (issue as { params?: { reason?: SetpointReason } }).params?.reason;
    return reason === undefined ? {} : { reason };
}

function lookups(): FactorioLookups {
    const data = clockGenerator.FactorioDataService;
    const recipeNames = data.getAllRecipeNames();
    const recipes: FactorioLookups['recipes'] = new Map();
    for (const name of recipeNames) {
        try {
            const recipe = data.findRecipeOrThrow(name);
            recipes.set(name, {
                ingredients: recipe.ingredients.map(ing => ing.name),
                results: recipe.results.map(res => res.name),
                output: clockGenerator.setpointOutputOf(name) ?? undefined,
            });
        } catch {
            // a recipe the generator cannot use has no info
        }
    }
    const recipeCategories: Record<string, string[]> = {};
    for (const recipe of data.getAllRecipes()) recipeCategories[recipe.name] = recipe.categories;
    const craftingMachines = { machines: data.getAllCraftingMachines(), recipeCategories };
    return { recipeNames, itemNames: data.getAllItemNames(), resourceNames: data.getAllResourceNames(), recipes, names: gameNames, hiddenRecipes, craftingMachines };
}

/** Validate each entry of a pasted list, throwing on the first one the schema rejects */
function validateEntries<T>(schema: z.ZodType<T>, entries: unknown, label: string): T[] {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry, i) => {
        const result = schema.safeParse(entry);
        if (!result.success) {
            throw new Error(`Invalid ${label} at index ${i}: ${result.error.issues[0]?.message || 'Unknown error'}`);
        }
        return result.data;
    });
}

/**
 * A pasted blueprint, through the import: each list checked against its schema on every call. The import writes each
 * pickup's capture itself.
 */
function pastedBlueprint(pasted: Extract<EngineQuery, { kind: 'pasted-blueprint' }>): EngineAnswers['pasted-blueprint'] {
    const outcome = clockGenerator.importBlueprint(pasted.text, pasted.inputs, gameData);
    if (outcome.kind === 'problem') return outcome;
    return {
        kind: 'build',
        machines: validateEntries(clockGenerator.MachineConfigurationSchema, outcome.machines, 'machine'),
        drills: validateEntries(clockGenerator.MiningDrillConfigSchema, outcome.drills, 'drill'),
        inserters: validateEntries(clockGenerator.InserterConfigSchema, outcome.inserters, 'inserter'),
        belts: validateEntries(clockGenerator.BeltConfigSchema, outcome.belts, 'belt'),
        chests: validateEntries(clockGenerator.ChestConfigSchema, outcome.chests, 'chest'),
        guidance: Option.none,
        suggested_target: Option.fromNullable(outcome.suggested_target),
        questions: outcome.questions,
        notes: outcome.notes,
        read: outcome.read,
        ignored: outcome.ignored,
        research: outcome.research,
        copy_offset: outcome.copy_offset,
        layout: outcome.layout,
        entities: outcome.entities,
        speeds: outcome.speeds,
    };
}

/** The saved form state, and why it cannot be loaded, or null when it can */
function savedConfig(config: unknown): EngineAnswers['saved-config'] {
    const refused = clockGenerator.configFormatProblem(config);
    if (refused !== null) return { problem: refused === 'old' ? 'made before this format' : 'made by a newer version of the site', form: config, refused };
    // the format is of the saved text; the form state loaded has none
    const { format: _format, ...form } = config as Record<string, unknown>;
    void _format;
    const result = parseFormConfig(clockGenerator.ConfigSchema, form);
    return result.success ? { problem: null, form: canonicalRate(form) } : { problem: result.error.message, form };
}

/**
 * An imported config file, which can hold what the form exports, e.g. an inserter end left unset. A file without this
 * format's `format` key, or with a newer one, is refused before any check.
 */
function configFile(config: unknown): EngineAnswers['config-file'] {
    const refused = clockGenerator.configFormatProblem(config);
    if (refused !== null) throw new Error(REFUSED_CONFIG_ERRORS[refused]);
    const result = parseFormConfig(clockGenerator.ConfigSchema, config);
    if (!result.success) {
        throw new clockGenerator.ConfigValidationError(result.error);
    }
    return withSetpointNameOf(result.data, config);
}

/** The setpoint of an imported file as the file names it: the schema reads a recipe's name as its item, and the form keeps the name */
function withSetpointNameOf(read: Config, file: unknown): Config {
    const record = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
    const given = record(file);
    const name = record(given?.setpoint)?.item;
    return typeof name === 'string' ? { ...read, setpoint: { ...read.setpoint, item: name } } : read;
}

/** The inserters a note on lanes is about, each once, in order; none where the lanes cannot be read, as the note then says nothing */
function insertersOf(lanes: () => readonly { inserter_ids: readonly number[] }[]): number[] {
    try {
        return [...new Set(lanes().flatMap(lane => lane.inserter_ids))].sort((a, b) => a - b);
    } catch {
        return [];
    }
}

function answer(asked: EngineQuery): EngineAnswers[EngineQuery['kind']] {
    // an imported or saved config, and the conversion of repeated units, are of the form's own state, which keeps the name that the setpoint was given
    const query = 'config' in asked && !['saved-config', 'config-file', 'repeated-unit-conversion'].includes(asked.kind)
        ? { ...asked, config: engineBuildOf(asked.config as Config) } : asked;
    switch (query.kind) {
        case 'timeline-recording':
            return clockGenerator.recordSimulationTimeline(query.request);
        case 'lookups':
            return lookups();
        case 'machine-facts':
            try {
                return clockGenerator.computeMachineFacts(query.params);
            } catch {
                return null;
            }
        case 'inserter-coverage': {
            // what is out of scope is refused before coverage, as Check does: read as built, a blacklist or a side stream
            // would be explained as a missing inserter
            const refusal = clockGenerator.insertersScopeProblem(query.config);
            // the data of the side-loaded drops and the untested pickups, which the site words; the words of the others, with
            // the inserters they are about
            const pickupsNotTested = clockGenerator.uncalibratedBeltPickups(query.config);
            const laneSharedByCopies = clockGenerator.laneSharedByCopiesWarning(query.config);
            const laneSharedByCopiesInserters = laneSharedByCopies === null ? [] : insertersOf(() => clockGenerator.lanesSharedByCopies(query.config));
            const sideLoadedDrops = clockGenerator.sideLoadedDrops(query.config);
            const lanesExactlyFull = clockGenerator.lanesExactlyFullWarning(query.config);
            const lanesExactlyFullInserters = lanesExactlyFull === null ? [] : insertersOf(() => clockGenerator.lanesExactlyFull(query.config));
            const copyGapNeeded = clockGenerator.copyGapNeededNote(query.config);
            const dropRoom = clockGenerator.dropRoomNote(query.config);
            const machinePrototypes = clockGenerator.machinePrototypeIssues(query.config);
            const refusal_inserters = clockGenerator.beltPickupSinkRefusal(query.config)?.inserter_ids ?? [];
            return { issues: refusal === null ? liveCoverage(query.config) : [], refusal, refusal_inserters, pickupsNotTested, laneSharedByCopies,
                laneSharedByCopiesInserters, sideLoadedDrops, lanesExactlyFull, lanesExactlyFullInserters, copyGapNeeded, dropRoom, machinePrototypes };
        }
        case 'machine-target-rates':
            return clockGenerator.computeMachineTargetRates(query.config);
        case 'target-rate-max':
            return clockGenerator.targetRateMaxOf(query.config);
        case 'output-transfers':
            return {
                transfers: clockGenerator.deriveOutputTransfers(query.config),
                generation_issues: clockGenerator.outputTransferGenerationIssues(query.config),
            };
        case 'region-orbits':
            return clockGenerator.regionOrbitsOfConfig(query.config);
        case 'repeated-unit-conversion':
            return checkRepeatedUnitConversion(query.config);
        case 'lane-roles':
            return laneRolesAnswer(query.config, clockGenerator.laneFactsOfConfig(query.config));
        case 'saved-config':
            return savedConfig(query.config);
        case 'config-file':
            return configFile(query.config);
        case 'pasted-blueprint':
            return pastedBlueprint(query);
        case 'apply-research':
            return clockGenerator.applyResearch(query.build, query.base, query.choice, gameData);
        case 'research-differences':
            return clockGenerator.researchDifferences(query.build, gameData);
    }
}

function handleQuery(requestId: number, query: EngineQuery): void {
    try {
        postResponse({ type: 'answer', requestId, answer: answer(query) });
    } catch (error) {
        postResponse({
            type: 'query-failed',
            requestId,
            message: error instanceof Error ? error.message : 'The engine could not answer',
        });
    }
}

function handlePlan(runId: number, asked: Config, debugSteps: DebugSteps, streamLogs: boolean): void {
    runStreaming(runId, debugSteps, streamLogs, (options) => {
        const given = engineBuildOf(asked);
        requireValidConfig(given);
        // the build that is clocked, which the clocks and their views are of: outside supply gets no window
        const config = clockGenerator.withoutOutsideSupply(given);
        const notMade: NotMadeClock[] = [];
        // the tasks go out as soon as the primary clock is made: the pool runs them while this worker assesses it
        // where the build has repeated groups of machines, the region step is the last task
        const plan = clockGenerator.planClockAlternatives(config, { ...options, on_not_made: clock => notMade.push(clock) }, (context, tasks, primarySignature) => postResponse({
            type: 'planned', runId, context, tasks: [...tasks, ...[clockGenerator.regionLayerTaskOf(context) ?? []].flat()], primarySignature,
            assumptions: { startDependenceRequested: config.overrides?.check_start_dependence === true },
        }));
        return { type: 'primary-completed', runId, primary: toRunView(plan.primary, config), notMade };
    });
}

function handleTask(
    runId: number,
    asked: Config,
    debugSteps: DebugSteps,
    streamLogs: boolean,
    context: import('clock-generator/browser').ClockAlternativeContext,
    taskId: string,
    assessedSignatures: string[] = [],
    coordinatedSources?: import('clock-generator/browser').CoordinatedSourcesInput,
    regionLayer?: import('clock-generator/browser').RegionLayerInput,
): void {
    runStreaming(runId, debugSteps, streamLogs, (options) => {
        const given = engineBuildOf(asked);
        requireValidConfig(given);
        // the build that is clocked, which the clocks and their views are of: outside supply gets no window
        const config = clockGenerator.withoutOutsideSupply(given);
        const notMade: NotMadeClock[] = [];
        // the per-branch clock is made from the parts of the runs before it, not from the context
        const onNotMade = (clock: NotMadeClock) => notMade.push(clock);
        const run = regionLayer !== undefined
            ? clockGenerator.runRegionLayerTask(config, regionLayer, { ...options, on_not_made: onNotMade }, assessedSignatures)
            : coordinatedSources !== undefined
                ? clockGenerator.runCoordinatedSourcesTask(config, coordinatedSources, { ...options, on_not_made: onNotMade }, assessedSignatures, context.regions)
                : clockGenerator.runClockAlternativeTask(config, context, taskId, { ...options, on_not_made: onNotMade }, assessedSignatures);
        return { type: 'task-completed', runId, taskId, run: toRunView(run, config), notMade };
    });
}

/** The answer to a request that could not run because the worker never loaded the data */
function failedRequest(request: Exclude<WorkerRequest, { type: 'initialize' }>, message: string): WorkerResponse {
    switch (request.type) {
        case 'validate':
            return { type: 'validation-failed', requestId: request.requestId, message };
        case 'query':
            return { type: 'query-failed', requestId: request.requestId, message };
        case 'plan':
        case 'task':
            return { type: 'error', runId: request.runId, message };
    }
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    if (request.type === 'initialize') {
        await handleInitialize(request.factorioData);
        return;
    }
    try {
        await gate.whenOpen();
    } catch (error) {
        postResponse(failedRequest(request, error instanceof Error ? error.message : 'Failed to initialize worker'));
        return;
    }

    switch (request.type) {
        case 'validate':
            handleValidate(request.requestId, request.config);
            break;
        case 'plan':
            handlePlan(request.runId, request.config, request.debugSteps, request.streamLogs);
            break;
        case 'task':
            handleTask(request.runId, request.config, request.debugSteps, request.streamLogs, request.context, request.taskId, request.assessedSignatures, request.coordinatedSources, request.regionLayer);
            break;
        case 'query':
            handleQuery(request.requestId, request.query);
            break;
    }
};
