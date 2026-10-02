/**
 * Web Worker for running clock-generator simulation.
 * 
 * This worker receives configuration, runs the simulation, and streams
 * log messages back to the main thread.
 */

import type { LogMessage } from 'clock-generator/browser';
import type { ClockAlternativeView, WorkerRequest, WorkerResponse } from './types';

// We'll dynamically import clock-generator in the worker context
let FactorioDataService: typeof import('clock-generator/browser').FactorioDataService;
let generateClockAlternatives: typeof import('clock-generator/browser').generateClockAlternatives;
let encodeBlueprintFileBrowser: typeof import('clock-generator/browser').encodeBlueprintFileBrowser;
let DebugSettingsProvider: typeof import('clock-generator/browser').DebugSettingsProvider;
let StreamingLogger: typeof import('clock-generator/browser').StreamingLogger;

const LOG_FLUSH_INTERVAL_MS = 100;

const ctx: Worker = self as unknown as Worker;

function postResponse(response: WorkerResponse): void {
    ctx.postMessage(response);
}

async function handleInitialize(factorioDataUrl: string): Promise<void> {
    try {
        // Dynamically import the clock-generator browser module
        const clockGenerator = await import('clock-generator/browser');
        
        FactorioDataService = clockGenerator.FactorioDataService;
        generateClockAlternatives = clockGenerator.generateClockAlternatives;
        encodeBlueprintFileBrowser = clockGenerator.encodeBlueprintFileBrowser;
        DebugSettingsProvider = clockGenerator.DebugSettingsProvider;
        StreamingLogger = clockGenerator.StreamingLogger;

        // Fetch and initialize Factorio data
        const response = await fetch(factorioDataUrl);
        const data = await response.json();
        FactorioDataService.initialize(data);

        postResponse({ type: 'initialized' });
    } catch (error) {
        postResponse({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to initialize worker',
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
}

async function handleGenerate(
    config: import('clock-generator/browser').Config,
    debugSteps: import('clock-generator/browser').DebugSteps
): Promise<void> {
    try {
        // Logs arrive far faster than the UI needs them, so post them in batches
        let pending_logs: LogMessage[] = [];
        let last_flush = 0;
        const flushLogs = () => {
            if (pending_logs.length > 0) {
                postResponse({ type: 'log', messages: pending_logs });
                pending_logs = [];
            }
            last_flush = Date.now();
        };
        const logger = new StreamingLogger((message) => {
            pending_logs.push(message);
            if (Date.now() - last_flush >= LOG_FLUSH_INTERVAL_MS) {
                flushLogs();
            }
        });

        const debug = DebugSettingsProvider.mutable();

        const generated = generateClockAlternatives(config, {
            debug,
            debug_steps: debugSteps,
            logger,
            on_progress: (progress) => {
                flushLogs();
                postResponse({ type: 'progress', progress });
            },
        });
        flushLogs();

        const alternatives: ClockAlternativeView[] = generated.alternatives.map(({ result, ...alternative }) => ({
            id: alternative.id,
            label: alternative.label,
            description: alternative.description,
            inserterWindowCount: alternative.inserter_window_count,
            isStable: alternative.is_stable,
            asBuilt: result.stability_check.as_built ?? null,
            expectedOutputItems: result.stability_check.expected_output_items,
            terminalSwingCount: result.used_terminal_swing_count,
            blueprintString: encodeBlueprintFileBrowser({ blueprint: result.blueprint }),
            transferHistory: result.serializable_transfer_history,
            stateTransitionHistory: result.serializable_state_transition_history,
            simulationDurationTicks: result.simulation_duration.ticks,
            swingBackoffReport: result.swing_backoff_report ?? null,
            transferPlan: result.serializable_transfer_plan,
            usedLcm: result.used_lcm,
        }));

        postResponse({
            type: 'completed',
            alternatives,
            selectedIndex: generated.selected_index,
        });
    } catch (error) {
        postResponse({
            type: 'error',
            message: error instanceof Error ? error.message : 'Simulation failed',
            stack: error instanceof Error ? error.stack : undefined,
        });
    }
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;

    switch (request.type) {
        case 'initialize':
            await handleInitialize(request.factorioDataUrl);
            break;
        case 'generate':
            await handleGenerate(request.config, request.debugSteps);
            break;
    }
};
