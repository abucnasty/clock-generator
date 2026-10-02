import { useCallback, useEffect, useRef, useState } from 'react';
import type { Config, DebugSteps, LogMessage, FactorioData, SerializableTransferHistory, SerializableStateTransitionHistory, SwingBackoffReport, SerializableTransferPlan, GenerationProgress } from 'clock-generator/browser';
import { initializeMachineFacts } from './useMachineFacts';
import type { ClockAlternativeView, WorkerRequest, WorkerResponse } from '../worker/types';

export type { ClockAlternativeView } from '../worker/types';

export interface RecipeInfo {
    ingredients: string[];
    results: string[];
}

export interface UseSimulationWorkerResult {
    isInitialized: boolean;
    isRunning: boolean;
    progress: GenerationProgress | null;
    recipeNames: string[];
    itemNames: string[];
    resourceNames: string[];
    logs: LogMessage[];
    blueprintString: string | null;
    transferHistory: SerializableTransferHistory | null;
    stateTransitionHistory: SerializableStateTransitionHistory | null;
    simulationDurationTicks: number | null;
    swingBackoffReport: SwingBackoffReport | null;
    transferPlan: SerializableTransferPlan | null;
    usedLcm: number | null;
    alternatives: ClockAlternativeView[];
    selectedAlternativeIndex: number;
    selectAlternative: (index: number) => void;
    error: string | null;
    initialize: () => void;
    runSimulation: (config: Config, debugSteps: DebugSteps) => void;
    clearLogs: () => void;
    getRecipeInfo: (recipeName: string) => RecipeInfo | null;
}

// Dynamic imports for the clock-generator library
let FactorioDataService: typeof import('clock-generator/browser').FactorioDataService | null = null;

const FACTORIO_DATA_URL = '/data-filtered.json';

export function useSimulationWorker(): UseSimulationWorkerResult {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<GenerationProgress | null>(null);
    const [recipeNames, setRecipeNames] = useState<string[]>([]);
    const [itemNames, setItemNames] = useState<string[]>([]);
    const [resourceNames, setResourceNames] = useState<string[]>([]);
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [alternatives, setAlternatives] = useState<ClockAlternativeView[]>([]);
    const [selectedAlternativeIndex, setSelectedAlternativeIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => () => workerRef.current?.terminate(), []);

    const initialize = useCallback(async () => {
        try {
            // Generation runs in the worker; the main thread only needs the data for forms and machine facts
            const workerReady = new Promise<void>((resolve, reject) => {
                const worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), { type: 'module' });
                workerRef.current = worker;
                worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    const response = event.data;
                    switch (response.type) {
                        case 'initialized':
                            resolve();
                            break;
                        case 'log':
                            setLogs(previous => [...previous, ...response.messages]);
                            break;
                        case 'progress':
                            setProgress(response.progress);
                            break;
                        case 'completed':
                            setAlternatives(response.alternatives);
                            setSelectedAlternativeIndex(response.selectedIndex);
                            setProgress(null);
                            setIsRunning(false);
                            break;
                        case 'error':
                            console.error('Simulation error:', response.message, response.stack);
                            setError(response.message);
                            setProgress(null);
                            setIsRunning(false);
                            reject(new Error(response.message));
                            break;
                    }
                };
                worker.onerror = (event) => {
                    setError(event.message || 'Simulation worker failed');
                    setProgress(null);
                    setIsRunning(false);
                    reject(new Error(event.message));
                };
                worker.postMessage({ type: 'initialize', factorioDataUrl: FACTORIO_DATA_URL } satisfies WorkerRequest);
            });

            // Dynamically import the clock-generator browser module
            const clockGenerator = await import('clock-generator/browser');
            
            FactorioDataService = clockGenerator.FactorioDataService;

            // Fetch and initialize Factorio data
            const response = await fetch(FACTORIO_DATA_URL);
            const data: FactorioData = await response.json();
            FactorioDataService.initialize(data);

            setRecipeNames(FactorioDataService.getAllRecipeNames());
            setItemNames(FactorioDataService.getAllItemNames());
            setResourceNames(FactorioDataService.getAllResourceNames());
            
            // Initialize machine facts module
            await initializeMachineFacts();
            await workerReady;
            
            setIsInitialized(true);
        } catch (err) {
            console.error('Failed to initialize:', err);
            setError(err instanceof Error ? err.message : 'Failed to initialize');
        }
    }, []);

    const runSimulation = useCallback((config: Config, debugSteps: DebugSteps) => {
        const worker = workerRef.current;
        if (!worker) {
            setError('Not initialized');
            return;
        }

        setIsRunning(true);
        setProgress(null);
        setAlternatives([]);
        setSelectedAlternativeIndex(0);
        setError(null);
        setLogs([]);
        worker.postMessage({ type: 'generate', config, debugSteps } satisfies WorkerRequest);
    }, []);

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
        progress,
        recipeNames,
        resourceNames,
        itemNames,
        logs,
        blueprintString: selected?.blueprintString ?? null,
        transferHistory: selected?.transferHistory ?? null,
        stateTransitionHistory: selected?.stateTransitionHistory ?? null,
        simulationDurationTicks: selected?.simulationDurationTicks ?? null,
        swingBackoffReport: selected?.swingBackoffReport ?? null,
        transferPlan: selected?.transferPlan ?? null,
        usedLcm: selected?.usedLcm ?? null,
        alternatives,
        selectedAlternativeIndex,
        selectAlternative: setSelectedAlternativeIndex,
        error,
        initialize,
        runSimulation,
        clearLogs,
        getRecipeInfo,
    };
}
