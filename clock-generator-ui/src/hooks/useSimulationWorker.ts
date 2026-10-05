import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Config, DebugSteps, LogMessage, FactorioData, SerializableClockWindows, SerializableTransferHistory, SerializableStateTransitionHistory, SwingBackoffReport, SerializableTransferPlan, GenerationProgress } from 'clock-generator/browser';
import { initializeMachineFacts } from './useMachineFacts';
import type { ClockAlternativeContext, ClockAlternativeTask } from 'clock-generator/browser';
import type { ClockAlternativeRunView, ClockAlternativeView, WorkerRequest, WorkerResponse } from '../worker/types';

export type { ClockAlternativeView } from '../worker/types';

export interface RecipeInfo {
    ingredients: string[];
    results: string[];
}

export interface UseSimulationWorkerResult {
    isInitialized: boolean;
    isRunning: boolean;
    /** Progress lives outside React state so its frequent updates only re-render what reads it */
    progressStore: GenerationProgressStore;
    recipeNames: string[];
    itemNames: string[];
    resourceNames: string[];
    logs: LogMessage[];
    blueprintString: string | null;
    transferHistory: SerializableTransferHistory | null;
    stateTransitionHistory: SerializableStateTransitionHistory | null;
    /** The selected clock driven only by its exported windows; null when the histories above already are that run */
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
    clockWindows: SerializableClockWindows | null;
    simulationDurationTicks: number | null;
    swingBackoffReport: SwingBackoffReport | null;
    transferPlan: SerializableTransferPlan | null;
    usedLcm: number | null;
    alternatives: ClockAlternativeView[];
    selectedAlternativeIndex: number;
    selectAlternative: (index: number) => void;
    /** Labels of alternatives still being generated; the finished ones are already in `alternatives` */
    pendingAlternatives: string[];
    error: string | null;
    initialize: () => void;
    runSimulation: (config: Config, debugSteps: DebugSteps, streamLogs: boolean) => void;
    clearLogs: () => void;
    getRecipeInfo: (recipeName: string) => RecipeInfo | null;
}

// Dynamic imports for the clock-generator library
let FactorioDataService: typeof import('clock-generator/browser').FactorioDataService | null = null;
let combineClockAlternativeRuns: typeof import('clock-generator/browser').combineClockAlternativeRuns | null = null;

const FACTORIO_DATA_URL = '/data-filtered.json';
const PRIMARY_STEP = 'Planned + belt pickup slack';
// the slowest alternatives start first so they overlap the most
const SLOW_TASKS = ['full-hand', 'uneven-output', 'derived', 'fractional'];

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

/** One generation: a plan on one worker, then its tasks spread over the pool */
interface Generation {
    runId: number;
    config: Config;
    debugSteps: DebugSteps;
    streamLogs: boolean;
    context: ClockAlternativeContext | null;
    tasks: ClockAlternativeTask[];
    queue: ClockAlternativeTask[];
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
    const [itemNames, setItemNames] = useState<string[]>([]);
    const [resourceNames, setResourceNames] = useState<string[]>([]);
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [alternatives, setAlternatives] = useState<ClockAlternativeView[]>([]);
    const [selectedAlternativeIndex, setSelectedAlternativeIndex] = useState(0);
    const [pendingAlternatives, setPendingAlternatives] = useState<string[]>([]);
    // set once the user picks an alternative, so results arriving later do not move the selection
    const userSelectionRef = useRef<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const workersRef = useRef<Worker[]>([]);
    const generationRef = useRef<Generation | null>(null);
    const runIdRef = useRef(0);

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
            total: generation.context ? 1 + generation.tasks.length : null,
        });
    }, [progressStore]);

    const publishAlternatives = useCallback((generation: Generation) => {
        const combined = combineClockAlternativeRuns!(generation.runs, it => it.isStable, it => it.inserterWindowCount);
        const user_index = combined.alternatives.findIndex(it => it.id === userSelectionRef.current);
        setAlternatives(combined.alternatives);
        setSelectedAlternativeIndex(user_index >= 0 ? user_index : combined.selected_index);
        setPendingAlternatives(generation.tasks.filter(task => !generation.done.has(task.id)).map(task => task.label));
    }, []);

    const dispatchTasks = useCallback((generation: Generation) => {
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
    }, [progressStore, reportProgress]);

    const handleResponse = useCallback((worker: Worker, response: WorkerResponse) => {
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
                generation.queue = [...response.tasks].sort((a, b) =>
                    Number(SLOW_TASKS.includes(b.id)) - Number(SLOW_TASKS.includes(a.id)));
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
    }, [dispatchTasks, progressStore, publishAlternatives, reportProgress]);

    const initialize = useCallback(async () => {
        try {
            // Generation runs in a pool of workers; the main thread only needs the data for forms and machine facts
            terminateWorkers();
            const workersReady = Promise.all(Array.from({ length: workerPoolSize() }, () => new Promise<void>((resolve, reject) => {
                const worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), { type: 'module' });
                workersRef.current.push(worker);
                worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    const response = event.data;
                    if (response.type === 'initialized') {
                        resolve();
                    } else if (response.type === 'error' && response.runId === undefined) {
                        reject(new Error(response.message));
                    }
                    handleResponse(worker, response);
                };
                worker.onerror = (event) => {
                    generationRef.current = null;
                    setError(event.message || 'Simulation worker failed');
                    progressStore.set(null);
                    setIsRunning(false);
                    reject(new Error(event.message));
                };
                worker.postMessage({ type: 'initialize', factorioDataUrl: FACTORIO_DATA_URL } satisfies WorkerRequest);
            })));

            // Dynamically import the clock-generator browser module
            const clockGenerator = await import('clock-generator/browser');
            
            FactorioDataService = clockGenerator.FactorioDataService;
            combineClockAlternativeRuns = clockGenerator.combineClockAlternativeRuns;

            // Fetch and initialize Factorio data
            const response = await fetch(FACTORIO_DATA_URL);
            const data: FactorioData = await response.json();
            FactorioDataService.initialize(data);

            setRecipeNames(FactorioDataService.getAllRecipeNames());
            setItemNames(FactorioDataService.getAllItemNames());
            setResourceNames(FactorioDataService.getAllResourceNames());
            
            // Initialize machine facts module
            await initializeMachineFacts();
            await workersReady;
            
            setIsInitialized(true);
        } catch (err) {
            console.error('Failed to initialize:', err);
            setError(err instanceof Error ? err.message : 'Failed to initialize');
        }
    }, [handleResponse, progressStore, terminateWorkers]);

    const runSimulation = useCallback((config: Config, debugSteps: DebugSteps, streamLogs: boolean) => {
        const worker = workersRef.current[0];
        if (!worker) {
            setError('Not initialized');
            return;
        }

        setIsRunning(true);
        progressStore.set(null);
        setAlternatives([]);
        setSelectedAlternativeIndex(0);
        setPendingAlternatives([]);
        userSelectionRef.current = null;
        setError(null);
        setLogs([]);
        const runId = ++runIdRef.current;
        generationRef.current = {
            runId, config, debugSteps, streamLogs, context: null, tasks: [], queue: [], runs: [],
            running: new Map(), done: new Set(), idle: [], completed: 0,
        };
        worker.postMessage({ type: 'plan', runId, config, debugSteps, streamLogs } satisfies WorkerRequest);
    }, [progressStore]);

    const selectAlternative = useCallback((index: number) => {
        userSelectionRef.current = alternatives[index]?.id ?? null;
        setSelectedAlternativeIndex(index);
    }, [alternatives]);

    const clearLogs = useCallback(() => {
        setLogs([]);
    }, []);

    const getRecipeInfo = useCallback((recipeName: string): RecipeInfo | null => {
        if (!FactorioDataService) return null;
        try {
            const recipe = FactorioDataService.findRecipeOrThrow(recipeName);
            return {
                ingredients: recipe.ingredients.map(ing => ing.name),
                results: recipe.results.map(res => res.name),
            };
        } catch {
            return null;
        }
    }, []);

    const selected: ClockAlternativeView | undefined = alternatives[selectedAlternativeIndex];

    return {
        isInitialized,
        isRunning,
        progressStore,
        recipeNames,
        resourceNames,
        itemNames,
        logs,
        blueprintString: selected?.blueprintString ?? null,
        transferHistory: selected?.transferHistory ?? null,
        stateTransitionHistory: selected?.stateTransitionHistory ?? null,
        clockOnlyTransferHistory: selected?.clockOnlyTransferHistory ?? null,
        clockOnlyStateTransitionHistory: selected?.clockOnlyStateTransitionHistory ?? null,
        clockWindows: selected?.clockWindows ?? null,
        simulationDurationTicks: selected?.simulationDurationTicks ?? null,
        swingBackoffReport: selected?.swingBackoffReport ?? null,
        transferPlan: selected?.transferPlan ?? null,
        usedLcm: selected?.usedLcm ?? null,
        alternatives,
        selectedAlternativeIndex,
        selectAlternative,
        pendingAlternatives,
        error,
        initialize,
        runSimulation,
        clearLogs,
        getRecipeInfo,
    };
}
