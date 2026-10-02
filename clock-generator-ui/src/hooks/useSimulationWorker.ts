import { useCallback, useState } from 'react';
import type { Config, DebugSteps, LogMessage, FactorioData, SerializableTransferHistory, SerializableStateTransitionHistory, SwingBackoffReport, SerializableTransferPlan, AsBuiltStabilityCheck } from 'clock-generator/browser';
import { initializeMachineFacts } from './useMachineFacts';

export interface RecipeInfo {
    ingredients: string[];
    results: string[];
}

export interface ClockAlternativeView {
    id: string;
    label: string;
    description: string;
    inserterWindowCount: number;
    isStable: boolean;
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
let generateClockAlternatives: typeof import('clock-generator/browser').generateClockAlternatives | null = null;
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
    const [alternatives, setAlternatives] = useState<ClockAlternativeView[]>([]);
    const [selectedAlternativeIndex, setSelectedAlternativeIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const initialize = useCallback(async () => {
        try {
            // Dynamically import the clock-generator browser module
            const clockGenerator = await import('clock-generator/browser');
            
            FactorioDataService = clockGenerator.FactorioDataService;
            generateClockAlternatives = clockGenerator.generateClockAlternatives;
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
        if (!generateClockAlternatives || !encodeBlueprintFileBrowser || !DebugSettingsProvider || !StreamingLogger) {
            setError('Not initialized');
            return;
        }

        setIsRunning(true);
        setAlternatives([]);
        setSelectedAlternativeIndex(0);
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
                const generated = generateClockAlternatives!(config, {
                    debug,
                    debug_steps: debugSteps,
                    logger,
                });

                setAlternatives(generated.alternatives.map(({ result, ...alternative }) => ({
                    id: alternative.id,
                    label: alternative.label,
                    description: alternative.description,
                    inserterWindowCount: alternative.inserter_window_count,
                    isStable: alternative.is_stable,
                    asBuilt: result.stability_check.as_built ?? null,
                    expectedOutputItems: result.stability_check.expected_output_items,
                    terminalSwingCount: result.used_terminal_swing_count,
                    blueprintString: encodeBlueprintFileBrowser!({ blueprint: result.blueprint }),
                    transferHistory: result.serializable_transfer_history,
                    stateTransitionHistory: result.serializable_state_transition_history,
                    simulationDurationTicks: result.simulation_duration.ticks,
                    swingBackoffReport: result.swing_backoff_report ?? null,
                    transferPlan: result.serializable_transfer_plan,
                    usedLcm: result.used_lcm,
                })));
                setSelectedAlternativeIndex(generated.selected_index);
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

    const selected: ClockAlternativeView | undefined = alternatives[selectedAlternativeIndex];

    return {
        isInitialized,
        isRunning,
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
