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
import type { ChestType, Config, DebugSteps } from 'clock-generator/browser';
import { useSimulationWorker } from './hooks/useSimulationWorker';
import { useConfigForm } from './hooks/useConfigForm';
import type { ChestFormData } from './hooks/useConfigForm';
import { useInserterValidation } from './hooks/useInserterValidation';
import { useStickyHeaderHeight } from './hooks/useStickyHeaderHeight';
import { useUndo } from './hooks/useUndo';
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
import { MessageHost } from './components/Messages';
import { ResultsWorkspace } from './components/ResultsWorkspace';
import { ValidationPanel } from './components/ValidationPanel';
import { WorkflowBar, type WorkflowView } from './components/WorkflowBar';
import { rateWarningOf } from './utils/rateWarning';
import { configKeyOf, isStale } from './utils/resultsStaleness';
import { withDeeperSearch } from './utils/deeperSearch';
import { describeChestSwitch, describeDrillsOff, removalMessage } from './utils/undoSnapshot';

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
        isInitialized: workersReady,
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
    } = useSimulationWorker();

    const {
        config,
        isLoaded: isConfigLoaded,
        loadError: configLoadError,
        loadNotice,
        dismissLoadNotice,
        setConfig,
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
        exportableConfig,
        resetConfig,
        applyInserterFix,
        reorderMachines,
        reorderInserters,
        reorderBelts,
        reorderChests,
        reorderDrills,
    } = useConfigForm();

    const { offerUndo } = useUndo(config, setConfig, isConfigLoaded);

    // the page waits for the workers and for the saved config, which the engine's worker checks
    const isInitialized = workersReady && isConfigLoaded;
    // until the workers are ready, an error is one that stopped them starting
    const startupError = (!workersReady && error) || configLoadError;

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

    // null until the config is checked; Generate waits for that
    const checkedCoverageIssues = useInserterValidation(exportConfig, isInitialized);
    // the header's height, for scrolling to a panel so that it is not left under the header
    const headerRef = useRef<HTMLElement>(null);
    useStickyHeaderHeight(headerRef);
    const coverageIssues = checkedCoverageIssues ?? [];

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
    const configKey = useMemo(() => configKeyOf(exportConfig()), [exportConfig]);
    const isValidationOutOfDate = validation.status !== 'none' && configKeyOf(validation.config) !== configKey;
    const validationStatus = validation.status === 'none' || validation.status === 'running' ? validation.status
        : isValidationOutOfDate ? 'out-of-date' : validation.status;
    // likewise the clocks on screen are for the build as it was when Generate was pressed
    const resultsAreStale = isStale(generatedFor, configKey);
    const staleFor = resultsAreStale ? generatedFor : null;

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

    // the actions that throw part of the build away offer Undo, just before they are applied
    const undoable = useMemo(() => ({
        removeMachine: (index: number) => { offerUndo((form) => removalMessage(form, 'machines', index)); removeMachine(index); },
        removeInserter: (index: number) => { offerUndo((form) => removalMessage(form, 'inserters', index)); removeInserter(index); },
        removeBelt: (index: number) => { offerUndo((form) => removalMessage(form, 'belts', index)); removeBelt(index); },
        removeChest: (index: number) => { offerUndo((form) => removalMessage(form, 'chests', index)); removeChest(index); },
        removeDrill: (index: number) => { offerUndo((form) => removalMessage(form, 'drills', index)); removeDrill(index); },
        switchChestType: (index: number, type: ChestType) => { offerUndo((form) => describeChestSwitch(form, index, type)); switchChestType(index, type); },
        disableDrills: () => { offerUndo(describeDrillsOff); disableDrills(); },
    }), [offerUndo, removeMachine, removeInserter, removeBelt, removeChest, removeDrill, switchChestType, disableDrills]);
    // Import, Paste and Reset clear the generated clocks, which their Undo does not bring back
    const hasResults = alternatives.length > 0 || isRunning;
    const offerUndoOfReplace = useCallback(
        (message: string) => offerUndo(message, { resultsCleared: hasResults }),
        [offerUndo, hasResults]
    );

    const drillConfigs = useMemo(() => config.drills?.configs ?? [], [config.drills]);
    const openDiagramFullscreen = useCallback(() => setDiagramFullscreen(true), []);

    // Shared by the inline and fullscreen diagrams
    const flowDiagramProps = {
        machines: config.machines,
        inserters: config.inserters,
        belts: config.belts,
        chests: config.chests,
        drills: drillConfigs,
        recipeNames,
        itemNames: itemNamesComposite,
        getRecipeInfo,
        onUpdateMachine: updateMachine,
        onUpdateInserter: updateInserter,
        onUpdateBelt: updateBelt,
        onUpdateChest: updateChest,
        onSwitchChestType: undoable.switchChestType,
        onUpdateDrill: updateDrill,
        onDeleteMachine: undoable.removeMachine,
        onDeleteInserter: undoable.removeInserter,
        onDeleteBelt: undoable.removeBelt,
        onDeleteChest: undoable.removeChest,
        onDeleteDrill: undoable.removeDrill,
        onAddMachine: addMachine,
        onAddInserter: addInserter,
        onAddBelt: addBelt,
        onAddChest: addChest,
        onAddDrill: addDrill,
    };
    const updateMiningProductivityLevel = useCallback(
        (value: number) => updateDrillsConfig('mining_productivity_level', value),
        [updateDrillsConfig]
    );
    const handleExcludeChange = useCallback((items: string[]) => {
        // an out-of-date plan numbers the inserters as they were, which a delete or reorder has since moved
        if (validation.status === 'valid' && !isValidationOutOfDate) {
            revalidateOnChangeRef.current = true;
            updateIgnoredIngredients(items, validation.validation.transfer_plan);
        }
    }, [validation, isValidationOutOfDate, updateIgnoredIngredients]);

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
            checkedCoverageIssues?.length === 0
        );
    }, [isInitialized, isRunning, config, checkedCoverageIssues]);

    // Search deeper is a Generate, so it is disabled whenever the Generate button is
    const canSearchDeeper = Boolean(canGenerate) && validationStatus === 'valid';
    // Generate with the slower searches: for this run only, or, kept on, by turning the switch on in the form
    const handleSearchDeeper = useCallback((keepOn: boolean) => {
        if (!canSearchDeeper) {
            return;
        }
        if (keepOn) {
            // the form's key once the switch is on, so the results are not taken for out of date
            const kept = withDeeperSearch(exportConfig());
            updateOverrides('search_for_fewer_wake_ups', true);
            runSimulation(kept, debugSteps, streamLogs);
        } else {
            runSimulation(exportConfig(), debugSteps, streamLogs, true);
        }
        setView('results');
    }, [canSearchDeeper, exportConfig, updateOverrides, runSimulation, debugSteps, streamLogs]);

    return (
        <ThemeProvider theme={darkTheme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                <AppBar position="sticky" ref={headerRef}>
                    <Toolbar>
                        <Icon sx={{ mr: 3 }}>
                            <img src="/big_biter_q5_right.png" alt="Logo" style={{ width: 26, height: 26 }} />
                        </Icon>
                        <Typography variant="h6" component="div" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Factorio </Box>Clock Generator
                        </Typography>
                        <ConfigImportExport
                            config={exportableConfig}
                            onImport={handleImportConfig}
                            onReplaceMachines={(machines) => replaceMachines(machines.map((m) => ({ ...m, _uuid: crypto.randomUUID() })))}
                            onReplaceDrills={(drills) => replaceDrills(drills.map((d) => ({ ...d, _uuid: crypto.randomUUID() })))}
                            onReplaceInserters={(inserters) => replaceInserters(inserters.map((ins, i) => ({ ...ins, id: ins.id ?? (i + 1), _uuid: crypto.randomUUID() })))}
                            onReplaceBelts={(belts) => replaceBelts(belts.map((b) => ({ ...b, _uuid: crypto.randomUUID() })))}
                            onReplaceChests={(chests) => replaceChests(chests.map((c) => ({ ...c, _uuid: crypto.randomUUID() } as ChestFormData)))}
                            onUpdateMiningProductivityLevel={(level) => updateDrillsConfig('mining_productivity_level', level)}
                            onReset={resetConfig}
                            onBuildReplaced={clearResults}
                            onUndoable={offerUndoOfReplace}
                        />
                    </Toolbar>
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
                            rateWarning={rateWarningOf(alternatives[selectedAlternativeIndex])}
                            staleFor={staleFor}
                        />
                    )}
                </AppBar>

                <Container maxWidth="xl" sx={{ py: 3, flexGrow: 1 }}>
                    {startupError ? (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            The page could not start: {startupError}. Reload the page to try again.
                        </Alert>
                    ) : !isInitialized ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                            <CircularProgress />
                            <Typography sx={{ ml: 2 }}>Loading Factorio data...</Typography>
                        </Box>
                    ) : (
                        <>
                        {/* both views stay mounted so switching keeps what was expanded, filtered or scrolled */}
                        <Box sx={{ display: view === 'configure' ? 'block' : 'none' }}>
                            {loadNotice && (
                                <Alert severity="warning" sx={{ mb: 2 }} onClose={dismissLoadNotice}>
                                    {loadNotice}
                                </Alert>
                            )}
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
                                        onRemove={undoable.removeMachine}
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
                                        onRemove={undoable.removeInserter}
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
                                        onRemove={undoable.removeBelt}
                                        onReorder={reorderBelts}
                                    />

                                    <ChestsForm
                                        chests={config.chests}
                                        itemNames={itemNamesComposite}
                                        onAdd={addChest}
                                        onUpdate={updateChest}
                                        onSwitchType={undoable.switchChestType}
                                        onRemove={undoable.removeChest}
                                        onReorder={reorderChests}
                                    />
                                </>
                            ) : (
                                <Box sx={{ mb: 2 }}>
                                    <ConfigFlowDiagram
                                        {...flowDiagramProps}
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
                                    onDisable={undoable.disableDrills}
                                    onUpdateProductivityLevel={updateMiningProductivityLevel}
                                    onAdd={addDrill}
                                    onUpdate={updateDrill}
                                    onRemove={undoable.removeDrill}
                                    onReorder={reorderDrills}
                                />
                            </Box>

                            <Box sx={{ mb: 2 }}>
                                <OverridesForm
                                    lcm={config.overrides?.lcm}
                                    terminalSwingCount={config.overrides?.terminal_swing_count}
                                    useFractionalSwings={config.overrides?.use_fractional_swings}
                                    nonMovingBelts={config.overrides?.non_moving_belts}
                                    searchForFewerWakeUps={config.overrides?.search_for_fewer_wake_ups}
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
                                recommendedIndex={recommendedIndex}
                                onSelectRecommended={selectRecommended}
                                pickRule={pickRule}
                                pending={pendingAlternatives}
                                skippedSearches={skippedSearches}
                                searchedDeeper={searchedDeeper}
                                keptOn={config.overrides?.search_for_fewer_wake_ups === true}
                                canSearchDeeper={canSearchDeeper}
                                onSearchDeeper={handleSearchDeeper}
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
                                staleFor={staleFor}
                            />
                        </Box>
                        </>
                    )}
                </Container>

                <Box
                    component="footer"
                    sx={{
                        py: 1,
                        px: 2,
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 1.5,
                        rowGap: 0.5,
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
                        variant="outlined"
                        color="inherit"
                        size="small"
                        startIcon={<LocalCafe />}
                        title="Support me on ko-fi.com"
                        sx={{ textTransform: 'none', borderRadius: 1 }}
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
                            {...flowDiagramProps}
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

            <MessageHost />
        </ThemeProvider>
    );
}

export default App;
