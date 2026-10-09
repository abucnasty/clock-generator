import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AppBar,
    Box,
    Button,
    Chip,
    CircularProgress,
    Container,
    CssBaseline,
    Dialog,
    IconButton,
    ThemeProvider,
    Toolbar,
    Typography,
    createTheme,
    Alert,
    Icon,
    ToggleButton,
    ToggleButtonGroup,
} from '@mui/material';
import { AccountTree, FullscreenExit, List, LocalCafe } from '@mui/icons-material';
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
import { MissingInserterAlert } from './components/MissingInserterAlert';
import { ConfigFlowDiagram } from './components/ConfigFlowDiagram';
import { ChangelogDialog } from './components/ChangelogDialog';
import { ResultsWorkspace } from './components/ResultsWorkspace';
import { ValidationPanel } from './components/ValidationPanel';
import { WorkflowBar, type WorkflowView } from './components/WorkflowBar';

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
    typography: {
        fontFamily: '"Titillium Web", "Helvetica", "Arial", sans-serif',
        fontWeightMedium: 600,
    },
    shape: {
        borderRadius: 0,
    },
    spacing: (factor: number) => factor * 7,
});


function App() {
    const {
        isInitialized,
        isRunning,
        progressStore,
        recipeNames,
        resourceNames,
        itemNames,
        logs,
        blueprintString,
        transferHistory,
        stateTransitionHistory,
        clockOnlyTransferHistory,
        clockOnlyStateTransitionHistory,
        fuelView,
        clockWindows,
        shiftOptions,
        simulationDurationTicks,
        swingBackoffReport,
        alternatives,
        selectedAlternativeIndex,
        selectAlternative,
        pendingAlternatives,
        validation,
        validate,
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
    const [streamLogs, setStreamLogs] = useState(false);

    const [configView, setConfigView] = useState<'list' | 'diagram'>('list');
    const [diagramFullscreen, setDiagramFullscreen] = useState(false);
    const [changelogOpen, setChangelogOpen] = useState(false);
    const [view, setView] = useState<WorkflowView>('configure');

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

    // the Validate step is for the config as it stands; any edit since makes its result out of date
    const configKey = useMemo(() => JSON.stringify(exportConfig()), [exportConfig]);
    const isValidationOutOfDate = validation.status !== 'none' && JSON.stringify(validation.config) !== configKey;
    const validationStatus = validation.status === 'none' || validation.status === 'running' ? validation.status
        : isValidationOutOfDate ? 'out-of-date' : validation.status;

    const validationPanelRef = useRef<HTMLDivElement>(null);
    const handleValidate = useCallback(() => {
        validate(exportConfig());
        setView('configure');
        // the panel sits below the forms; wait for the Configure view to be shown again before scrolling to it
        setTimeout(() => validationPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }, [exportConfig, validate]);

    // excluding an ingredient from the LCM is done inside the validated plan, so it refreshes that plan itself
    const revalidateOnChangeRef = useRef(false);
    useEffect(() => {
        if (revalidateOnChangeRef.current) {
            revalidateOnChangeRef.current = false;
            validate(exportConfig());
        }
    }, [exportConfig, validate]);

    const handleGenerate = useCallback(() => {
        const configToRun = exportConfig();
        runSimulation(configToRun, debugSteps, streamLogs);
        // progress and the potential clocks arrive there
        setView('results');
    }, [exportConfig, runSimulation, debugSteps, streamLogs]);

    const drillConfigs = useMemo(() => config.drills?.configs ?? [], [config.drills]);
    const openDiagramFullscreen = useCallback(() => setDiagramFullscreen(true), []);
    const updateMiningProductivityLevel = useCallback(
        (value: number) => updateDrillsConfig('mining_productivity_level', value),
        [updateDrillsConfig]
    );
    const handleExcludeChange = useCallback((items: string[]) => {
        if (validation.status === 'valid') {
            revalidateOnChangeRef.current = true;
            updateIgnoredIngredients(items, validation.validation.transfer_plan);
        }
    }, [validation, updateIgnoredIngredients]);

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
                        />
                    </Toolbar>
                </AppBar>
                {/* Spacer to account for fixed AppBar */}
                <Toolbar />

                {isInitialized && (
                    <WorkflowBar
                        view={view}
                        onViewChange={setView}
                        isLoading={isRunning}
                        progressStore={progressStore}
                        onGenerate={handleGenerate}
                        generateDisabled={!canGenerate}
                        onValidate={handleValidate}
                        validateDisabled={!canGenerate}
                        validationStatus={validationStatus}
                        blueprintString={blueprintString}
                        selectedLabel={alternatives[selectedAlternativeIndex]?.label ?? null}
                    />
                )}

                <Container maxWidth="xl" sx={{ py: 3, flexGrow: 1 }}>
                    {!isInitialized ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                            <CircularProgress />
                            <Typography sx={{ ml: 2 }}>Loading Factorio data...</Typography>
                        </Box>
                    ) : (
                        <>
                        {/* both views stay mounted so switching keeps what was expanded, filtered or scrolled */}
                        <Box sx={{ display: view === 'configure' ? 'block' : 'none' }}>
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

                            {/* View toggle */}
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                                <ToggleButtonGroup
                                    value={configView}
                                    exclusive
                                    onChange={(_, value) => { if (value) setConfigView(value); }}
                                    size="small"
                                >
                                    <ToggleButton value="list" aria-label="List view">
                                        <List fontSize="small" sx={{ mr: 0.5 }} />
                                        List
                                    </ToggleButton>
                                    <ToggleButton value="diagram" aria-label="Diagram view">
                                        <AccountTree fontSize="small" sx={{ mr: 0.5 }} />
                                        Diagram
                                        <Chip label="beta" size="small" sx={{ ml: 0.75, height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }} />
                                    </ToggleButton>
                                </ToggleButtonGroup>
                            </Box>

                            {configView === 'list' ? (
                                <>
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
                                </>
                            ) : (
                                <Box sx={{ mb: 2 }}>
                                    <ConfigFlowDiagram
                                        machines={config.machines}
                                        inserters={config.inserters}
                                        belts={config.belts}
                                        chests={config.chests}
                                        drills={drillConfigs}
                                        recipeNames={recipeNames}
                                        itemNames={itemNamesComposite}
                                        getRecipeInfo={getRecipeInfo}
                                        onUpdateMachine={updateMachine}
                                        onUpdateInserter={updateInserter}
                                        onUpdateBelt={updateBelt}
                                        onUpdateChest={updateChest}
                                        onSwitchChestType={switchChestType}
                                        onUpdateDrill={updateDrill}
                                        onDeleteMachine={removeMachine}
                                        onDeleteInserter={removeInserter}
                                        onDeleteBelt={removeBelt}
                                        onDeleteChest={removeChest}
                                        onDeleteDrill={removeDrill}
                                        onAddMachine={addMachine}
                                        onAddInserter={addInserter}
                                        onAddBelt={addBelt}
                                        onAddChest={addChest}
                                        onAddDrill={addDrill}
                                        onRequestFullscreen={openDiagramFullscreen}
                                    />
                                    <MissingInserterAlert
                                        issues={coverageIssues}
                                        onApplyFix={applyInserterFix}
                                    />
                                </Box>
                            )}

                            <Box sx={{ mb: 2 }}>
                                <DrillsForm
                                    enabled={!!config.drills}
                                    miningProductivityLevel={config.drills?.mining_productivity_level ?? 0}
                                    drills={drillConfigs}
                                    resourceNames={resourceNames}
                                    machineIds={machineIds}
                                    onEnable={enableDrills}
                                    onDisable={disableDrills}
                                    onUpdateProductivityLevel={updateMiningProductivityLevel}
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
                                    onUpdate={updateOverrides}
                                />
                            </Box>


                            <ValidationPanel
                                ref={validationPanelRef}
                                validation={validation}
                                isOutOfDate={isValidationOutOfDate}
                                onValidate={handleValidate}
                                canValidate={Boolean(canGenerate)}
                                isGenerating={isRunning}
                                excludedIngredients={config.overrides?.ignored_lcm_ingredients ?? []}
                                onExcludeChange={handleExcludeChange}
                            />
                        </Box>

                        <Box sx={{ display: view === 'results' ? 'block' : 'none' }}>
                            <ResultsWorkspace
                                isRunning={isRunning}
                                error={error}
                                alternatives={alternatives}
                                selectedIndex={selectedAlternativeIndex}
                                onSelect={selectAlternative}
                                pending={pendingAlternatives}
                                blueprintString={blueprintString}
                                simulationDurationTicks={simulationDurationTicks}
                                transferHistory={transferHistory}
                                stateTransitionHistory={stateTransitionHistory}
                                clockOnlyTransferHistory={clockOnlyTransferHistory}
                                clockOnlyStateTransitionHistory={clockOnlyStateTransitionHistory}
                                fuelView={fuelView}
                                clockWindows={clockWindows}
                                shiftOptions={shiftOptions}
                                swingBackoffReport={swingBackoffReport}
                                logs={logs}
                                debugSteps={debugSteps}
                                onDebugStepsChange={setDebugSteps}
                                streamLogs={streamLogs}
                                onStreamLogsChange={setStreamLogs}
                                onClearLogs={clearLogs}
                            />
                        </Box>
                        </>
                    )}
                </Container>

                <Box
                    component="footer"
                    sx={{
                        position: 'sticky',
                        bottom: 0,
                        zIndex: (theme) => theme.zIndex.appBar,
                        py: 1,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 1.5,
                        bgcolor: 'background.paper',
                        borderTop: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        Created by abucnasty
                    </Typography>
                    <Chip
                        label={`v${__APP_VERSION__}`}
                        size="small"
                        variant="outlined"
                        clickable
                        onClick={() => setChangelogOpen(true)}
                        title="View changelog"
                    />
                    <Button
                        href="https://ko-fi.com/J6D4284EZ5"
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="contained"
                        size="small"
                        startIcon={<LocalCafe />}
                        title="Support me on ko-fi.com"
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 1 }}
                    >
                        Support me on Ko-fi
                    </Button>
                </Box>
            </Box>

            <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />

            {/* Fullscreen diagram dialog */}
            <Dialog
                fullScreen
                open={diagramFullscreen}
                onClose={() => setDiagramFullscreen(false)}
                PaperProps={{ sx: { bgcolor: 'background.default' } }}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            px: 2,
                            py: 1,
                            flexShrink: 0,
                            bgcolor: 'background.paper',
                            borderBottom: 1,
                            borderColor: 'divider',
                        }}
                    >
                        <Typography variant="h6" sx={{ flex: 1 }}>Flow Diagram</Typography>
                        <IconButton onClick={() => setDiagramFullscreen(false)} size="small" aria-label="Exit fullscreen">
                            <FullscreenExit />
                        </IconButton>
                    </Box>
                    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <ConfigFlowDiagram
                            machines={config.machines}
                            inserters={config.inserters}
                            belts={config.belts}
                            chests={config.chests}
                            drills={drillConfigs}
                            recipeNames={recipeNames}
                            itemNames={itemNamesComposite}
                            getRecipeInfo={getRecipeInfo}
                            onUpdateMachine={updateMachine}
                            onUpdateInserter={updateInserter}
                            onUpdateBelt={updateBelt}
                            onUpdateChest={updateChest}
                            onSwitchChestType={switchChestType}
                            onUpdateDrill={updateDrill}
                            onDeleteMachine={removeMachine}
                            onDeleteInserter={removeInserter}
                            onDeleteBelt={removeBelt}
                            onDeleteChest={removeChest}
                            onDeleteDrill={removeDrill}
                            onAddMachine={addMachine}
                            onAddInserter={addInserter}
                            onAddBelt={addBelt}
                            onAddChest={addChest}
                            onAddDrill={addDrill}
                            height="100%"
                        />
                    </Box>
                    {coverageIssues.length > 0 && (
                        <Box sx={{ flexShrink: 0, px: 2, pb: 1 }}>
                            <MissingInserterAlert issues={coverageIssues} onApplyFix={applyInserterFix} />
                        </Box>
                    )}
                </Box>
            </Dialog>
        </ThemeProvider>
    );
}

export default App;
