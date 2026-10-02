/**
 * Web Worker for running clock-generator simulation.
 *
 * The main thread runs a pool of these: one plans a generation (the primary alternative and the task list),
 * then every worker takes tasks (one alternative each) until all are done. Logs and progress stream back.
 */

import type { ClockAlternativeRun, Config, DebugSteps, LogMessage } from 'clock-generator/browser';
import type { ClockAlternativeRunView, ClockAlternativeView, WorkerRequest, WorkerResponse } from './types';

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

function toRunView(run: ClockAlternativeRun | null): ClockAlternativeRunView | null {
    if (!run) {
        return null;
    }
    const alternatives: ClockAlternativeView[] = run.alternatives.map(({ result, ...alternative }) => ({
        id: alternative.id,
        label: alternative.label,
        description: alternative.description,
        inserterWindowCount: alternative.inserter_window_count,
        isStable: alternative.is_stable,
        itemsPerSecond: alternative.items_per_second,
        asBuilt: result.stability_check.as_built ?? null,
        expectedOutputItems: result.stability_check.expected_output_items,
        terminalSwingCount: result.used_terminal_swing_count,
        blueprintString: clockGenerator.encodeBlueprintFileBrowser({ blueprint: result.blueprint }),
        transferHistory: result.serializable_transfer_history,
        stateTransitionHistory: result.serializable_state_transition_history,
        simulationDurationTicks: result.simulation_duration.ticks,
        swingBackoffReport: result.swing_backoff_report ?? null,
        transferPlan: result.serializable_transfer_plan,
        usedLcm: result.used_lcm,
    }));
    return { signature: run.signature, alternatives };
}

/** Runs one plan or task with streamed logs and progress; errors are posted instead of thrown */
function runStreaming(
    runId: number,
    debugSteps: DebugSteps,
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
        const logger = new clockGenerator.StreamingLogger((message) => {
            pending_logs.push(message);
            if (Date.now() - last_flush >= LOG_FLUSH_INTERVAL_MS) {
                flushLogs();
            }
        });
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

function handlePlan(runId: number, config: Config, debugSteps: DebugSteps): void {
    runStreaming(runId, debugSteps, (options) => {
        const plan = clockGenerator.planClockAlternatives(config, options);
        return { type: 'planned', runId, primary: toRunView(plan.primary), context: plan.context, tasks: plan.tasks };
    });
}

function handleTask(
    runId: number,
    config: Config,
    debugSteps: DebugSteps,
    context: import('clock-generator/browser').ClockAlternativeContext,
    taskId: string,
): void {
    runStreaming(runId, debugSteps, (options) => {
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
        case 'plan':
            handlePlan(request.runId, request.config, request.debugSteps);
            break;
        case 'task':
            handleTask(request.runId, request.config, request.debugSteps, request.context, request.taskId);
            break;
    }
};
