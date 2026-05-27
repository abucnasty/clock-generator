import type { Config, DebugSteps, LogMessage, SwingBackoffReport } from 'clock-generator/browser';

/**
 * Messages sent from the main thread to the worker.
 */
export type WorkerRequest = 
    | InitializeRequest
    | GenerateBlueprintRequest;

export interface InitializeRequest {
    type: 'initialize';
    factorioDataUrl: string;
}

export interface GenerateBlueprintRequest {
    type: 'generate';
    config: Config;
    debugSteps: DebugSteps;
}

/**
 * Messages sent from the worker to the main thread.
 */
export type WorkerResponse =
    | InitializedResponse
    | LogResponse
    | ProgressResponse
    | CompletedResponse
    | ErrorResponse;

export interface InitializedResponse {
    type: 'initialized';
    recipeNames: string[];
    resourceNames: string[];
}

export interface LogResponse {
    type: 'log';
    message: LogMessage;
}

export interface ProgressResponse {
    type: 'progress';
    step: string;
    message: string;
}

export interface CompletedResponse {
    type: 'completed';
    blueprintString: string;
    simulationDurationTicks: number;
    swingBackoffReport?: SwingBackoffReport;
}

export interface ErrorResponse {
    type: 'error';
    message: string;
    stack?: string;
}
