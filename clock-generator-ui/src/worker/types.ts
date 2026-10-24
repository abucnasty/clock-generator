import type { ValidationDiagnostic } from '../utils/buildValidation';
import type { z } from 'zod';
import type {
    AlwaysOnReasons,
    AsBuiltStabilityCheck,
    BeltConfigSchema,
    ChestConfigSchema,
    ClockAssessment,
    ClockRanking,
    ClockVerdict,
    ClockBelt,
    ClockInsight,
    ConfigValidation,
    FuelLevelSeries,
    FuelPlan,
    InserterCoverageIssue,
    MachineConfigurationSchema,
    MachinePrototypeIssue,
    MiningDrillConfigSchema,
    Option,
    ClockAlternativeContext,
    ClockAlternativeRun,
    ClockAlternativeTask,
    NotMadeClock,
    ComputeMachineFactsParams,
    Config,
    DebugSteps,
    LogMessage,
    SerializableClockWindows,
    SerializableMachineFacts,
    MachineTargetRate,
    SerializableStateTransitionHistory,
    SerializableTransferHistory,
    SuggestedTarget,
    SwingBackoffReport,
    RepeatedUnitConversionPlan,
    RepeatedUnitConversionReason,
    RepeatedUnitConversionReasonCode,
    RecordTimelineRequest,
    TimelineRecording,
} from 'clock-generator/browser';
import type { ClockInstallFacts } from './installFacts';
import type { GameNames } from '../utils/gameNames';

/** One swing of a fuel inserter into a fuel slot, in ticks of the fuel run */
export interface FuelSwing {
    start: number;
    end: number;
    amount: number;
}

/** The exported clock run over several periods, long enough to show the burner machines being refilled */
export interface FuelRunView {
    /** Periods of the clock the run covers; the clock itself stays one period */
    periods: number;
    durationTicks: number;
    /** Whether a fuel inserter swung in the run; false when none did even over the longest run tried */
    fuelSwingsRecorded: boolean;
    ranOutOfFuel: boolean;
    /** The fuel each burner machine held over the run */
    levels: FuelLevelSeries[];
    /** The swings of each fuel inserter, by inserter id */
    swings: Record<string, FuelSwing[]>;
}

/** Fuel is outside the transfer plan: what the burner machines use, the fuel clocks exported for them, and a run of them */
export interface FuelViewData {
    plan: FuelPlan;
    /** Null when the run was not made */
    run: FuelRunView | null;
}

/** One place tried for a moved crafting cycle or output swing, in ticks from its planned start (negative is earlier) */
export interface CheckedShift {
    shift_ticks: number;
    /** Passed the quick trial; only the shift that is used is confirmed from more clock start phases */
    holds: boolean;
}

/** Every place tried for one crafting cycle or output swing (1-based `index`), in shift order */
export interface CheckedShiftRow {
    index: number;
    shifts: CheckedShift[];
}

/** One end of the unbroken range of shifts that work around the shift in use */
export interface ShiftRangeEdge {
    shift_ticks: number;
    /** No place further out was tried: the moved windows would meet the same inserters' other windows or the end of the period */
    is_search_limit: boolean;
    /** What the inserters and machines are waiting on at this shift, the limits that stop the swings from going further */
    notes: string[];
}

/** Every place tried for the swings a clock moved off their planned start */

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
    /** The decider combinators that switch inserters and drills on and off in the clock's blueprint, the clock's own not counted */
    deciders: number;
    /** The windows the selection compares last: the count without the windows of the output feeders */
    rankingWindowCount: number;
    /** What the trial of the clock found: holds, survives backpressure loss, rate, wake-ups */
    assessment: ClockAssessment;
    /** Facts captured by the worker for this candidate, never read from a later edited form. */
    assumptions: ClockModelAssumptions;
    /** Copies of the build the target rate is shared over; the rate in the assessment is the total for all of them */
    copies: number;
    /** The one word for the clock: stable, no recovery, or unstable */
    verdict: ClockVerdict;
    /** How the clock ranks against the others; the selection compares these, in order */
    ranking: ClockRanking;
    /**
     * What to say of a build with a deadlock risk, the same for every clock of it: which two inserters bring the same
     * item to a machine, and what can come of it. Null for a build without one.
     */
    deadlockRisk: string | null;
    /** The belt the clock is made for: "moving (+4 ticks)" or "backed-up"; empty when no clocked inserter picks up from a belt */
    beltLabel: string;
    /** The same belt as the engine gives it; missing from clocks kept before it was carried */
    belt?: ClockBelt | null;
    asBuilt: AsBuiltStabilityCheck | null;
    expectedOutputItems: number;
    terminalSwingCount: number;
    /** Length of one crafting cycle; the clock period is a whole number of them */
    cycleTicks: number;
    blueprintString: string;
    /** What installing the blueprint takes: whether it is a book, and which inserters each combinator is wired to */
    install: ClockInstallFacts;
    transferHistory: SerializableTransferHistory;
    stateTransitionHistory: SerializableStateTransitionHistory;
    /**
     * The build driven only by the exported clock windows. Null when the histories above already are that run
     * (observed windows) or no clock-only check ran.
     */
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
    /** Fuel use and the exported fuel clocks; null when no inserter only fills a fuel slot */
    fuelView: FuelViewData | null;
    /** Decider windows in the blueprint, per entity id */
    clockWindows: SerializableClockWindows;
    /** Why the clock leaves an inserter or drill always on, by entity id; missing from clocks kept before it was carried */
    alwaysOnReasons?: AlwaysOnReasons;
    /** Ticks of belt pickup slack at the end of each window, by inserter id */
    beltPickupSlackTicks: Record<string, number>;
    /** What the simulation found that is worth explaining about the build and this clock */
    insights: ClockInsight[];
    /** Null unless this clock moved a crafting cycle or an output swing */
    shiftOptions: ShiftOptionsView | null;
    simulationDurationTicks: number;
    /**
     * The ticks the blueprint counts when the period is not a whole number of ticks and the clock runs it rounded down;
     * missing for any other clock, and from clocks kept before it was carried
     */
    roundedPeriodTicks?: number;
    swingBackoffReport: SwingBackoffReport | null;
    /** Exact independent inserter clocks exported with this alternative, including measured fuel clocks. */
    inserterClocks?: RecordTimelineRequest['inserter_clocks'];
    /** The belt timing actually used by this alternative, including clocks for the other belt setting. */
    backedUpBelts?: boolean;
}

export interface ClockModelAssumptions {
    loopSeeds: { machineId: string; item: string; items: number }[];
    outputDrops: { beltId: number; inserterIds: number[]; mode: 'shared-lanes' | 'free-lane' }[];
    overrides: Config['overrides'];
    machineFuel: { machineId: number; fuel: string }[];
}

/** Requested checks and completion belong to the generation; actual outcomes remain on each assessment. */
export interface GenerationAssumptions {
    startDependenceRequested: boolean;
    complete: boolean;
}

export type ClockAlternativeRunView = ClockAlternativeRun<ClockAlternativeView>;

/**
 * Messages sent from the main thread to the worker. A generation is one plan request followed by its tasks,
 * spread over a pool of workers; runId lets the main thread ignore messages from an earlier generation.
 */
export type WorkerRequest =
    | InitializeRequest
    | ValidateRequest
    | PlanRequest
    | TaskRequest
    | QueryRequest;

/** Checks a config and plans its transfers without generating a clock; answered by 'validated' or 'validation-failed' */
export interface ValidateRequest {
    type: 'validate';
    requestId: number;
    config: Config;
}

export interface InitializeRequest {
    type: 'initialize';
    /** The text of data-filtered.json; the main thread fetches it once for every worker */
    factorioData: string;
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
    /** Signatures of clocks other runs assess (see PlannedResponse.primarySignature) */
    assessedSignatures?: string[];
}

/**
 * Messages sent from the worker to the main thread.
 */
export type WorkerResponse =
    | InitializedResponse
    | ValidatedResponse
    | ValidationFailedResponse
    | LogResponse
    | ProgressResponse
    | PlannedResponse
    | PrimaryCompletedResponse
    | TaskCompletedResponse
    | AnswerResponse
    | QueryFailedResponse
    | ErrorResponse;

export interface InitializedResponse {
    type: 'initialized';
}

export interface ValidatedResponse {
    type: 'validated';
    requestId: number;
    validation: ConfigValidation;
}

export interface ValidationFailedResponse {
    type: 'validation-failed';
    requestId: number;
    message: string;
    recovery?: RepeatedUnitsRecovery;
    diagnostics?: ValidationDiagnostic[];
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

/**
 * The tasks of a plan, posted as soon as the primary clock is made; the planning worker goes on to assess it and posts
 * PrimaryCompletedResponse
 */
export interface PlannedResponse {
    type: 'planned';
    runId: number;
    context: ClockAlternativeContext;
    tasks: ClockAlternativeTask[];
    assumptions: Pick<GenerationAssumptions, 'startDependenceRequested'>;
    /** Signature of the primary clock: a task that makes the same clock is merged away, so it skips assessing it */
    primarySignature: string;
}

export interface PrimaryCompletedResponse {
    type: 'primary-completed';
    runId: number;
    primary: ClockAlternativeRunView | null;
    /** The primary alternative, when it could not be made, with the generator's reason; none when absent */
    notMade?: NotMadeClock[];
}

export interface TaskCompletedResponse {
    type: 'task-completed';
    runId: number;
    taskId: string;
    run: ClockAlternativeRunView | null;
    /** The task's alternative, when it could not be made, with the generator's reason; none when absent */
    notMade?: NotMadeClock[];
}

export interface AnswerResponse {
    type: 'answer';
    requestId: number;
    answer: EngineAnswers[EngineQuery['kind']];
}

export interface QueryFailedResponse {
    type: 'query-failed';
    requestId: number;
    message: string;
}

export interface ErrorResponse {
    type: 'error';
    runId?: number;
    message: string;
    stack?: string;
    recovery?: RepeatedUnitsRecovery;
}

/** `repeatedGroups` on a refusal: how many identical groups the config holds, which is 1 for a build of one copy */
export type CheckedRepeatedUnitConversion =
    | { kind: 'available'; plan: RepeatedUnitConversionPlan; validation: ConfigValidation }
    | { kind: 'unavailable'; stage: 'proof'; reason: RepeatedUnitConversionReason; repeatedGroups: number }
    | { kind: 'unavailable'; stage: 'check'; reason: { code: 'candidate-check-failed'; message: string }; repeatedGroups: number };

export interface RepeatedUnitsRecovery {
    kind: 'repeated-units';
    sourceConfigKey: string;
    detectedCopies: number;
    configuredCopies: number;
    units: { machine_ids: number[] }[];
    conversion:
        | { kind: 'available'; multiplicity: number; copies: number }
        | { kind: 'unavailable'; stage: 'proof' | 'check';
            code: RepeatedUnitConversionReasonCode | 'candidate-check-failed'; message: string };
}

/** A crafting machine of the game data (an assembling machine or a furnace prototype), as the Machine picker offers it */
export interface CraftingMachineInfo {
    name: string;
    /** "furnace" or "assembling-machine" */
    type: string;
    crafting_categories: string[];
    burner_fuel_categories: string[];
    /** Base crafting speed, which picks the machine for a recipe */
    crafting_speed: number;
}

export interface CraftingMachineData {
    machines: CraftingMachineInfo[];
    /** By recipe id, hidden ones included */
    recipeCategories: Record<string, string[]>;
}

export interface RecipeInfo {
    ingredients: string[];
    results: string[];
}

/** The names the forms offer and what each recipe takes and makes, from the game data */
export interface FactorioLookups {
    recipeNames: string[];
    itemNames: string[];
    resourceNames: string[];
    /** By recipe name; a recipe the generator cannot use is left out */
    recipes: Map<string, RecipeInfo>;
    /** The in-game names of the ids, from the data's `names` key (none when the data has no such key) */
    names: GameNames;
    /** The recipes the data marks hidden (recycling, parameters, mod and unused recipes) */
    hiddenRecipes: string[];
    /** The crafting machines a machine can be, in the data's order, and the crafting categories of every recipe */
    craftingMachines: CraftingMachineData;
}

export type MachineConfiguration = z.infer<typeof MachineConfigurationSchema>;
export type MiningDrillConfiguration = z.infer<typeof MiningDrillConfigSchema>;
export type InserterConfiguration = Config['inserters'][number];
export type BeltConfiguration = z.infer<typeof BeltConfigSchema>;
export type ChestConfiguration = z.infer<typeof ChestConfigSchema>;

/** The entities pasted from the sidecar mod, each list checked against its schema */
export interface PastedEntities {
    machines: MachineConfiguration[];
    drills: MiningDrillConfiguration[];
    inserters: InserterConfiguration[];
    belts: BeltConfiguration[];
    chests: ChestConfiguration[];
    /** Guidance for the user from the import pipeline, e.g. that the sidecar mod is too old to export something */
    guidance: Option<string>;
    /** The target output the paste suggests: the mod's own, else worked out from the machines */
    suggested_target: Option<SuggestedTarget>;
    /** The ids of the machines an older Sidecar named only by kind, which got a machine picked for their recipe */
    picked_machines?: number[];
}

/**
 * What the main thread, which loads none of the engine, asks of it. One worker answers these, so they are not held
 * up by a generation running on the others.
 */
export type EngineQuery =
    | { kind: 'timeline-recording'; request: RecordTimelineRequest }
    | { kind: 'lookups' }
    | { kind: 'machine-facts'; params: ComputeMachineFactsParams }
    | { kind: 'machine-target-rates'; config: Config }
    | { kind: 'inserter-coverage'; config: Config }
    | { kind: 'repeated-unit-conversion'; config: Config }
    /** The form state saved in localStorage, migrated but not yet checked against the config schema */
    | { kind: 'saved-config'; config: unknown }
    /**
     * An imported config file, with the chests of files from before chest types migrated; like the saved config, it may
     * hold values out of bounds, which the form shows
     */
    | { kind: 'config-file'; config: unknown }
    | {
        kind: 'pasted-entities';
        machines: unknown;
        drills: unknown;
        inserters: unknown;
        belts: unknown;
        chests: unknown;
        sidecar_version: unknown;
        pickup_warnings?: unknown;
        suggested_target: unknown;
    };

export interface LiveCoverage {
    issues: InserterCoverageIssue[];
    refusal: string | null;
    /** The engine's warning for belt pickups outside 16-item hands on 4-item belt stacks, which does not block generation */
    pickupNotTested: string | null;
    /** The engine's warning for belt lanes that the copies, summed, would ask for more than they carry; it does not block */
    laneSharedByCopies: string | null;
    /** The engine's note for drops marked as side-loading onto another belt, a known limit; it does not block */
    sideLoadedDrop: string | null;
    /** The engine's note for drops that fill the lanes of a belt exactly, which does not block */
    lanesExactlyFull: string | null;
    /** The engine's note that the copies' gap is needed to check their drops onto a belt, which does not block */
    copyGapNeeded: string | null;
    /** The engine's note on whether the copies' drops fit between each other at the period estimated from the settings, shown under the gap between copies */
    dropRoom: string | null;
    /** The engine's warnings for machines whose prototype disagrees with their type or cannot make their recipe; they do not block */
    machinePrototypes: MachinePrototypeIssue[];
}

export interface EngineAnswers {
    'timeline-recording': TimelineRecording;
    'lookups': FactorioLookups;
    /** Null when they cannot be worked out, e.g. for an unknown recipe */
    'machine-facts': SerializableMachineFacts | null;
    'machine-target-rates': MachineTargetRate[];
    /**
     * The coverage of each machine, or the refusal of the first inserter that is out of scope (a belt pickup by another
     * inserter than the legendary stack inserter, a blacklist, a side-loaded pickup) with no coverage, as Check does; and
     * the warning for belt pickups whose timing is not tested, as generation logs it
     */
    'inserter-coverage': LiveCoverage;
    'repeated-unit-conversion': CheckedRepeatedUnitConversion;
    /** Why the saved config cannot be used; null when it can */
    /**
     * The saved form state with each machine's former type read as its machine, to load in its place, and why it cannot
     * be loaded, or null when it can
     */
    'saved-config': { problem: string | null; form: unknown };
    'config-file': Config;
    'pasted-entities': PastedEntities;
}

/** Answered by 'answer', or by 'query-failed' with the message of what the engine threw */
export interface QueryRequest {
    type: 'query';
    requestId: number;
    query: EngineQuery;
}
