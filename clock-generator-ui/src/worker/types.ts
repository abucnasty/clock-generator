import type {
    AsBuiltStabilityCheck,
    Config,
    DebugSteps,
    GenerationProgress,
    LogMessage,
    SerializableStateTransitionHistory,
    SerializableTransferHistory,
    SerializableTransferPlan,
    SwingBackoffReport,
} from 'clock-generator/browser';

/**
 * A generated clock alternative, flattened to plain data so it can be posted from the worker.
 */
export interface ClockAlternativeView {
    id: string;
    label: string;
    description: string;
    inserterWindowCount: number;
    isStable: boolean;
    itemsPerSecond: number;
    asBuilt: AsBuiltStabilityCheck | null;
    expectedOutputItems: number;
    terminalSwingCount: number;
    blueprintString: string;
    transferHistory: SerializableTransferHistory;
    stateTransitionHistory: SerializableStateTransitionHistory;
    simulationDurationTicks: number;
    swingBackoffReport: SwingBackoffReport | null;
    transferPlan: SerializableTransferPlan;
    usedLcm: number;
}

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
}

export interface LogResponse {
    type: 'log';
    messages: LogMessage[];
}

export interface ProgressResponse {
    type: 'progress';
    progress: GenerationProgress;
}

export interface CompletedResponse {
    type: 'completed';
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
}

export interface ErrorResponse {
    type: 'error';
    message: string;
    stack?: string;
}
