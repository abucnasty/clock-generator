import { useCallback, useState } from 'react';
import type { Config, DebugSteps, LogMessage, FactorioData, SerializableTransferHistory, SerializableStateTransitionHistory, SwingBackoffReport, SerializableTransferPlan } from 'clock-generator/browser';
import { initializeMachineFacts } from './useMachineFacts';

export interface RecipeInfo {
    ingredients: string[];
    results: string[];
}

export interface UseSimulationWorkerResult {
    isInitialized: boolean;
    isRunning: boolean;
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
    error: string | null;
    initialize: () => void;
    runSimulation: (config: Config, debugSteps: DebugSteps) => void;
    clearLogs: () => void;
    getRecipeInfo: (recipeName: string) => RecipeInfo | null;
}

// Dynamic imports for the clock-generator library
let FactorioDataService: typeof import('clock-generator/browser').FactorioDataService | null = null;
let generateClockWithSwingBackoff: typeof import('clock-generator/browser').generateClockWithSwingBackoff | null = null;
let encodeBlueprintFileBrowser: typeof import('clock-generator/browser').encodeBlueprintFileBrowser | null = null;
let DebugSettingsProvider: typeof import('clock-generator/browser').DebugSettingsProvider | null = null;
let StreamingLogger: typeof import('clock-generator/browser').StreamingLogger | null = null;

export function useSimulationWorker(): UseSimulationWorkerResult {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [recipeNames, setRecipeNames] = useState<string[]>([]);
    const [itemNames, setItemNames] = useState<string[]>([]);
    const [resourceNames, setResourceNames] = useState<string[]>([]);
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [blueprintString, setBlueprintString] = useState<string | null>(null);
    const [transferHistory, setTransferHistory] = useState<SerializableTransferHistory | null>(null);
    const [stateTransitionHistory, setStateTransitionHistory] = useState<SerializableStateTransitionHistory | null>(null);
    const [simulationDurationTicks, setSimulationDurationTicks] = useState<number | null>(null);
    const [swingBackoffReport, setSwingBackoffReport] = useState<SwingBackoffReport | null>(null);
    const [transferPlan, setTransferPlan] = useState<SerializableTransferPlan | null>(null);
    const [usedLcm, setUsedLcm] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const initialize = useCallback(async () => {
        try {
            // Dynamically import the clock-generator browser module
            const clockGenerator = await import('clock-generator/browser');
            
            FactorioDataService = clockGenerator.FactorioDataService;
            generateClockWithSwingBackoff = clockGenerator.generateClockWithSwingBackoff;
            encodeBlueprintFileBrowser = clockGenerator.encodeBlueprintFileBrowser;
            DebugSettingsProvider = clockGenerator.DebugSettingsProvider;
            StreamingLogger = clockGenerator.StreamingLogger;

            // Fetch and initialize Factorio data
            const response = await fetch('/data-filtered.json');
            const data: FactorioData = await response.json();
            FactorioDataService.initialize(data);

            setRecipeNames(FactorioDataService.getAllRecipeNames());
            setItemNames(FactorioDataService.getAllItemNames());
            setResourceNames(FactorioDataService.getAllResourceNames());
            
            // Initialize machine facts module
            await initializeMachineFacts();
            
            setIsInitialized(true);
        } catch (err) {
            console.error('Failed to initialize:', err);
            setError(err instanceof Error ? err.message : 'Failed to initialize');
        }
    }, []);

    const runSimulation = useCallback(async (config: Config, debugSteps: DebugSteps) => {
        if (!generateClockWithSwingBackoff || !encodeBlueprintFileBrowser || !DebugSettingsProvider || !StreamingLogger) {
            setError('Not initialized');
            return;
        }

        setIsRunning(true);
        setBlueprintString(null);
        setTransferHistory(null);
        setStateTransitionHistory(null);
        setSimulationDurationTicks(null);
        setSwingBackoffReport(null);
        setTransferPlan(null);
        setUsedLcm(null);
        setError(null);
        setLogs([]);

        // Use setTimeout to allow UI to update before running simulation
        setTimeout(() => {
            try {
                // Create a streaming logger to capture logs
                const capturedLogs: LogMessage[] = [];
                const logger = new StreamingLogger!((message) => {
                    capturedLogs.push(message);
                    // Update logs in batches to avoid too many re-renders
                    setLogs([...capturedLogs]);
                });

                // Create mutable debug settings
                const debug = DebugSettingsProvider!.mutable();

                // Run the simulation
                const result = generateClockWithSwingBackoff!(config, {
                    debug,
                    debug_steps: debugSteps,
                    logger,
                });

                // Encode the blueprint
                const blueprint = encodeBlueprintFileBrowser!({
                    blueprint: result.blueprint,
                });

                setBlueprintString(blueprint);
                setTransferHistory(result.serializable_transfer_history);
                setStateTransitionHistory(result.serializable_state_transition_history);
                setSimulationDurationTicks(result.simulation_duration.ticks);
                setSwingBackoffReport(result.swing_backoff_report ?? null);
                setTransferPlan(result.serializable_transfer_plan);
                setUsedLcm(result.used_lcm);
                setIsRunning(false);
            } catch (err) {
                console.error('Simulation error:', err);
                setError(err instanceof Error ? err.message : 'Simulation failed');
                setIsRunning(false);
            }
        }, 100);
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

    return {
        isInitialized,
        isRunning,
        recipeNames,
        resourceNames,
        itemNames,
        logs,
        blueprintString,
        transferHistory,
        stateTransitionHistory,
        simulationDurationTicks,
        swingBackoffReport,
        transferPlan,
        usedLcm,
        error,
        initialize,
        runSimulation,
        clearLogs,
        getRecipeInfo,
    };
}
