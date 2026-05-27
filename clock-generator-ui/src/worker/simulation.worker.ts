/**
 * Web Worker for running clock-generator simulation.
 * 
 * This worker receives configuration, runs the simulation, and streams
 * log messages back to the main thread.
 */

import type { WorkerRequest, WorkerResponse } from './types';

// We'll dynamically import clock-generator in the worker context
let FactorioDataService: typeof import('clock-generator/browser').FactorioDataService;
let generateClockWithSwingBackoff: typeof import('clock-generator/browser').generateClockWithSwingBackoff;
let encodeBlueprintFileBrowser: typeof import('clock-generator/browser').encodeBlueprintFileBrowser;
let DebugSettingsProvider: typeof import('clock-generator/browser').DebugSettingsProvider;
let StreamingLogger: typeof import('clock-generator/browser').StreamingLogger;

const ctx: Worker = self as unknown as Worker;

function postResponse(response: WorkerResponse): void {
    ctx.postMessage(response);
}

async function handleInitialize(factorioDataUrl: string): Promise<void> {
    try {
        // Dynamically import the clock-generator browser module
        const clockGenerator = await import('clock-generator/browser');
        
        FactorioDataService = clockGenerator.FactorioDataService;
        generateClockWithSwingBackoff = clockGenerator.generateClockWithSwingBackoff;
        encodeBlueprintFileBrowser = clockGenerator.encodeBlueprintFileBrowser;
        DebugSettingsProvider = clockGenerator.DebugSettingsProvider;
        StreamingLogger = clockGenerator.StreamingLogger;

        // Fetch and initialize Factorio data
        const response = await fetch(factorioDataUrl);
        const data = await response.json();
        FactorioDataService.initialize(data);

        // Send back available recipes and resources
        postResponse({
            type: 'initialized',
            recipeNames: FactorioDataService.getAllRecipeNames(),
            resourceNames: FactorioDataService.getAllResourceNames(),
        });
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
        // Create a streaming logger to send logs to main thread
        const logger = new StreamingLogger((message) => {
            postResponse({
                type: 'log',
                message,
            });
        });

        // Create mutable debug settings
        const debug = DebugSettingsProvider.mutable();

        // Run the simulation
        postResponse({
            type: 'progress',
            step: 'starting',
            message: 'Starting simulation...',
        });

        const result = generateClockWithSwingBackoff(config, {
            debug,
            debug_steps: debugSteps,
            logger,
        });

        // Encode the blueprint
        const blueprintString = encodeBlueprintFileBrowser({
            blueprint: result.blueprint,
        });

        postResponse({
            type: 'completed',
            blueprintString,
            simulationDurationTicks: result.simulation_duration.ticks,
            swingBackoffReport: result.swing_backoff_report,
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
