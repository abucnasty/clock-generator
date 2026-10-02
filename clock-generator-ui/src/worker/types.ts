import type {
    AsBuiltStabilityCheck,
    ClockAlternativeContext,
    ClockAlternativeRun,
    ClockAlternativeTask,
    Config,
    DebugSteps,
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

export type ClockAlternativeRunView = ClockAlternativeRun<ClockAlternativeView>;

/**
 * Messages sent from the main thread to the worker. A generation is one plan request followed by its tasks,
 * spread over a pool of workers; runId lets the main thread ignore messages from an earlier generation.
 */
export type WorkerRequest =
    | InitializeRequest
    | PlanRequest
    | TaskRequest;

export interface InitializeRequest {
    type: 'initialize';
    factorioDataUrl: string;
}

export interface PlanRequest {
    type: 'plan';
    runId: number;
    config: Config;
    debugSteps: DebugSteps;
}

export interface TaskRequest {
    type: 'task';
    runId: number;
    config: Config;
    debugSteps: DebugSteps;
    context: ClockAlternativeContext;
    taskId: string;
}

/**
 * Messages sent from the worker to the main thread.
 */
export type WorkerResponse =
    | InitializedResponse
    | LogResponse
    | ProgressResponse
    | PlannedResponse
    | TaskCompletedResponse
    | ErrorResponse;

export interface InitializedResponse {
    type: 'initialized';
}

export interface LogResponse {
    type: 'log';
    runId: number;
    messages: LogMessage[];
}

/** The current sub-step of the plan or task this worker is running */
export interface ProgressResponse {
    type: 'progress';
    runId: number;
    detail: string;
}

export interface PlannedResponse {
    type: 'planned';
    runId: number;
    primary: ClockAlternativeRunView | null;
    context: ClockAlternativeContext;
    tasks: ClockAlternativeTask[];
}

export interface TaskCompletedResponse {
    type: 'task-completed';
    runId: number;
    taskId: string;
    run: ClockAlternativeRunView | null;
}

export interface ErrorResponse {
    type: 'error';
    runId?: number;
    message: string;
    stack?: string;
}
