import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AppBar,
    Box,
    CircularProgress,
    Container,
    CssBaseline,
    ThemeProvider,
    Toolbar,
    Typography,
    createTheme,
    Alert,
    Divider,
    Icon,
} from '@mui/material';
import type { Config, DebugSteps } from 'clock-generator/browser';
import { useSimulationWorker } from './hooks/useSimulationWorker';
import { useConfigForm } from './hooks/useConfigForm';
import type { ChestFormData } from './hooks/useConfigForm';
import { useInserterValidation } from './hooks/useInserterValidation';
import { TargetOutputForm } from './components/TargetOutputForm';
import { MachinesForm } from './components/MachinesForm';
import { InsertersForm } from './components/InsertersForm';
import { BeltsForm } from './components/BeltsForm';
import { ChestsForm } from './components/ChestsForm';
import { DrillsForm } from './components/DrillsForm';
import { OverridesForm } from './components/OverridesForm';
import { ConfigImportExport } from './components/ConfigImportExport';
import { BlueprintOutput } from './components/BlueprintOutput';
import { DebugPanel } from './components/DebugPanel';
import { TransferHistoryVisualization } from './components/TransferHistoryVisualization';
import { StateTransitionTimeline } from './components/StateTransitionTimeline';
import { MissingInserterAlert } from './components/MissingInserterAlert';
import { SwingBackoffReportDisplay } from './components/SwingBackoffReportDisplay';
import { TransferPlanPanel } from './components/TransferPlanPanel';

const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#fca300',
            light: '#ffba37',
        },
        secondary: {
            main: '#5eb664',
            light: '#81d99a',
        },
        background: {
            default: '#404040',
            paper: '#232323',
        },
        common: {
            black: '#121212',
        },
        error: {
            main: '#ff5958'
        }
    },
    shape: {
        borderRadius: 0,
    },
    spacing: (factor: number) => factor * 7,
});


// Simple HOCON parsing fallback - in real scenario use the browser config loader
async function parseConfig(content: string): Promise<Config> {
    // Try JSON first
    try {
        return JSON.parse(content);
    } catch {
        // For HOCON, we'd need to use the createBrowserConfigLoader
        // For now, just throw an error suggesting JSON
        throw new Error('HOCON parsing not yet implemented in browser. Please use JSON format.');
    }
}

function App() {
    const {
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
    } = useSimulationWorker();

    const {
        config,
        updateTargetOutput,
        addMachine,
        updateMachine,
        removeMachine,
        replaceMachines,
        addInserter,
        updateInserter,
        removeInserter,
        addBelt,
        updateBelt,
        removeBelt,
        replaceBelts,
        addChest,
        updateChest,
        switchChestType,
        removeChest,
        replaceChests,
        enableDrills,
        disableDrills,
        updateDrillsConfig,
        addDrill,
        updateDrill,
        removeDrill,
        replaceDrills,
        replaceInserters,
        updateOverrides,
        updateIgnoredIngredients,
        importConfig,
        exportConfig,
        resetConfig,
        applyInserterFix,
        reorderMachines,
        reorderInserters,
        reorderBelts,
        reorderChests,
        reorderDrills,
    } = useConfigForm();

    const [debugSteps, setDebugSteps] = useState<DebugSteps>({
        prepare: false,
        warm_up: false,
        simulate: false,
    });

    const coverageIssues = useInserterValidation(exportConfig, isInitialized);

    // Initialize worker on mount
    useEffect(() => {
        initialize();
    }, [initialize]);

    // Extract IDs for dropdown population
    const machineIds = useMemo(() => config.machines.map((m) => m.id), [config.machines]);

    // All item names (from recipes and resources)
    const itemNamesComposite = useMemo(() => {
        const names = new Set<string>();
        itemNames.forEach((name) => names.add(name));
        resourceNames.forEach((name) => names.add(name));
        return Array.from(names).sort();
    }, [itemNames, resourceNames]);

    const handleGenerate = useCallback(() => {
        const configToRun = exportConfig();
        runSimulation(configToRun, debugSteps);
    }, [exportConfig, runSimulation, debugSteps]);

    const handleImportConfig = useCallback((imported: Config) => {
        importConfig(imported);
    }, [importConfig]);

    // Check if config is valid enough to generate
    const canGenerate = useMemo(() => {
        return (
            isInitialized &&
            !isRunning &&
            config.target_output.recipe &&
            config.target_output.items_per_second > 0 &&
            config.target_output.copies > 0 &&
            config.machines.length > 0 &&
            config.machines.every((m) => m.recipe) &&
            coverageIssues.length === 0
        );
    }, [isInitialized, isRunning, config, coverageIssues]);

    return (
        <ThemeProvider theme={darkTheme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                <AppBar position="fixed">
                    <Toolbar>
                        <Icon sx={{ mr: 3 }}>
                            <img src="/big_biter_q5_right.png" alt="Logo" style={{ width: 26, height: 26 }} />
                        </Icon>
                        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                            Factorio Clock Generator
                        </Typography>
                        <ConfigImportExport
                            config={exportConfig()}
                            onImport={handleImportConfig}
                            onReplaceMachines={(machines) => replaceMachines(machines.map((m) => ({ ...m, _uuid: crypto.randomUUID() })))}
                            onReplaceDrills={(drills) => replaceDrills(drills.map((d) => ({ ...d, _uuid: crypto.randomUUID() })))}
                            onReplaceInserters={(inserters) => replaceInserters(inserters.map((ins, i) => ({ ...ins, id: ins.id ?? (i + 1), _uuid: crypto.randomUUID() })))}
                            onReplaceBelts={(belts) => replaceBelts(belts.map((b) => ({ ...b, _uuid: crypto.randomUUID() })))}
                            onReplaceChests={(chests) => replaceChests(chests.map((c) => ({ ...c, _uuid: crypto.randomUUID() } as ChestFormData)))}
                            onUpdateMiningProductivityLevel={(level) => updateDrillsConfig('mining_productivity_level', level)}
                            onReset={resetConfig}
                            parseConfig={parseConfig}
                        />
                    </Toolbar>
                </AppBar>
                {/* Spacer to account for fixed AppBar */}
                <Toolbar />

                <Container maxWidth="lg" sx={{ py: 3, flexGrow: 1 }}>
                    {!isInitialized ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                            <CircularProgress />
                            <Typography sx={{ ml: 2 }}>Loading Factorio data...</Typography>
                        </Box>
                    ) : (
                        <>
                            {error && (
                                <Alert severity="error" sx={{ mb: 2 }}>
                                    {error}
                                </Alert>
                            )}

                            <TargetOutputForm
                                recipe={config.target_output.recipe}
                                itemsPerSecond={config.target_output.items_per_second}
                                copies={config.target_output.copies}
                                recipeNames={recipeNames}
                                onRecipeChange={(recipe) => updateTargetOutput('recipe', recipe)}
                                onItemsPerSecondChange={(value) => updateTargetOutput('items_per_second', value)}
                                onCopiesChange={(value) => updateTargetOutput('copies', value)}
                            />

                            <MachinesForm
                                machines={config.machines}
                                recipeNames={recipeNames}
                                onAdd={addMachine}
                                onUpdate={updateMachine}
                                onRemove={removeMachine}
                                onReorder={reorderMachines}
                            />

                            <InsertersForm
                                inserters={config.inserters}
                                machines={config.machines}
                                belts={config.belts}
                                chests={config.chests}
                                itemNames={itemNamesComposite}
                                getRecipeInfo={getRecipeInfo}
                                onAdd={addInserter}
                                onUpdate={updateInserter}
                                onRemove={removeInserter}
                                onReorder={reorderInserters}
                            />

                            <MissingInserterAlert
                                issues={coverageIssues}
                                onApplyFix={applyInserterFix}
                            />

                            <BeltsForm
                                belts={config.belts}
                                itemNames={itemNamesComposite}
                                onAdd={addBelt}
                                onUpdate={updateBelt}
                                onRemove={removeBelt}
                                onReorder={reorderBelts}
                            />

                            <ChestsForm
                                chests={config.chests}
                                itemNames={itemNamesComposite}
                                onAdd={addChest}
                                onUpdate={updateChest}
                                onSwitchType={switchChestType}
                                onRemove={removeChest}
                                onReorder={reorderChests}
                            />

                            <Box sx={{ mb: 2 }}>
                                <DrillsForm
                                    enabled={!!config.drills}
                                    miningProductivityLevel={config.drills?.mining_productivity_level ?? 0}
                                    drills={config.drills?.configs ?? []}
                                    resourceNames={resourceNames}
                                    machineIds={machineIds}
                                    onEnable={enableDrills}
                                    onDisable={disableDrills}
                                    onUpdateProductivityLevel={(value) => updateDrillsConfig('mining_productivity_level', value)}
                                    onAdd={addDrill}
                                    onUpdate={updateDrill}
                                    onRemove={removeDrill}
                                    onReorder={reorderDrills}
                                />
                            </Box>

                            <Box sx={{ mb: 2 }}>
                                <OverridesForm
                                    lcm={config.overrides?.lcm}
                                    terminalSwingCount={config.overrides?.terminal_swing_count}
                                    useFractionalSwings={config.overrides?.use_fractional_swings}
                                    disableSwingBackoff={config.overrides?.disable_swing_backoff}
                                    onUpdate={updateOverrides}
                                />
                            </Box>

                            <Divider sx={{ my: 3 }} />

                            <BlueprintOutput
                                blueprintString={blueprintString}
                                isLoading={isRunning}
                                error={error}
                                simulationDurationTicks={simulationDurationTicks ?? undefined}
                                onGenerate={handleGenerate}
                                disabled={!canGenerate}
                            />

                            <SwingBackoffReportDisplay report={swingBackoffReport} />

                            {transferPlan && (
                                <Box sx={{ mt: 2 }}>
                                    <TransferPlanPanel
                                        transferPlan={transferPlan}
                                        usedLcm={usedLcm!}
                                        ignoredIngredients={config.overrides?.ignored_lcm_ingredients ?? []}
                                        onIgnoreChange={(items) => updateIgnoredIngredients(items, transferPlan)}
                                    />
                                </Box>
                            )}

                            {transferHistory && (
                                <Box sx={{ mt: 2 }}>
                                    <TransferHistoryVisualization transferHistory={transferHistory} />
                                </Box>
                            )}

                            {stateTransitionHistory && (
                                <Box sx={{ mt: 2 }}>
                                    <StateTransitionTimeline stateTransitionHistory={stateTransitionHistory} />
                                </Box>
                            )}

                            <Box sx={{ mt: 2 }}>
                                <DebugPanel
                                    logs={logs}
                                    debugSteps={debugSteps}
                                    onDebugStepsChange={setDebugSteps}
                                    onClearLogs={clearLogs}
                                />
                            </Box>
                        </>
                    )}
                </Container>

                <Box
                    component="footer"
                    sx={{
                        py: 2,
                        textAlign: 'center',
                        bgcolor: 'background.paper',
                        borderTop: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        Factorio Clock Generator UI - Generate clock circuits for your factory setups
                    </Typography>
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
