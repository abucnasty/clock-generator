import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Config, ConfigValidation, DebugSteps, LogMessage, SerializableClockWindows, SerializableTransferHistory, SerializableStateTransitionHistory, SwingBackoffReport, GenerationProgress } from 'clock-generator/browser';
import { combineClockAlternativeRuns, searchesAreNeeded } from 'clock-generator/light';
import type { ClockAlternativeContext, ClockAlternativeTask } from 'clock-generator/browser';
import type { ClockAlternativeRunView, ClockAlternativeView, FuelViewData, RecipeInfo, ShiftOptionsView, WorkerRequest, WorkerResponse } from '../worker/types';
import { askEngine, createSimulationWorker, loadFactorioData } from '../worker/engineClient';
import type { GeneratedFor } from '../utils/resultsStaleness';
import { PendingChecks, type CheckOutcome } from '../utils/checkThenGenerate';
import { pickRuleOf, recommendedIndexOf, type PickRule } from '../utils/recommendedClock';
import { planGenerationRun } from '../utils/deeperSearch';
import { NO_NAMES, pickerIds, type GameNames } from '../utils/gameNames';

export type { ClockAlternativeView, RecipeInfo } from '../worker/types';

/**
 * Where the check stands. `config` is the config the result or error is for, so the page can tell when
 * the user has changed something since.
 */
export type ValidationState =
    | { status: 'none' }
    | { status: 'running'; config: Config }
    | { status: 'valid'; config: Config; validation: ConfigValidation }
    | { status: 'invalid'; config: Config; message: string };

interface UseSimulationWorkerResult {
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
    initialize: () => void;
    /** Generates clocks for `config`; `searchDeeper` runs the slower searches this once, without changing what is recorded */
    runSimulation: (config: Config, debugSteps: DebugSteps, streamLogs: boolean, searchDeeper?: boolean) => void;
    /** What the last Generate was for; null when nothing is generated */
    generatedFor: GeneratedFor | null;
    /**
     * Drops the clocks, the log, the check's result and any generation still running, for when the build is
     * replaced as a whole (Import, Paste, Reset). Answers still on their way for the dropped work are ignored.
     */
    clearResults: () => void;
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
    detail?: string;
}

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
    const [alternatives, setAlternatives] = useState<ClockAlternativeView[]>([]);
    const [selectedAlternativeIndex, setSelectedAlternativeIndex] = useState(0);
    const [pendingAlternatives, setPendingAlternatives] = useState<string[]>([]);
    const [skippedSearches, setSkippedSearches] = useState<string[]>([]);
    const [searchedDeeper, setSearchedDeeper] = useState(false);
    const [pickRule, setPickRule] = useState<PickRule | null>(null);
    const [generatedFor, setGeneratedFor] = useState<GeneratedFor | null>(null);
    // set once the user picks an alternative, so results arriving later do not move the selection; selectRecommended
    // unsets it, so the selection follows the recommended clock again
    const userSelectionRef = useRef<string | null>(null);
    // the latest list published, which a render may not show yet; selectRecommended picks from it
    const alternativesRef = useRef<ClockAlternativeView[]>([]);
    const [error, setError] = useState<string | null>(null);
    const workersRef = useRef<Worker[]>([]);
    const generationRef = useRef<Generation | null>(null);
    const runIdRef = useRef(0);
    const [validation, setValidation] = useState<ValidationState>({ status: 'none' });
    // the latest validate request; answers to earlier ones are dropped
    const validationRef = useRef<{ requestId: number; config: Config } | null>(null);
    // the promises of the checks still waiting for an answer
    const [pendingChecks] = useState(() => new PendingChecks());
    // whether a check is waiting for its answer, for a worker crash to end it
    const checkRunningRef = useRef(false);

    const terminateWorkers = useCallback(() => {
        workersRef.current.forEach(worker => worker.terminate());
        workersRef.current = [];
    }, []);

    useEffect(() => terminateWorkers, [terminateWorkers]);

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
        const user_index = combined.alternatives.findIndex(it => it.id === userSelectionRef.current);
        alternativesRef.current = combined.alternatives;
        setAlternatives(combined.alternatives);
        setSelectedAlternativeIndex(user_index >= 0 ? user_index : combined.selected_index);
        const not_started = [...generation.waiting, ...generation.skipped];
        setPendingAlternatives(generation.tasks.filter(task => !generation.done.has(task.id) && !not_started.includes(task)).map(task => task.label));
        setSkippedSearches(generation.skipped.map(task => task.label));
    }, []);

    const dispatchTasks = useCallback((generation: Generation) => {
        if (generation.waiting.length > 0 && generation.queue.length === 0 && generation.running.size === 0) {
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
            } satisfies WorkerRequest);
        }
        if (generation.running.size > 0 || generation.queue.length > 0) {
            reportProgress(generation);
            return;
        }
        generationRef.current = null;
        progressStore.set(null);
        setIsRunning(false);
    }, [progressStore, publishAlternatives, reportProgress]);

    const handleResponse = useCallback((worker: Worker, response: WorkerResponse) => {
        if (response.type === 'validated' || response.type === 'validation-failed') {
            const requested = validationRef.current;
            if (requested && requested.requestId === response.requestId) {
                checkRunningRef.current = false;
                setValidation(response.type === 'validated'
                    ? { status: 'valid', config: requested.config, validation: response.validation }
                    : { status: 'invalid', config: requested.config, message: response.message });
                pendingChecks.settle(response.requestId, response.type === 'validated'
                    ? { kind: 'valid', validation: response.validation }
                    : { kind: 'invalid', message: response.message });
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
                generation.context = response.context;
                generation.tasks = response.tasks;
                generation.runs = [response.primary, ...response.tasks.map(() => null)];
                generation.waiting = response.tasks.filter(task => task.only_when_needed);
                generation.queue = slowestFirst(response.tasks.filter(task => !task.only_when_needed));
                generation.completed = 1;
                generation.idle = [...workersRef.current];
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
                generationRef.current = null;
                setError(response.message);
                progressStore.set(null);
                setPendingAlternatives([]);
                setIsRunning(false);
                break;
        }
    }, [dispatchTasks, pendingChecks, progressStore, publishAlternatives, reportProgress]);

    const initialize = useCallback(async () => {
        try {
            // Generation runs in a pool of workers; the names and recipes for the forms come from the query worker
            terminateWorkers();
            const workersReady = Promise.all(Array.from({ length: workerPoolSize() }, () => new Promise<void>((resolve, reject) => {
                const worker = createSimulationWorker();
                workersRef.current.push(worker);
                let started = false;
                worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    const response = event.data;
                    if (response.type === 'initialized') {
                        started = true;
                        resolve();
                    } else if (response.type === 'error' && response.runId === undefined) {
                        reject(new Error(response.message));
                    }
                    handleResponse(worker, response);
                };
                worker.onerror = (event) => {
                    // a check waiting for its answer on this worker ends as failed, so Generate and the alert do not
                    // wait forever
                    const check = validationRef.current;
                    if (started && checkRunningRef.current && check && worker === workersRef.current[0]) {
                        const message = event.message || 'The check stopped unexpectedly';
                        checkRunningRef.current = false;
                        setValidation({ status: 'invalid', config: check.config, message });
                        pendingChecks.settle(check.requestId, { kind: 'invalid', message });
                    }
                    // once started, a crash only matters to a generation still on screen; one dropped by Import,
                    // Paste or Reset must not put an error over the empty Results
                    if (started && !generationRef.current) {
                        return;
                    }
                    generationRef.current = null;
                    setError(event.message || 'Simulation worker failed');
                    progressStore.set(null);
                    setIsRunning(false);
                    reject(new Error(event.message));
                };
                loadFactorioData().then(
                    data => worker.postMessage({ type: 'initialize', factorioData: data } satisfies WorkerRequest),
                    reject,
                );
            })));

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
        }
    }, [handleResponse, pendingChecks, progressStore, terminateWorkers]);

    const runSimulation = useCallback((config: Config, debugSteps: DebugSteps, streamLogs: boolean, searchDeeper = false) => {
        const worker = workersRef.current[0];
        if (!worker) {
            setError('Not initialized');
            return;
        }

        // the engine may get the deeper search for this run; the results are recorded as made for the form's config
        const run = planGenerationRun(config, searchDeeper);
        const engineConfig = run.engineConfig;
        setGeneratedFor(run.generatedFor);
        setSearchedDeeper(run.searchedDeeper);
        setIsRunning(true);
        progressStore.set(null);
        alternativesRef.current = [];
        setAlternatives([]);
        setSelectedAlternativeIndex(0);
        setPendingAlternatives([]);
        setSkippedSearches([]);
        setPickRule(pickRuleOf(engineConfig));
        userSelectionRef.current = null;
        setError(null);
        setLogs([]);
        const runId = ++runIdRef.current;
        generationRef.current = {
            runId, config: engineConfig, debugSteps, streamLogs, context: null, tasks: [], queue: [], waiting: [], skipped: [], runs: [],
            running: new Map(), done: new Set(), idle: [], completed: 0,
        };
        worker.postMessage({ type: 'plan', runId, config: engineConfig, debugSteps, streamLogs } satisfies WorkerRequest);
    }, [progressStore]);

    const validate = useCallback((config: Config): Promise<CheckOutcome> => {
        const worker = workersRef.current[0];
        if (!worker) {
            setError('Not initialized');
            return Promise.resolve({ kind: 'dropped' });
        }
        const requestId = (validationRef.current?.requestId ?? 0) + 1;
        validationRef.current = { requestId, config };
        checkRunningRef.current = true;
        const outcome = pendingChecks.begin(requestId);
        setValidation({ status: 'running', config });
        worker.postMessage({ type: 'validate', requestId, config } satisfies WorkerRequest);
        return outcome;
    }, [pendingChecks]);

    const clearResults = useCallback(() => {
        // the running generation's later answers no longer match it, so they are ignored
        generationRef.current = null;
        progressStore.set(null);
        setIsRunning(false);
        alternativesRef.current = [];
        setAlternatives([]);
        setSelectedAlternativeIndex(0);
        setPendingAlternatives([]);
        setSkippedSearches([]);
        setSearchedDeeper(false);
        setPickRule(null);
        userSelectionRef.current = null;
        setLogs([]);
        setGeneratedFor(null);
        setValidation({ status: 'none' });
        // a check answer still on its way matches no request; the next request gets a new id
        validationRef.current = validationRef.current && { ...validationRef.current, requestId: validationRef.current.requestId + 1 };
        checkRunningRef.current = false;
        // a Generate waiting on a check does not start after the build was replaced
        pendingChecks.dropAll();
        // until the workers are ready, the error is one that stopped them starting, and stays
        if (isInitialized) {
            setError(null);
        }
    }, [pendingChecks, progressStore, isInitialized]);

    const selectAlternative = useCallback((index: number) => {
        userSelectionRef.current = alternatives[index]?.id ?? null;
        setSelectedAlternativeIndex(index);
    }, [alternatives]);

    const recommendedIndex = useMemo(() => recommendedIndexOf(alternatives), [alternatives]);

    const selectRecommended = useCallback(() => {
        userSelectionRef.current = null;
        // from the latest list, not the rendered one: a clock that arrived just before the click can move the pick
        setSelectedAlternativeIndex(recommendedIndexOf(alternativesRef.current) ?? 0);
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
    }, []);

    const getRecipeInfo = useCallback((recipeName: string): RecipeInfo | null => recipes.get(recipeName) ?? null, [recipes]);

    const selected: ClockAlternativeView | undefined = alternatives[selectedAlternativeIndex];

    return {
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
        initialize,
        runSimulation,
        generatedFor,
        clearResults,
        clearLogs,
        getRecipeInfo,
    };
}
