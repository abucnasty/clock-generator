import type {
    AsBuiltStabilityCheck,
    CheckedShiftRow,
    ClockInsight,
    ShiftRangeEdge,
    ClockAlternativeContext,
    ClockAlternativeRun,
    ClockAlternativeTask,
    Config,
    DebugSteps,
    LogMessage,
    SerializableClockWindows,
    SerializableStateTransitionHistory,
    SerializableTransferHistory,
    SerializableTransferPlan,
    SwingBackoffReport,
} from 'clock-generator/browser';

/** Every place tried for the swings a potential clock moved off their planned start */
export interface ShiftOptionsView {
    moved: 'swings' | 'output-swing';
    /** Row (see `rows`) this clock moved, and by how many ticks (negative is earlier) */
    chosenIndex: number;
    chosenShiftTicks: number;
    /** What was moved, e.g. "inserter 1: flying-robot-frame; inserter 3: battery, electronic-circuit" */
    movedDescription: string;
    /** Clock ticks the moved swings were planned in; null for a single output swing */
    plannedTicks: { start: number; end: number } | null;
    rows: CheckedShiftRow[];
    /** Ends of the range that works around the chosen shift, with what limits them; null when not worked out */
    earliest: ShiftRangeEdge | null;
    latest: ShiftRangeEdge | null;
}

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
    /** Length of one crafting cycle; the clock period is a whole number of them */
    cycleTicks: number;
    blueprintString: string;
    transferHistory: SerializableTransferHistory;
    stateTransitionHistory: SerializableStateTransitionHistory;
    /**
     * The build driven only by the exported clock windows. Null when the histories above already are that run
     * (observed windows) or no clock-only check ran.
     */
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
    /** Decider windows in the blueprint, per entity id */
    clockWindows: SerializableClockWindows;
    /** What the simulation found that is worth explaining about the build and this clock */
    insights: ClockInsight[];
    /** Null unless this clock moved a crafting cycle or an output swing */
    shiftOptions: ShiftOptionsView | null;
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
    /** Post generator log messages back; off unless the user turns on the log */
    streamLogs: boolean;
}

export interface TaskRequest {
    type: 'task';
    runId: number;
    config: Config;
    debugSteps: DebugSteps;
    streamLogs: boolean;
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
