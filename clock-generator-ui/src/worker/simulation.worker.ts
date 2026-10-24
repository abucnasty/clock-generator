import { repeatedUnitsProblem } from '../utils/repeatedUnitsProblem';
/**
 * Web Worker for running clock-generator simulation.
 *
 * The main thread runs a pool of these: one plans a generation (the primary alternative and the task list),
 * then every worker takes tasks (one alternative each) until all are done. Logs and progress stream back.
 * One more answers the main thread's queries (see EngineQuery), as only the workers load the engine.
 */

import type { z } from 'zod';
import type { ClockAlternativeRun, Config, CopiesError, DebugSteps, LogMessage, Logger, NotMadeClock, SearchRangeEdge } from 'clock-generator/browser';
import { parseFormConfig } from './formConfig';
import { installFactsOf } from './installFacts';
import { createReadyGate } from './requestGate';
import { NO_NAMES, hiddenRecipeIds, type GameNames } from '../utils/gameNames';
import type { CheckedRepeatedUnitConversion, RepeatedUnitsRecovery, CheckedShiftRow, ClockAlternativeRunView, ClockAlternativeView, EngineAnswers, EngineQuery, FactorioLookups, FuelViewData, PastedEntities, ShiftOptionsView, ShiftRangeEdge, WorkerRequest, WorkerResponse } from './types';

type ClockGenerator = typeof import('clock-generator/browser');

// imported dynamically in the worker context
let clockGenerator: ClockGenerator;
let liveCoverage: ReturnType<ClockGenerator['createInserterCoverageValidator']>;
/** The data's in-game names, kept here so that the main thread does not parse the whole data for them */
let gameNames: GameNames = NO_NAMES;
/** The recipes the data marks hidden, which the pickers leave out */
let hiddenRecipes: string[] = [];

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
        liveCoverage = clockGenerator.createInserterCoverageValidator();
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
            ? (search.moved ?? []).map(it => `${it.entity_id.type} ${it.entity_id.number}: ${it.item_names.join(', ')}`).join('; ')
            : `output swing ${search.picked.row}`,
        plannedTicks: shifted ? search.planned_ticks ?? null : null,
        rows: Array.from(rows.values()),
        earliest: edge(search.earliest),
        latest: edge(search.latest),
    };
}

/** The fuel plan with the part of the fuel run the page draws: the fuel levels and the fuel inserters' swings */
function fuelViewOf(result: ClockAlternativeRun['alternatives'][number]['result']): FuelViewData | null {
    if (!result.fuel_plan) {
        return null;
    }
    const view = result.fuel_consumption_view;
    return {
        plan: result.fuel_plan,
        run: view ? {
            periods: view.periods,
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
    const alternatives: ClockAlternativeView[] = run.alternatives.map(({ result, ...alternative }) => ({
        id: alternative.id,
        label: alternative.label,
        description: alternative.description,
        inserterWindowCount: alternative.inserter_window_count,
        deciders: alternative.deciders,
        rankingWindowCount: alternative.ranking_window_count,
        assessment: alternative.assessment,
        assumptions: {
            loopSeeds: result.machine_facts.flatMap(machine => machine.facts.inputs
                .filter(input => clockGenerator.FactorioDataService.findRecipeOrThrow(machine.facts.recipe).results.some(output => output.name === input.item_name))
                .map(input => ({ machineId: machine.entity_id, item: input.item_name,
                    items: config.overrides?.loop_seed_items ?? clockGenerator.DEFAULT_LOOP_SEED_ITEMS }))),
            outputDrops: [...new Set(config.inserters.filter(ins => ins.sink.type === 'belt').map(ins => ins.sink.id))]
                .map(beltId => {
                    const inserters = config.inserters.filter(ins => ins.sink.type === 'belt' && ins.sink.id === beltId);
                    return { beltId, inserterIds: inserters.map(ins => ins.id ?? config.inserters.indexOf(ins) + 1),
                        mode: inserters.every(ins => ins.sink.type === 'belt' && ins.sink.drop !== undefined) ? 'shared-lanes' as const : 'free-lane' as const };
                }),
            overrides: config.overrides,
            machineFuel: config.machines.flatMap(machine => machine.fuel === undefined ? [] : [{ machineId: machine.id, fuel: machine.fuel }]),
        },
        copies: result.crafting_cycle_plan.production_rate.copies,
        verdict: alternative.verdict,
        ranking: alternative.ranking,
        deadlockRisk: clockGenerator.deadlockRiskNote(alternative.deadlock_risks),
        beltLabel: clockGenerator.clockBeltLabel(alternative.belt),
        belt: alternative.belt,
        asBuilt: result.stability_check.as_built ?? null,
        expectedOutputItems: result.stability_check.expected_output_items,
        terminalSwingCount: result.used_terminal_swing_count,
        cycleTicks: result.crafting_cycle_plan.total_duration.ticks,
        blueprintString: clockGenerator.encodeBlueprintFileBrowser(clockGenerator.blueprintFileFor(result)),
        install: installFactsOf(result),
        transferHistory: result.serializable_transfer_history,
        stateTransitionHistory: result.serializable_state_transition_history,
        clockOnlyTransferHistory: result.clock_only_run?.transfer_history ?? null,
        clockOnlyStateTransitionHistory: result.clock_only_run?.state_transition_history ?? null,
        fuelView: fuelViewOf(result),
        clockWindows: result.clock_windows,
        alwaysOnReasons: result.always_on_reasons ?? {},
        beltPickupSlackTicks: result.belt_pickup_slack_ticks,
        insights: alternative.insights,
        shiftOptions: shiftOptionsOf(result),
        simulationDurationTicks: result.simulation_duration.ticks,
        ...(alternative.rounded && { roundedPeriodTicks: alternative.rounded.period_ticks }),
        swingBackoffReport: result.swing_backoff_report ?? null,
        inserterClocks: result.unplanned_inserter_clocks ?? {},
        backedUpBelts: alternative.belt?.kind === 'backed_up' || (alternative.belt === null && config.overrides?.backed_up_belts === true),
    }));
    // the same clock made with shared windows, listed after it
    const also = run.also?.flatMap(it => toRunView(it, config) ?? []);
    return { signature: run.signature, alternatives, ...(also?.length ? { also } : {}) };
}

/** Runs one plan or task with streamed logs and progress; errors are posted instead of thrown */
function runStreaming(
    runId: number,
    config: Config,
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
        const failure = failureOf(error, config, 'Simulation failed');
        postResponse({
            type: 'error',
            runId,
            ...failure,
        });
    }
}

function handleValidate(requestId: number, config: Config): void {
    try {
        requireValidConfig(config);
        postResponse({ type: 'validated', requestId, validation: clockGenerator.validateConfig(config) });
    } catch (error) {
        const { message, recovery } = failureOf(error, config, 'Validation failed');
        postResponse({
            type: 'validation-failed',
            requestId,
            message,
            recovery,
            diagnostics: error instanceof clockGenerator.InserterCoverageError
                ? error.issues.map(issue => ({ kind: 'coverage' as const, issue }))
                : error instanceof clockGenerator.ConfigValidationError
                    ? error.zodError.issues.map(issue => ({ kind: 'field' as const, path: issue.path as (string | number)[], message: issue.message }))
                    : error instanceof Error && error.message.startsWith('The current configuration cannot meet the target production rate.')
                        ? [{ kind: 'field', path: ['target_output', 'items_per_second'], message: error.message }]
                        : undefined,
        });
    }
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
        return { kind: 'available', plan, validation: clockGenerator.validateConfig(plan.candidate) };
    } catch (error) {
        // Planning's existing assertion type includes target-capacity/period refusals. Untyped errors
        // and native programmer failures must remain query-failed, never a structural diagnosis.
        if (!(error instanceof clockGenerator.ConfigValidationError)
            && !(error instanceof clockGenerator.InserterCoverageError)
            && !(error instanceof clockGenerator.CopiesError)
            && !(error instanceof clockGenerator.AssertionError)) throw error;
        return { kind: 'unavailable', stage: 'check', reason: { code: 'candidate-check-failed',
            message: error instanceof Error ? error.message : 'The candidate Check failed.' }, repeatedGroups: repeatedGroups() };
    }
}

function repeatedUnitsRecoveryOf(error: CopiesError, config: Config): RepeatedUnitsRecovery {
    const checked = checkRepeatedUnitConversion(config);
    return {
        kind: 'repeated-units', sourceConfigKey: JSON.stringify(config),
        detectedCopies: error.units.length, configuredCopies: config.target_output.copies,
        units: error.units.map(unit => ({ machine_ids: [...unit.machine_ids] })),
        conversion: checked.kind === 'available'
            ? { kind: 'available', multiplicity: checked.plan.multiplicity, copies: checked.plan.copies }
            : { kind: 'unavailable', stage: checked.stage, code: checked.reason.code, message: checked.reason.message },
    };
}

/** A recovery-query failure must still settle the original Check/run, with its real error and no capability. */
function failureOf(error: unknown, config: Config, fallback: string): { message: string; stack?: string; recovery?: RepeatedUnitsRecovery } {
    if (error instanceof clockGenerator.CopiesError) {
        try {
            return { message: repeatedUnitsProblem(error), stack: error.stack, recovery: repeatedUnitsRecoveryOf(error, config) };
        } catch (failure) {
            return { message: failure instanceof Error ? failure.message : 'The engine could not check the repeated-unit conversion.',
                stack: failure instanceof Error ? failure.stack : undefined };
        }
    }
    return { message: error instanceof Error ? error.message : fallback, stack: error instanceof Error ? error.stack : undefined };
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

function pastedEntities(pasted: Extract<EngineQuery, { kind: 'pasted-entities' }>): PastedEntities {
    // IDs are already assigned by the mod
    const machines = validateEntries(clockGenerator.MachineConfigurationSchema, pasted.machines, 'machine');
    return {
        machines,
        picked_machines: machines.filter((machine, index) => machine.prototype !== undefined && !hasPrototype(Array.isArray(pasted.machines) ? pasted.machines[index] : undefined))
            .map(machine => machine.id),
        drills: validateEntries(clockGenerator.MiningDrillConfigSchema, pasted.drills, 'drill'),
        inserters: validateEntries(clockGenerator.InserterConfigSchema, clockGenerator.sidecarPickupInserters(pasted.inserters, pasted.sidecar_version, pasted.pickup_warnings), 'inserter'),
        belts: validateEntries(clockGenerator.BeltConfigSchema, pasted.belts, 'belt'),
        chests: validateEntries(clockGenerator.ChestConfigSchema, pasted.chests, 'chest'),
        guidance: clockGenerator.checkSidecarImport(pasted.sidecar_version, machines, undefined,
            Array.isArray(pasted.chests) ? pasted.chests : [], Array.isArray(pasted.inserters) ? pasted.inserters : [],
            Array.isArray(pasted.drills) ? pasted.drills : []),
        suggested_target: clockGenerator.suggestedTargetOf(pasted.suggested_target, machines),
    };
}

const hasPrototype = (machine: unknown): boolean => typeof machine === 'object' && machine !== null && 'prototype' in machine && machine.prototype !== undefined;

/**
 * The saved form state with each machine's former type read as its machine (a row given one so is marked as picked for
 * its recipe), and why it cannot be loaded, or null when it can
 */
function savedConfig(config: unknown): EngineAnswers['saved-config'] {
    const form = clockGenerator.migrateMachineTypes(config);
    const before = typeof config === 'object' && config !== null && 'machines' in config && Array.isArray(config.machines) ? config.machines : [];
    const marked = typeof form === 'object' && form !== null && 'machines' in form && Array.isArray(form.machines)
        ? { ...form, machines: form.machines.map((machine: unknown, index: number) => hasPrototype(machine) && !hasPrototype(before[index])
            ? { ...(machine as object), _prototype_source: 'recipe' } : machine) }
        : form;
    const result = parseFormConfig(clockGenerator.ConfigSchema, marked);
    return { problem: result.success ? null : result.error.message, form: marked };
}

/** An imported config file, which can hold what the form exports, e.g. an inserter end left unset; a former type is read as the machine */
function configFile(config: unknown): Config {
    const result = parseFormConfig(clockGenerator.ConfigSchema, clockGenerator.migrateMachineTypes(config));
    if (!result.success) {
        throw new clockGenerator.ConfigValidationError(result.error);
    }
    return result.data;
}

function answer(query: EngineQuery): EngineAnswers[EngineQuery['kind']] {
    switch (query.kind) {
        case 'timeline-recording':
            return clockGenerator.recordSimulationTimeline(query.request);
        case 'lookups':
            return lookups();
        case 'machine-facts':
            try {
                return clockGenerator.Machine.computeMachineFacts(query.params);
            } catch {
                return null;
            }
        case 'inserter-coverage': {
            // what is out of scope is refused before coverage, as Check does: read as built, a blacklist or a side stream
            // would be explained as a missing inserter
            const refusal = clockGenerator.insertersScopeProblem(query.config);
            const pickupNotTested = clockGenerator.beltPickupNotTestedNote(clockGenerator.uncalibratedBeltPickups(query.config));
            const laneSharedByCopies = clockGenerator.laneSharedByCopiesWarning(query.config);
            const sideLoadedDrop = clockGenerator.sideLoadedDropWarning(query.config);
            const lanesExactlyFull = clockGenerator.lanesExactlyFullWarning(query.config);
            const copyGapNeeded = clockGenerator.copyGapNeededNote(query.config);
            const dropRoom = clockGenerator.dropRoomNote(query.config);
            const machinePrototypes = clockGenerator.machinePrototypeIssues(query.config);
            return { issues: refusal === null ? liveCoverage(query.config) : [], refusal, pickupNotTested, laneSharedByCopies, sideLoadedDrop, lanesExactlyFull, copyGapNeeded, dropRoom, machinePrototypes };
        }
        case 'machine-target-rates':
            return clockGenerator.computeMachineTargetRates(query.config);
        case 'repeated-unit-conversion':
            return checkRepeatedUnitConversion(query.config);
        case 'saved-config':
            return savedConfig(query.config);
        case 'config-file':
            return configFile(query.config);
        case 'pasted-entities':
            return pastedEntities(query);
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

function handlePlan(runId: number, config: Config, debugSteps: DebugSteps, streamLogs: boolean): void {
    runStreaming(runId, config, debugSteps, streamLogs, (options) => {
        requireValidConfig(config);
        const notMade: NotMadeClock[] = [];
        // the tasks go out as soon as the primary clock is made: the pool runs them while this worker assesses it
        const plan = clockGenerator.planClockAlternatives(config, { ...options, on_not_made: clock => notMade.push(clock) }, (context, tasks, primarySignature) => postResponse({
            type: 'planned', runId, context, tasks, primarySignature,
            assumptions: { startDependenceRequested: config.overrides?.check_start_dependence === true },
        }));
        return { type: 'primary-completed', runId, primary: toRunView(plan.primary, config), notMade };
    });
}

function handleTask(
    runId: number,
    config: Config,
    debugSteps: DebugSteps,
    streamLogs: boolean,
    context: import('clock-generator/browser').ClockAlternativeContext,
    taskId: string,
    assessedSignatures: string[] = [],
): void {
    runStreaming(runId, config, debugSteps, streamLogs, (options) => {
        requireValidConfig(config);
        const notMade: NotMadeClock[] = [];
        const run = clockGenerator.runClockAlternativeTask(config, context, taskId, { ...options, on_not_made: clock => notMade.push(clock) }, assessedSignatures);
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
            handleTask(request.runId, request.config, request.debugSteps, request.streamLogs, request.context, request.taskId, request.assessedSignatures);
            break;
        case 'query':
            handleQuery(request.requestId, request.query);
            break;
    }
};
