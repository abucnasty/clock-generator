import type { ValidationDiagnostic } from '../utils/buildValidation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Config, ConfigValidation, DebugSteps, LogMessage, SerializableClockWindows, SerializableTransferHistory, SerializableStateTransitionHistory, SwingBackoffReport, GenerationProgress } from 'clock-generator/browser';
import { combineClockAlternativeRuns, searchesAreNeeded } from 'clock-generator/light';
import type { ClockAlternativeContext, ClockAlternativeTask } from 'clock-generator/browser';
import type { ClockAlternativeRunView, ClockAlternativeView, FuelViewData, RecipeInfo, ShiftOptionsView, WorkerRequest, WorkerResponse } from '../worker/types';
import { askEngine, createSimulationWorker, loadFactorioData } from '../worker/engineClient';
import type { GeneratedFor } from '../utils/resultsStaleness';
import { CHECK_TEXT, PendingChecks, type CheckOutcome } from '../utils/checkThenGenerate';
import { pickRuleOf, recommendedIndexOf, type PickRule } from '../utils/recommendedClock';
import { planGenerationRun } from '../utils/deeperSearch';
import { NO_NAMES, pickerIds, type GameNames } from '../utils/gameNames';
import { plainClockName } from '../utils/clockSummary';
import { afterCancel, keyToShow, selectionAfterRun, type DroppedResults, type KeptPick, type KeptResults, type RunStop, type ShownResults } from '../utils/resultsCache';
import { openResultsStore, readShownMarker, writeShownMarker, type ResultsStore } from '../utils/resultsStore';
import { busyWorkersOf, checkToResend, crashOutcome, replaceWorkers } from '../worker/pool';
import type { GenerationAssumptions, RepeatedUnitsRecovery } from '../worker/types';

export type { ClockAlternativeView, RecipeInfo } from '../worker/types';

/**
 * Where the check stands. `config` is the config the result or error is for, so the page can tell when
 * the user has changed something since.
 */
export type ValidationState =
    | { status: 'none' }
    | { status: 'running'; config: Config }
    | { status: 'valid'; config: Config; validation: ConfigValidation }
    /** `crashed`: the check's worker stopped, so the build was not judged; Generate checks again */
    | { status: 'invalid'; config: Config; message: string; crashed?: boolean; recovery?: RepeatedUnitsRecovery;
        diagnostics?: ValidationDiagnostic[] };

interface UseSimulationWorkerResult {
    generationAssumptions: GenerationAssumptions | null;
    isInitialized: boolean;
    isRunning: boolean;
    /** Progress lives outside React state so its frequent updates only re-render what reads it */
    progressStore: GenerationProgressStore;
    recipeNames: string[];
    /** Recipes the open list leaves out and a typed search finds */
    searchOnlyRecipes: string[];
    itemNames: string[];
    resourceNames: string[];
    /** The in-game names of the ids above */
    gameNames: GameNames;
    logs: LogMessage[];
    blueprintString: string | null;
    transferHistory: SerializableTransferHistory | null;
    stateTransitionHistory: SerializableStateTransitionHistory | null;
    /** The selected clock driven only by its exported windows; null when the histories above already are that run */
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
    /** The selected clock's fuel use and exported fuel clocks; null when no inserter only fills a fuel slot */
    fuelView: FuelViewData | null;
    clockWindows: SerializableClockWindows | null;
    /** Places tried for the cycle or output swing the selected clock moved; null for other clocks */
    shiftOptions: ShiftOptionsView | null;
    simulationDurationTicks: number | null;
    swingBackoffReport: SwingBackoffReport | null;
    alternatives: ClockAlternativeView[];
    selectedAlternativeIndex: number;
    selectAlternative: (index: number) => void;
    /** Index of the clock the selection rule picks, whichever is selected; null while there are no clocks */
    recommendedIndex: number | null;
    /** Selects the recommended clock and lets the selection follow it again */
    selectRecommended: () => void;
    /** What the selection rule was given by the config of the latest generation; null before one */
    pickRule: PickRule | null;
    /** Labels of alternatives still being generated; the finished ones are already in `alternatives` */
    pendingAlternatives: string[];
    /** Labels of the searches that were not run, because a clock made without one can be selected as stable */
    skippedSearches: string[];
    /**
     * True when the searches ran because the run asked for them, by the switch or by Search deeper, not because they
     * were needed
     */
    searchedDeeper: boolean;
    validation: ValidationState;
    /**
     * Checks the config and plans its transfers in a worker, without generating a clock. Resolves when the check ends;
     * `dropped` when Import, Paste, Reset or a newer check replaced it. Never rejects
     */
    validate: (config: Config) => Promise<CheckOutcome>;
    error: string | null;
    errorRecovery: RepeatedUnitsRecovery | null;
    initialize: () => void;
    /** Generates clocks for `config`; `searchDeeper` runs the slower searches this once, without changing what is recorded */
    runSimulation: (config: Config, debugSteps: DebugSteps, streamLogs: boolean, searchDeeper?: boolean) => void;
    /** What the last Generate was for; null when nothing is generated */
    generatedFor: GeneratedFor | null;
    /**
     * Drops the clocks, the log, the check's result and any generation still running (its workers are stopped), for
     * when the build is replaced as a whole (Import, Paste, Reset). The clocks on screen are set aside for the build
     * with `formKey`, so that an Undo, which puts that build back, brings them back too.
     */
    clearResults: (options?: { formKey?: string }) => void;
    /**
     * Stops the generation or the check that is running, at once: the workers doing it are replaced. What shows after
     * it is `afterCancel`'s; nothing happens when nothing runs.
     */
    cancel: () => void;
    /** The last Cancel and what it left on screen; null before one */
    lastStop: RunStop | null;
    /** The results on screen are of a run the player stopped */
    stoppedEarly: boolean;
    /** The clock the player picked, which the last run did not make; null when it did, or there was no pick */
    pickGone: { label: string } | null;
    /** Bumped each time kept results come back on an empty Results (not on load) */
    restoredId: number;
    /**
     * Shows the results kept for the build with `key` (`keyToShow`): on load, or, `replace`, when Results is empty.
     * Resolves whether something was shown; a restore overtaken by a run, a clear or another restore shows nothing.
     * `announce: false` keeps a `replace` from bumping `restoredId`, for a switch of build that announces itself.
     */
    restoreResultsFor: (key: string, mode: 'load' | 'replace', options?: { announce?: boolean }) => Promise<boolean>;
    /** The kept results can be looked up (IndexedDB is open, or memory is used instead) */
    resultsStoreReady: boolean;
    clearLogs: () => void;
    getRecipeInfo: (recipeName: string) => RecipeInfo | null;
}

const PRIMARY_STEP = 'Batched swings';
// the slowest alternatives start first so they overlap the most
const SLOW_TASKS = ['full-hand', 'uneven-output', 'derived', 'fractional'];
const slowestFirst = (tasks: ClockAlternativeTask[]) => [...tasks].sort((a, b) =>
    Number(SLOW_TASKS.includes(b.id)) - Number(SLOW_TASKS.includes(a.id)));

export interface GenerationProgressStore {
    get: () => GenerationProgress | null;
    set: (progress: GenerationProgress | null) => void;
    subscribe: (listener: () => void) => () => void;
}

function createProgressStore(): GenerationProgressStore {
    let value: GenerationProgress | null = null;
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set: (progress) => {
            value = progress;
            listeners.forEach(listener => listener());
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export function useGenerationProgress(store: GenerationProgressStore): GenerationProgress | null {
    return useSyncExternalStore(store.subscribe, store.get);
}

function workerPoolSize(): number {
    return Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, 6));
}

/**
 * One generation: a plan on one worker, then its tasks spread over the pool. The searches that only run when needed
 * wait for the other tasks, and are then queued or left out.
 */
interface Generation {
    assumptions: GenerationAssumptions | null;
    runId: number;
    config: Config;
    debugSteps: DebugSteps;
    streamLogs: boolean;
    context: ClockAlternativeContext | null;
    tasks: ClockAlternativeTask[];
    queue: ClockAlternativeTask[];
    /** The searches that wait for every other task: whether they run is decided from the runs of those */
    waiting: ClockAlternativeTask[];
    /** The searches that were not run */
    skipped: ClockAlternativeTask[];
    /** Primary run first, then one per task in display order */
    runs: (ClockAlternativeRunView | null)[];
    running: Map<Worker, ClockAlternativeTask>;
    done: Set<string>;
    idle: Worker[];
    completed: number;
    /** The planning worker is still assessing the primary alternative, after it sent the tasks */
    primaryPending: boolean;
    /** Clocks the primary alternative assesses, which a task that makes one again need not assess */
    assessedSignatures: string[];
    detail?: string;
    /** What was on screen when it started, for a Cancel to bring back */
    previous: ShownResults | null;
    generatedFor: GeneratedFor;
    pickRule: PickRule;
    searchedDeeper: boolean;
}

/** The result fields published together, including the clocks of an in-progress run. */
type ResultsView = Pick<UseSimulationWorkerResult,
    'generationAssumptions' | 'alternatives' | 'selectedAlternativeIndex' | 'pendingAlternatives' |
    'skippedSearches' | 'searchedDeeper' | 'pickRule' | 'generatedFor' | 'stoppedEarly' | 'pickGone'>;

const emptyResults = (): ResultsView => ({
    generationAssumptions: null, alternatives: [], selectedAlternativeIndex: 0, pendingAlternatives: [],
    skippedSearches: [], searchedDeeper: false, pickRule: null, generatedFor: null, stoppedEarly: false, pickGone: null,
});

/** The kept results, opened once for the page (StrictMode mounts the hook twice) */
let sharedResultsStore: Promise<ResultsStore> | null = null;
const resultsStore = () => (sharedResultsStore ??= openResultsStore());

export function useSimulationWorker(): UseSimulationWorkerResult {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [progressStore] = useState(createProgressStore);
    const [recipeNames, setRecipeNames] = useState<string[]>([]);
    const [searchOnlyRecipes, setSearchOnlyRecipes] = useState<string[]>([]);
    const [itemNames, setItemNames] = useState<string[]>([]);
    const [resourceNames, setResourceNames] = useState<string[]>([]);
    const [gameNames, setGameNames] = useState<GameNames>(NO_NAMES);
    const [recipes, setRecipes] = useState<Map<string, RecipeInfo>>(() => new Map());
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [resultsView, setResultsView] = useState(emptyResults);
    // Worker messages and selection clicks can arrive before React renders the last publication.
    const resultsViewRef = useRef(resultsView);
    const updateResults = useCallback((patch: Partial<ResultsView>) => {
        const next = { ...resultsViewRef.current, ...patch };
        resultsViewRef.current = next;
        setResultsView(next);
    }, []);
    const {
        generationAssumptions, alternatives, selectedAlternativeIndex, pendingAlternatives, skippedSearches,
        searchedDeeper, pickRule, generatedFor, stoppedEarly, pickGone,
    } = resultsView;
    const [lastStop, setLastStop] = useState<RunStop | null>(null);
    const [restoredId, setRestoredId] = useState(0);
    const [resultsStoreReady, setResultsStoreReady] = useState(false);
    // The explicit pick survives streaming updates; a new generation follows its recommendation again.
    const userSelectionRef = useRef<KeptPick>(null);
    const [error, setError] = useState<string | null>(null);
    const [errorRecovery, setErrorRecovery] = useState<RepeatedUnitsRecovery | null>(null);
    const workersRef = useRef<Worker[]>([]);
    // startup failures stay in their slots until an explicit Check only or Generate retries them
    const unusableWorkersRef = useRef(new Set<Worker>());
    const generationRef = useRef<Generation | null>(null);
    const runIdRef = useRef(0);
    const [validation, setValidation] = useState<ValidationState>({ status: 'none' });
    // the check state as rendered, and as it was before the running check, which a Cancel puts back
    const validationStateRef = useRef(validation);
    const validationBeforeRef = useRef<ValidationState>({ status: 'none' });
    // the latest validate request; answers to earlier ones are dropped
    const validationRef = useRef<{ requestId: number; config: Config } | null>(null);
    // the promises of the checks still waiting for an answer
    const [pendingChecks] = useState(() => new PendingChecks());
    // whether a check is waiting for its answer, for a worker crash or a Cancel to end it
    const checkRunningRef = useRef(false);
    // the complete (or stopped) results on screen with their pick; a run's clocks while it goes are not in it
    const shownRef = useRef<ShownResults | null>(null);
    // the results set aside by the last Import, Paste or Reset, for its Undo
    const droppedRef = useRef<DroppedResults | null>(null);
    const storeRef = useRef<ResultsStore | null>(null);
    // bumped by every restore, run and clear: a restore that resolves after a newer one of these shows nothing
    const restoreTokenRef = useRef(0);
    const stopIdRef = useRef(0);
    // starts a worker in place of one that is replaced; set once the handlers it needs exist
    const startWorkerRef = useRef<() => Worker>(() => {
        throw new Error('Not initialized');
    });

    useEffect(() => {
        validationStateRef.current = validation;
    }, [validation]);

    useEffect(() => {
        let mounted = true;
        void resultsStore().then((store) => {
            storeRef.current = store;
            if (mounted) setResultsStoreReady(true);
        });
        return () => {
            mounted = false;
        };
    }, []);

    const terminateWorkers = useCallback(() => {
        workersRef.current.forEach(worker => worker.terminate());
        workersRef.current = [];
        unusableWorkersRef.current.clear();
    }, []);

    useEffect(() => terminateWorkers, [terminateWorkers]);

    /**
     * Terminates `busy` and starts a worker in each of their places. A check still waiting for its answer on the first
     * worker is sent again to the one that takes its place (which holds it until it has loaded the data)
     */
    const replace = useCallback((busy: Worker[]) => {
        const before = workersRef.current;
        workersRef.current = replaceWorkers(before, busy, () => startWorkerRef.current());
        busy.forEach(worker => unusableWorkersRef.current.delete(worker));
        const resend = checkToResend(before, workersRef.current, checkRunningRef.current ? validationRef.current : null);
        if (resend) {
            workersRef.current[0].postMessage({ type: 'validate', requestId: resend.requestId, config: resend.config } satisfies WorkerRequest);
        }
    }, []);

    /** What is on screen, kept for a Cancel and, by its key, for a reload of this tab */
    const setShown = useCallback((shown: ShownResults | null) => {
        shownRef.current = shown;
        writeShownMarker(shown?.results.generatedFor.key ?? null);
    }, []);

    /** The workers the generation keeps busy: every one running a task, and the first one while it plans */
    const busyWorkersFor = useCallback((generation: Generation) => busyWorkersOf(workersRef.current, {
        running: generation.running.keys(),
        planning: generation.context === null || generation.primaryPending,
        checking: false,
    }), []);

    const reportProgress = useCallback((generation: Generation) => {
        const running = Array.from(generation.running.values(), task => task.label);
        progressStore.set({
            step: generation.context ? running.join(', ') : PRIMARY_STEP,
            detail: generation.detail,
            completed: generation.completed,
            // the searches are counted once it is known that they run
            total: generation.context ? 1 + generation.tasks.length - generation.waiting.length - generation.skipped.length : null,
        });
    }, [progressStore]);

    const publishAlternatives = useCallback((generation: Generation) => {
        const combined = combineClockAlternativeRuns(generation.runs, it => it.ranking);
        const user_index = combined.alternatives.findIndex(it => it.id === userSelectionRef.current?.id);
        const not_started = [...generation.waiting, ...generation.skipped];
        updateResults({
            generationAssumptions: generation.assumptions,
            alternatives: combined.alternatives,
            selectedAlternativeIndex: user_index >= 0 ? user_index : combined.selected_index,
            pendingAlternatives: generation.tasks.filter(task => !generation.done.has(task.id) && !not_started.includes(task)).map(task => task.label),
            skippedSearches: generation.skipped.map(task => task.label),
        });
    }, [updateResults]);

    /** The generation's clocks so far, as they are kept */
    const keptResultsOf = useCallback((generation: Generation, stopped: boolean): KeptResults => ({
        generatedFor: generation.generatedFor,
        generationAssumptions: generation.assumptions === null ? null : { ...generation.assumptions, complete: !stopped },
        alternatives: resultsViewRef.current.alternatives,
        pickRule: generation.pickRule,
        skippedSearches: generation.skipped.map(task => task.label),
        searchedDeeper: generation.searchedDeeper,
        stopped,
        lean: false,
    }), []);

    /** Keeps results that are on screen now, for a reload and a Cancel to bring back */
    const keepShown = useCallback((shown: ShownResults) => {
        setShown(shown);
        if (shown.results.alternatives.length > 0) {
            void storeRef.current?.put(shown.results, shown.pick, Date.now());
        }
    }, [setShown]);

    /** Puts results on screen as a run would leave them, the pick selected when they have it */
    const showResults = useCallback((shown: ShownResults) => {
        const { results } = shown;
        const { index, pickGone: lost } = selectionAfterRun(results.alternatives, shown.pick, recommendedIndexOf(results.alternatives));
        const pick = lost ? null : shown.pick;
        userSelectionRef.current = pick;
        setShown({ results, pick });
        updateResults({
            generationAssumptions: results.generationAssumptions,
            alternatives: results.alternatives,
            selectedAlternativeIndex: index,
            pendingAlternatives: [],
            skippedSearches: results.skippedSearches,
            searchedDeeper: results.searchedDeeper,
            pickRule: results.pickRule,
            generatedFor: results.generatedFor,
            stoppedEarly: results.stopped,
            pickGone: null,
        });
        setLogs([]);
        setError(null);
        setErrorRecovery(null);
    }, [setShown, updateResults]);

    /** Empties Results */
    const showNothing = useCallback(() => {
        setShown(null);
        updateResults(emptyResults());
    }, [setShown, updateResults]);

    /** Ends the generation where it stands: its workers are replaced, and the screen is what `afterCancel` says */
    const stopGeneration = useCallback((generation: Generation): RunStop['kept'] => {
        replace(busyWorkersFor(generation));
        generationRef.current = null;
        progressStore.set(null);
        updateResults({ pendingAlternatives: [] });
        setIsRunning(false);
        const outcome = afterCancel({ runKey: generation.generatedFor.key, clocksMade: resultsViewRef.current.alternatives.length, previous: generation.previous });
        switch (outcome.kind) {
            case 'previous':
                showResults(outcome.shown);
                break;
            case 'partial':
                updateResults({ stoppedEarly: true });
                keepShown({ results: keptResultsOf(generation, true), pick: userSelectionRef.current });
                break;
            case 'none':
                showNothing();
                break;
        }
        return outcome.kind;
    }, [busyWorkersFor, keepShown, keptResultsOf, progressStore, replace, showNothing, showResults, updateResults]);

    /** A generation that failed or lost a worker ends with its error; its other busy workers are replaced */
    const endRunWithError = useCallback((message: string, except?: Worker, recovery?: RepeatedUnitsRecovery) => {
        const generation = generationRef.current;
        if (!generation) {
            return;
        }
        replace(busyWorkersFor(generation).filter(worker => worker !== except));
        generationRef.current = null;
        // the clocks on screen are part of a failed run: a pick among them is not kept for the build shown before it
        setShown(null);
        setError(message);
        setErrorRecovery(recovery ?? null);
        progressStore.set(null);
        updateResults({ pendingAlternatives: [] });
        setIsRunning(false);
    }, [busyWorkersFor, progressStore, replace, setShown, updateResults]);

    const dispatchTasks = useCallback((generation: Generation) => {
        if (generation.waiting.length > 0 && generation.queue.length === 0 && generation.running.size === 0 && !generation.primaryPending) {
            // every clock made without a search is in: the searches run when none of them can be selected as stable
            const searches = generation.waiting;
            generation.waiting = [];
            if (searchesAreNeeded(generation.runs, it => it.ranking)) {
                generation.queue = slowestFirst(searches);
            } else {
                generation.skipped = searches;
            }
            publishAlternatives(generation);
        }
        while (generation.idle.length > 0 && generation.queue.length > 0) {
            const worker = generation.idle.pop()!;
            const task = generation.queue.shift()!;
            generation.running.set(worker, task);
            worker.postMessage({
                type: 'task',
                runId: generation.runId,
                config: generation.config,
                debugSteps: generation.debugSteps,
                streamLogs: generation.streamLogs,
                context: generation.context!,
                taskId: task.id,
                assessedSignatures: generation.assessedSignatures,
            } satisfies WorkerRequest);
        }
        if (generation.running.size > 0 || generation.queue.length > 0 || generation.primaryPending) {
            reportProgress(generation);
            return;
        }
        generationRef.current = null;
        progressStore.set(null);
        setIsRunning(false);
        if (generation.assumptions) {
            generation.assumptions = { ...generation.assumptions, complete: true };
            updateResults({ generationAssumptions: generation.assumptions });
        }
        // A completed generation always opens its new recommendation, including after inspecting a clock mid-run.
        const made = resultsViewRef.current.alternatives;
        userSelectionRef.current = null;
        updateResults({ pickGone: null, selectedAlternativeIndex: recommendedIndexOf(made) ?? 0 });
        keepShown({ results: keptResultsOf(generation, false), pick: null });
    }, [keepShown, keptResultsOf, progressStore, publishAlternatives, reportProgress, updateResults]);

    const handleResponse = useCallback((worker: Worker, response: WorkerResponse) => {
        if (response.type === 'validated' || response.type === 'validation-failed') {
            const requested = validationRef.current;
            if (requested && requested.requestId === response.requestId) {
                checkRunningRef.current = false;
                setValidation(response.type === 'validated'
                    ? { status: 'valid', config: requested.config, validation: response.validation }
                    : { status: 'invalid', config: requested.config, message: response.message, recovery: response.recovery, diagnostics: response.diagnostics });
                pendingChecks.settle(response.requestId, response.type === 'validated'
                    ? { kind: 'valid', validation: response.validation }
                    : { kind: 'invalid', message: response.message, recovery: response.recovery });
            }
            return;
        }
        // queries go to the query worker (see askEngine), not to the pool
        if (response.type === 'answer' || response.type === 'query-failed') {
            return;
        }
        const generation = generationRef.current;
        if (response.type === 'initialized' || !generation || response.runId !== generation.runId) {
            if (response.type === 'error' && response.runId === undefined) {
                setError(response.message);
                setErrorRecovery(null);
            }
            return;
        }
        switch (response.type) {
            case 'log':
                setLogs(previous => [...previous, ...response.messages]);
                break;
            case 'progress': {
                const label = generation.running.get(worker)?.label;
                generation.detail = label ? `${label}: ${response.detail}` : response.detail;
                reportProgress(generation);
                break;
            }
            case 'planned':
                generation.assumptions = { ...response.assumptions, complete: false };
                generation.context = response.context;
                generation.tasks = response.tasks;
                generation.runs = [null, ...response.tasks.map(() => null)];
                generation.waiting = response.tasks.filter(task => task.only_when_needed);
                generation.queue = slowestFirst(response.tasks.filter(task => !task.only_when_needed));
                generation.primaryPending = true;
                generation.assessedSignatures = [response.primarySignature];
                // the planning worker goes on with the primary alternative
                generation.idle = workersRef.current.filter(it => it !== worker);
                dispatchTasks(generation);
                break;
            case 'primary-completed':
                generation.runs[0] = response.primary;
                generation.primaryPending = false;
                generation.completed++;
                generation.idle.push(worker);
                publishAlternatives(generation);
                dispatchTasks(generation);
                break;
            case 'task-completed': {
                generation.runs[1 + generation.tasks.findIndex(task => task.id === response.taskId)] = response.run;
                generation.running.delete(worker);
                generation.idle.push(worker);
                generation.completed++;
                generation.done.add(response.taskId);
                publishAlternatives(generation);
                dispatchTasks(generation);
                break;
            }
            case 'error':
                console.error('Simulation error:', response.message, response.stack);
                // the other tasks of the run are thrown away: their workers stop now, not when they are done
                endRunWithError(response.message, worker, response.recovery);
                break;
        }
    }, [dispatchTasks, endRunWithError, pendingChecks, publishAlternatives, reportProgress]);

    /**
     * A worker that stopped unexpectedly: a check it was running ends as failed (and Generate checks again), a
     * generation running ends with an error, and the worker is replaced once it had started (one that never loaded the
     * data waits for the next explicit Check only or Generate, so a failed startup cannot keep trying). The player is
     * told it was not their build; the browser's own words go to the Log.
     */
    const handleCrash = useCallback((worker: Worker, detail: string, started: boolean) => {
        if (!workersRef.current.includes(worker) || unusableWorkersRef.current.has(worker)) {
            return;
        }
        if (!started) {
            unusableWorkersRef.current.add(worker);
            worker.terminate();
        }
        setLogs(previous => [...previous, { level: 'error', message: `A simulation worker stopped: ${detail}`, timestamp: Date.now() }]);
        console.error('Simulation worker stopped:', detail);
        const check = validationRef.current;
        const outcome = crashOutcome({
            started,
            isCheckWorker: worker === workersRef.current[0],
            checkRunning: checkRunningRef.current && check !== null,
            runOnScreen: generationRef.current !== null,
        });
        if (outcome.settleCheck && check) {
            checkRunningRef.current = false;
            setValidation({ status: 'invalid', config: check.config, message: CHECK_TEXT.crashText, crashed: true });
            pendingChecks.settle(check.requestId, { kind: 'invalid', message: CHECK_TEXT.crashText });
        }
        // any crash ends a generation on screen (one dropped by Import, Paste or Reset is not on screen)
        if (outcome.endRun) {
            endRunWithError(CHECK_TEXT.generationCrashed, worker);
        }
        if (outcome.replace) {
            replace([worker]);
        }
    }, [endRunWithError, pendingChecks, replace]);

    /**
     * Starts a worker and hands it the game data; `ready` resolves once it has loaded it. A worker started in place of
     * another is used at once: it holds its requests until it is ready.
     */
    const startWorker = useCallback((replacement: boolean): { worker: Worker; ready: Promise<void> } => {
        const worker = createSimulationWorker();
        let started = false;
        const current = () => workersRef.current.includes(worker) && !unusableWorkersRef.current.has(worker);
        const ready = new Promise<void>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                if (!current()) return;
                const response = event.data;
                if (response.type === 'initialized') {
                    started = true;
                    resolve();
                } else if (!started && response.type === 'error' && response.runId === undefined) {
                    reject(new Error(response.message));
                    return;
                }
                handleResponse(worker, response);
            };
            worker.onerror = (event) => {
                if (!current()) return;
                const message = event.message || 'The simulation worker stopped unexpectedly';
                if (!started) {
                    reject(new Error(message));
                    return;
                }
                handleCrash(worker, message, started);
            };
            loadFactorioData().then(
                data => {
                    if (current()) worker.postMessage({ type: 'initialize', factorioData: data } satisfies WorkerRequest);
                },
                reject,
            );
        });
        // all startup failures end what a replacement was given, without starting an automatic retry loop
        ready.catch((error: Error) => {
            if (replacement && current()) handleCrash(worker, error.message, false);
        });
        return { worker, ready };
    }, [handleCrash, handleResponse]);

    useEffect(() => {
        startWorkerRef.current = () => startWorker(true).worker;
    }, [startWorker]);

    const initialize = useCallback(async () => {
        try {
            // Generation runs in a pool of workers; the names and recipes for the forms come from the query worker
            terminateWorkers();
            const pool = Array.from({ length: workerPoolSize() }, () => startWorker(false));
            workersRef.current = pool.map(it => it.worker);
            const workersReady = Promise.all(pool.map(it => it.ready));

            const lookups = await askEngine({ kind: 'lookups' });
            // the pickers offer no mod, internal or hidden entry; a build that holds one still shows it
            setRecipeNames(pickerIds(lookups.recipeNames, new Set(lookups.hiddenRecipes)));
            // recycling recipes stay out of the open list, and a typed search finds them
            setSearchOnlyRecipes(pickerIds(lookups.hiddenRecipes.filter(name => name.endsWith('-recycling'))));
            setItemNames(pickerIds(lookups.itemNames));
            setResourceNames(pickerIds(lookups.resourceNames));
            setGameNames(lookups.names);
            setRecipes(lookups.recipes);
            await workersReady;

            setIsInitialized(true);
        } catch (err) {
            console.error('Failed to initialize:', err);
            setError(err instanceof Error ? err.message : 'Failed to initialize');
            setErrorRecovery(null);
        }
    }, [startWorker, terminateWorkers]);

    const runSimulation = useCallback((config: Config, debugSteps: DebugSteps, streamLogs: boolean, searchDeeper = false) => {
        replace(workersRef.current.filter(worker => unusableWorkersRef.current.has(worker)));
        const worker = workersRef.current[0];
        if (!worker) {
            setError('Not initialized');
            setErrorRecovery(null);
            return;
        }

        // the engine may get the deeper search for this run; the results are recorded as made for the form's config
        const run = planGenerationRun(config, searchDeeper);
        const engineConfig = run.engineConfig;
        const rule = pickRuleOf(engineConfig);
        restoreTokenRef.current++;
        // the build is accepted: an Undo of a replace is not offered any more, so what it set aside goes
        droppedRef.current = null;
        updateResults({ ...emptyResults(), generatedFor: run.generatedFor, searchedDeeper: run.searchedDeeper, pickRule: rule });
        setIsRunning(true);
        progressStore.set(null);
        // The previous ShownResults still owns its pick, so Cancel can restore it.
        userSelectionRef.current = null;
        setError(null);
        setErrorRecovery(null);
        setLogs([]);
        const runId = ++runIdRef.current;
        generationRef.current = {
            runId, config: engineConfig, debugSteps, streamLogs, context: null, tasks: [], queue: [], waiting: [], skipped: [], runs: [], assumptions: null,
            running: new Map(), done: new Set(), idle: [], completed: 0, primaryPending: false, assessedSignatures: [],
            previous: shownRef.current, generatedFor: run.generatedFor, pickRule: rule, searchedDeeper: run.searchedDeeper,
        };
        worker.postMessage({ type: 'plan', runId, config: engineConfig, debugSteps, streamLogs } satisfies WorkerRequest);
    }, [progressStore, replace, updateResults]);

    const validate = useCallback((config: Config): Promise<CheckOutcome> => {
        setErrorRecovery(null);
        replace(workersRef.current.slice(0, 1).filter(worker => unusableWorkersRef.current.has(worker)));
        const worker = workersRef.current[0];
        if (!worker) {
            setError('Not initialized');
            setErrorRecovery(null);
            return Promise.resolve({ kind: 'dropped' });
        }
        const requestId = (validationRef.current?.requestId ?? 0) + 1;
        validationRef.current = { requestId, config };
        // what a Cancel puts back: the state before the first of checks that follow each other
        if (!checkRunningRef.current) {
            validationBeforeRef.current = validationStateRef.current;
        }
        checkRunningRef.current = true;
        const outcome = pendingChecks.begin(requestId);
        setValidation({ status: 'running', config });
        worker.postMessage({ type: 'validate', requestId, config } satisfies WorkerRequest);
        return outcome;
    }, [pendingChecks, replace]);

    /** The check waiting for its answer is dropped: its promise resolves `dropped`, and a late answer matches nothing */
    const dropCheck = useCallback(() => {
        validationRef.current = validationRef.current && { ...validationRef.current, requestId: validationRef.current.requestId + 1 };
        checkRunningRef.current = false;
        pendingChecks.dropAll();
    }, [pendingChecks]);

    const cancel = useCallback(() => {
        setErrorRecovery(null);
        const generation = generationRef.current;
        if (generation) {
            const kept = stopGeneration(generation);
            setLastStop({ id: ++stopIdRef.current, kept });
            return;
        }
        if (checkRunningRef.current) {
            dropCheck();
            // a passed check for this build stays passed, its swing plan in Advanced
            setValidation(validationBeforeRef.current);
            replace(workersRef.current.slice(0, 1));
            setLastStop({ id: ++stopIdRef.current, kept: 'check' });
        }
    }, [dropCheck, replace, stopGeneration]);

    const clearResults = useCallback((options?: { formKey?: string }) => {
        setErrorRecovery(null);
        restoreTokenRef.current++;
        // a run still going stops now, and what it leaves is what is set aside
        const generation = generationRef.current;
        if (generation) {
            stopGeneration(generation);
        }
        const shown = shownRef.current;
        droppedRef.current = options?.formKey !== undefined && shown ? { formKey: options.formKey, shown } : null;
        progressStore.set(null);
        setIsRunning(false);
        showNothing();
        userSelectionRef.current = null;
        setLogs([]);
        setValidation({ status: 'none' });
        // a check answer still on its way matches no request, and a Generate waiting on a check does not start after the
        // build was replaced
        dropCheck();
        // until the workers are ready, the error is one that stopped them starting, and stays
        if (isInitialized) {
            setError(null);
        }
    }, [dropCheck, progressStore, isInitialized, showNothing, stopGeneration]);

    /** The pick changed: kept with the results on screen, unless a run is going (it keeps it when it ends) */
    const keepPick = useCallback((pick: KeptPick) => {
        userSelectionRef.current = pick;
        const shown = shownRef.current;
        if (!generationRef.current && shown) {
            setShown({ ...shown, pick });
            void storeRef.current?.setPick(shown.results.generatedFor.key, pick);
        }
    }, [setShown]);

    const selectAlternative = useCallback((index: number) => {
        const clock = alternatives[index];
        keepPick(clock ? { id: clock.id, label: plainClockName(alternatives, index) } : null);
        updateResults({ selectedAlternativeIndex: index });
    }, [alternatives, keepPick, updateResults]);

    const recommendedIndex = useMemo(() => recommendedIndexOf(alternatives), [alternatives]);

    const selectRecommended = useCallback(() => {
        keepPick(null);
        // from the latest list, not the rendered one: a clock that arrived just before the click can move the pick
        updateResults({ selectedAlternativeIndex: recommendedIndexOf(resultsViewRef.current.alternatives) ?? 0 });
    }, [keepPick, updateResults]);

    const restoreResultsFor = useCallback(async (key: string, mode: 'load' | 'replace', options?: { announce?: boolean }): Promise<boolean> => {
        const token = ++restoreTokenRef.current;
        const store = storeRef.current;
        const entries = store?.entries() ?? [];
        const dropped = droppedRef.current;
        const choice = keyToShow({ currentKey: key, mode, entries, dropped, shownKey: mode === 'load' ? readShownMarker() : null });
        if (choice === null) {
            return false;
        }
        let shown: ShownResults | null = null;
        if (choice.from === 'kept' && store) {
            const results = await store.get(choice.key);
            const pick = entries.find(entry => entry.key === choice.key)?.pick ?? null;
            shown = results && { results, pick };
        }
        // set aside by Import, Paste or Reset: also when the kept copy could not be read (or is not written yet)
        if (!shown && dropped !== null && dropped.formKey === key) {
            shown = dropped.shown;
        }
        if (!shown || token !== restoreTokenRef.current || generationRef.current) {
            return false;
        }
        showResults(shown);
        if (choice.from === 'kept' && store?.has(choice.key)) {
            void store.touch(choice.key, Date.now());
        }
        if (mode === 'replace' && options?.announce !== false) {
            setRestoredId(id => id + 1);
        }
        return true;
    }, [showResults]);

    const clearLogs = useCallback(() => {
        setLogs([]);
    }, []);

    const getRecipeInfo = useCallback((recipeName: string): RecipeInfo | null => recipes.get(recipeName) ?? null, [recipes]);

    const selected: ClockAlternativeView | undefined = alternatives[selectedAlternativeIndex];

    return {
        generationAssumptions,
        isInitialized,
        isRunning,
        progressStore,
        recipeNames,
        searchOnlyRecipes,
        resourceNames,
        itemNames,
        gameNames,
        logs,
        blueprintString: selected?.blueprintString ?? null,
        transferHistory: selected?.transferHistory ?? null,
        stateTransitionHistory: selected?.stateTransitionHistory ?? null,
        clockOnlyTransferHistory: selected?.clockOnlyTransferHistory ?? null,
        clockOnlyStateTransitionHistory: selected?.clockOnlyStateTransitionHistory ?? null,
        fuelView: selected?.fuelView ?? null,
        clockWindows: selected?.clockWindows ?? null,
        shiftOptions: selected?.shiftOptions ?? null,
        simulationDurationTicks: selected?.simulationDurationTicks ?? null,
        swingBackoffReport: selected?.swingBackoffReport ?? null,
        alternatives,
        selectedAlternativeIndex,
        selectAlternative,
        recommendedIndex,
        selectRecommended,
        pickRule,
        pendingAlternatives,
        skippedSearches,
        searchedDeeper,
        validation,
        validate,
        error,
        errorRecovery,
        initialize,
        runSimulation,
        generatedFor,
        clearResults,
        cancel,
        lastStop,
        stoppedEarly,
        pickGone,
        restoredId,
        restoreResultsFor,
        resultsStoreReady,
        clearLogs,
        getRecipeInfo,
    };
}
