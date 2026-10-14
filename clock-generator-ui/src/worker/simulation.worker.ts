/**
 * Web Worker for running clock-generator simulation.
 *
 * The main thread runs a pool of these: one plans a generation (the primary alternative and the task list),
 * then every worker takes tasks (one alternative each) until all are done. Logs and progress stream back.
 */

import type { ClockAlternativeRun, Config, DebugSteps, LogMessage, Logger, SearchRangeEdge } from 'clock-generator/browser';
import type { CheckedShiftRow, ClockAlternativeRunView, ClockAlternativeView, FuelViewData, ShiftOptionsView, ShiftRangeEdge, WorkerRequest, WorkerResponse } from './types';

type ClockGenerator = typeof import('clock-generator/browser');

// imported dynamically in the worker context
let clockGenerator: ClockGenerator;

const LOG_FLUSH_INTERVAL_MS = 100;

const ctx: Worker = self as unknown as Worker;

function postResponse(response: WorkerResponse): void {
    ctx.postMessage(response);
}

async function handleInitialize(factorioDataUrl: string): Promise<void> {
    try {
        // Dynamically import the clock-generator browser module
        clockGenerator = await import('clock-generator/browser');

        // Fetch and initialize Factorio data
        const response = await fetch(factorioDataUrl);
        const data = await response.json();
        clockGenerator.FactorioDataService.initialize(data);

        postResponse({ type: 'initialized' });
    } catch (error) {
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
            ? (search.moved ?? []).map(it => `${it.entity_id.replace(':', ' ')}: ${it.item_names.join(', ')}`).join('; ')
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

function toRunView(run: ClockAlternativeRun | null): ClockAlternativeRunView | null {
    if (!run) {
        return null;
    }
    const alternatives: ClockAlternativeView[] = run.alternatives.map(({ result, ...alternative }) => ({
        id: alternative.id,
        label: alternative.label,
        description: alternative.description,
        inserterWindowCount: alternative.inserter_window_count,
        rankingWindowCount: alternative.ranking_window_count,
        assessment: alternative.assessment,
        verdict: alternative.verdict,
        ranking: alternative.ranking,
        deadlockRisk: clockGenerator.deadlockRiskNote(alternative.deadlock_risks),
        beltLabel: clockGenerator.clockBeltLabel(alternative.belt),
        asBuilt: result.stability_check.as_built ?? null,
        expectedOutputItems: result.stability_check.expected_output_items,
        terminalSwingCount: result.used_terminal_swing_count,
        cycleTicks: result.crafting_cycle_plan.total_duration.ticks,
        blueprintString: clockGenerator.encodeBlueprintFileBrowser(clockGenerator.blueprintFileFor(result)),
        transferHistory: result.serializable_transfer_history,
        stateTransitionHistory: result.serializable_state_transition_history,
        clockOnlyTransferHistory: result.clock_only_run?.transfer_history ?? null,
        clockOnlyStateTransitionHistory: result.clock_only_run?.state_transition_history ?? null,
        fuelView: fuelViewOf(result),
        clockWindows: result.clock_windows,
        insights: alternative.insights,
        shiftOptions: shiftOptionsOf(result),
        simulationDurationTicks: result.simulation_duration.ticks,
        swingBackoffReport: result.swing_backoff_report ?? null,
    }));
    return { signature: run.signature, alternatives };
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
        postResponse({
            type: 'error',
            runId,
            message: error instanceof Error ? error.message : 'Simulation failed',
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
}

function handleValidate(requestId: number, config: Config): void {
    try {
        postResponse({ type: 'validated', requestId, validation: clockGenerator.validateConfig(config) });
    } catch (error) {
        postResponse({
            type: 'validation-failed',
            requestId,
            message: error instanceof Error ? error.message : 'Validation failed',
        });
    }
}

function handlePlan(runId: number, config: Config, debugSteps: DebugSteps, streamLogs: boolean): void {
    runStreaming(runId, debugSteps, streamLogs, (options) => {
        const plan = clockGenerator.planClockAlternatives(config, options);
        return { type: 'planned', runId, primary: toRunView(plan.primary), context: plan.context, tasks: plan.tasks };
    });
}

function handleTask(
    runId: number,
    config: Config,
    debugSteps: DebugSteps,
    streamLogs: boolean,
    context: import('clock-generator/browser').ClockAlternativeContext,
    taskId: string,
): void {
    runStreaming(runId, debugSteps, streamLogs, (options) => {
        const run = clockGenerator.runClockAlternativeTask(config, context, taskId, options);
        return { type: 'task-completed', runId, taskId, run: toRunView(run) };
    });
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;

    switch (request.type) {
        case 'initialize':
            await handleInitialize(request.factorioDataUrl);
            break;
        case 'validate':
            handleValidate(request.requestId, request.config);
            break;
        case 'plan':
            handlePlan(request.runId, request.config, request.debugSteps, request.streamLogs);
            break;
        case 'task':
            handleTask(request.runId, request.config, request.debugSteps, request.streamLogs, request.context, request.taskId);
            break;
    }
};
