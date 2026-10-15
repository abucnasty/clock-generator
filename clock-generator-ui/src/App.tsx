import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
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
    Alert,
    Icon,
    Paper,
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
import { useCopyBlueprint } from './hooks/useCopyBlueprint';
import { useAnnounce, useNotify } from './hooks/useMessages';
import { useIntroCard } from './hooks/useIntroCard';
import { useMachinesMax } from './hooks/useMachineFacts';
import { TargetOutputForm } from './components/TargetOutputForm';
import { MachinesForm } from './components/MachinesForm';
import { InsertersForm } from './components/InsertersForm';
import { BeltsForm } from './components/BeltsForm';
import { ChestsForm } from './components/ChestsForm';
import { DrillsForm } from './components/DrillsForm';
import { OverridesForm } from './components/OverridesForm';
import { ConfigImportExport, type BuildEntryHandle } from './components/ConfigImportExport';
import { IntroCard } from './components/IntroCard';
import { MissingInserterAlert } from './components/MissingInserterAlert';
import { ConfigFlowDiagram } from './components/ConfigFlowDiagram';
import { ChangelogDialog } from './components/ChangelogDialog';
import { MessageHost, MessageSlot } from './components/Messages';
import { ResultsWorkspace } from './components/ResultsWorkspace';
import { StaleCopyDialog } from './components/StaleCopyDialog';
import { CheckErrorAlert } from './components/CheckErrorAlert';
import { CheckPlanSection } from './components/CheckPlanSection';
import { BeltAssumption } from './components/BeltAssumption';
import { BeltAssumptionLine } from './components/BeltAssumptionLine';
import { WorkflowBar, type WorkflowView } from './components/WorkflowBar';
import { barNoteOf, focusBarNote, focusProblemTarget, needsListView, problemsOf, type FocusTarget, type Problem } from './utils/firstProblem';
import { afterCheck, checkChipOf, checkKeyOf, checkStatusOf, decideCheckOnly, decideGenerate, startsRun } from './utils/checkThenGenerate';
import { copyBlueprintLabelOf, rateWarningOf } from './utils/rateWarning';
import { configKeyOf, isStale } from './utils/resultsStaleness';
import { withDeeperSearch } from './utils/deeperSearch';
import { clockTechnicalName, plainClockName } from './utils/clockSummary';
import { ANNOUNCEMENTS } from './utils/workflowAnnouncement';
import { BELT_COPY, beltQuestionOf, nonMovingBeltsFor, standingBeltsHint, withBeltAnswer, type BeltAnswer } from './utils/beltQuestion';
import { PROGRESS_NAMES } from './utils/a11yLabels';
import { appTheme } from './theme/theme';
import { nextStepOf } from './utils/nextStep';
import { needsNoClock } from './utils/installSteps';
import { itemName, type GameNames } from './utils/gameNames';
import { GameNamesContext, SearchOnlyRecipesContext } from './hooks/useGameNames';
import type { EntityKind } from './utils/configForm/formData';
import { describeChestSwitch, describeDrillsOff, removalMessage, removedDeleteLabel } from './utils/undoSnapshot';
import { isBlankBuild } from './utils/introCard';
import type { TargetValues } from './utils/pasteTarget';

/** The theme, and the in-game names every picker and label reads */
function PageProviders({ gameNames, searchOnlyRecipes, children }: { gameNames: GameNames; searchOnlyRecipes: string[]; children: ReactNode }) {
    return (
        <ThemeProvider theme={appTheme}>
            <GameNamesContext value={gameNames}>
                <SearchOnlyRecipesContext value={searchOnlyRecipes}>{children}</SearchOnlyRecipesContext>
            </GameNamesContext>
        </ThemeProvider>
    );
}


function App() {
    const {
        isInitialized: workersReady,
        isRunning,
        progressStore,
        recipeNames,
        searchOnlyRecipes,
        resourceNames,
        itemNames,
        gameNames,
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

    const { offerUndo, withdrawUndo } = useUndo(config, setConfig, isConfigLoaded);

    // nothing entered yet: the intro card shows above Target Output (its ways in are the app bar's), and the bar says
    // where to start instead of counting problems
    const blankBuild = isBlankBuild(config);
    const { visible: introVisible, dismiss: dismissIntro, buildByHand, show: showIntro, afterReset } = useIntroCard(blankBuild);
    const buildEntryRef = useRef<BuildEntryHandle>(null);
    const handleBuildByHand = useCallback(() => {
        // the card goes first: focus then moves to the recipe, which takes its place at the top
        flushSync(() => buildByHand());
        focusProblemTarget({ kind: 'target-recipe' });
    }, [buildByHand]);
    const handleReset = useCallback(() => {
        resetConfig();
        afterReset();
    }, [resetConfig, afterReset]);
    // a paste that fills in Target Output
    const replaceTarget = useCallback((target: TargetValues) => {
        updateTargetOutput('recipe', target.recipe);
        updateTargetOutput('items_per_second', target.items_per_second);
        updateTargetOutput('copies', target.copies);
    }, [updateTargetOutput]);

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

    // null until the engine has looked for missing inserters; until then the check catches them
    const checkedCoverageIssues = useInserterValidation(exportConfig, isInitialized);
    // the header's height, so that what is focused and scrolled to is not left under it
    const headerRef = useRef<HTMLElement>(null);
    useStickyHeaderHeight(headerRef);
    const coverageIssues = checkedCoverageIssues ?? [];

    // Initialize worker on mount
    useEffect(() => {
        initialize();
    }, [initialize]);

    // Extract IDs for dropdown population
    const machineIds = useMemo(() => config.machines.map((m) => m.id), [config.machines]);

    // All item ids (from recipes and resources), in the order of their in-game names
    const itemNamesComposite = useMemo(() => {
        const names = new Set<string>();
        itemNames.forEach((name) => names.add(name));
        resourceNames.forEach((name) => names.add(name));
        const nameOf = (id: string) => itemName(gameNames, id);
        return Array.from(names).sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b));
    }, [itemNames, resourceNames, gameNames]);

    // the clocks on screen are for the build as it was when Generate was pressed
    const configKey = useMemo(() => configKeyOf(exportConfig()), [exportConfig]);
    const resultsAreStale = isStale(generatedFor, configKey);
    const staleFor = resultsAreStale ? generatedFor : null;
    // likewise a check, except that the switches only the clock search reads leave it current
    const checkKey = useMemo(() => checkKeyOf(exportConfig()), [exportConfig]);
    const checkStatus = checkStatusOf(validation, checkKey);
    // whether the clocks can get belt slack, and what the form says of the input belts
    const beltQuestion = useMemo(
        () => beltQuestionOf({ inserters: config.inserters, belts: config.belts, overrides: config.overrides }),
        [config.inserters, config.belts, config.overrides]
    );

    // the selected clock as the bar, the card and the announcements name it
    const selectedClock = alternatives[selectedAlternativeIndex];
    const selectedName = selectedClock ? plainClockName(alternatives, selectedAlternativeIndex) : null;
    const rateWarning = rateWarningOf(selectedClock);
    const copyLabel = copyBlueprintLabelOf(selectedClock, resultsAreStale);

    // one copy for every Copy button: the bar's, the card's and the string's
    const notify = useNotify();
    const announce = useAnnounce();
    const handleCopied = useCallback((warning: string | null) => {
        if (warning !== null) {
            // the warning's own message says that it was copied
            notify({ severity: 'warning', text: `Copied. ${warning}` });
        } else {
            announce(ANNOUNCEMENTS.copied);
        }
    }, [notify, announce]);
    const copy = useCopyBlueprint({ blueprintString, rateWarning, staleFor, onCopied: handleCopied });

    // another clock is announced ("Showing the clock: …"), except after the card's Back to recommended, which moves the
    // focus to the card's name and so reads it out already
    const [selectionQuiet, setSelectionQuiet] = useState(false);
    const handleSelectClock = useCallback((index: number) => {
        setSelectionQuiet(false);
        selectAlternative(index);
    }, [selectAlternative]);
    const handleSelectRecommended = useCallback(() => {
        setSelectionQuiet(false);
        selectRecommended();
    }, [selectRecommended]);
    const handleCardBackToRecommended = useCallback(() => {
        setSelectionQuiet(true);
        selectRecommended();
    }, [selectRecommended]);

    // the most the machines making the target recipe can make: a target above it is a problem
    const machinesMax = useMachinesMax(config.target_output.recipe, config.machines);
    // what keeps the build from being clocked, and so where Generate goes instead
    const problems = useMemo(() => problemsOf({
        targetOutput: config.target_output,
        machines: config.machines,
        coverageIssues: checkedCoverageIssues ?? [],
        machinesMax,
        itemLabel: (id) => itemName(gameNames, id),
    }), [config.target_output, config.machines, checkedCoverageIssues, machinesMax, gameNames]);

    // set while a check Generate started runs, which goes on to generate
    const [checkingFor, setCheckingFor] = useState<'generate' | null>(null);
    // both buttons are off while a check or a generation runs
    const busy = isRunning || validation.status === 'running' || checkingFor !== null;
    // a check the swing plan's Exclude chips start shows on Check only, as one of its own
    const checking = validation.status === 'running' ? (checkingFor ?? 'check-only') : null;
    const note = barNoteOf({ problems, busy, checkStatus, blank: blankBuild });
    // the one filled button of the bar and the card: Generate, or the Copy of the clocks it made
    const primaryAction = nextStepOf({
        problemCount: problems.length,
        // a generation, with the check Generate starts first; Check only alone leaves fresh clocks the next step
        isRunning: isRunning || checkingFor !== null,
        hasBlueprint: blueprintString !== null,
        stale: resultsAreStale,
        view,
        // the card shows no Copy for a build that needs no clock; the bar's then is the one
        pageHasCopy: selectedClock !== undefined && !needsNoClock(selectedClock.install),
    });
    // who started the running or last check, for the announcements: Generate leads on by itself
    const [checkedForGenerate, setCheckedForGenerate] = useState(false);

    // to where the problem is fixed: the Configure view, the List for the machines' fields, and the field itself
    const goToTarget = useCallback((target: FocusTarget) => {
        // shown before the focus moves: a hidden element takes no focus
        flushSync(() => {
            if (needsListView(target)) {
                setConfigView('list');
            }
            setView('configure');
        });
        focusProblemTarget(target);
    }, []);
    const handleGoToProblem = useCallback((problem: Problem) => {
        if (problem.target) {
            goToTarget(problem.target);
        }
    }, [goToTarget]);

    // after a check, its alert is focused once it is on the page; a new object each time, so the same target again
    // still moves the focus
    const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget } | null>(null);
    useEffect(() => {
        if (focusRequest) {
            focusProblemTarget(focusRequest.target);
        }
    }, [focusRequest]);
    const goToCheckError = useCallback(() => {
        setView('configure');
        setFocusRequest({ target: { kind: 'validation-error' } });
    }, []);

    /**
     * What Generate and Search deeper share: go to the first problem, or to the reason the last check failed; or check
     * the build first; then `start` the generation for the build as it was checked
     */
    const runChecked = useCallback((start: (config: Config) => void) => {
        const config = exportConfig();
        const decision = decideGenerate({ initialized: isInitialized, generating: isRunning || checkingFor !== null, checkStatus, problems });
        // running the build accepts it: an Undo offered before this press ends here, once (not when the check's own
        // generation starts later)
        if (startsRun(decision)) withdrawUndo();
        switch (decision.kind) {
            case 'wait':
                return;
            case 'go-to-problem':
                if (decision.problem.target) {
                    goToTarget(decision.problem.target);
                }
                return;
            case 'go-to-check-error':
                goToCheckError();
                return;
            case 'generate':
                start(config);
                return;
            case 'check-first':
                setCheckingFor('generate');
                setCheckedForGenerate(true);
                validate(config).then((outcome) => {
                    setCheckingFor(null);
                    const next = afterCheck(outcome);
                    if (next === 'generate') {
                        start(config);
                    } else if (next === 'go-to-check-error') {
                        goToCheckError();
                    }
                });
                return;
        }
    }, [exportConfig, isInitialized, isRunning, checkingFor, checkStatus, problems, withdrawUndo, goToTarget, goToCheckError, validate, setCheckingFor]);

    // checks without moving the page: the result shows as the chip, the alert and the swing plan
    const handleCheckOnly = useCallback(() => {
        const decision = decideCheckOnly({ initialized: isInitialized, generating: isRunning || checkingFor !== null, checkStatus, problems });
        if (startsRun(decision)) withdrawUndo();
        if (decision.kind === 'show-problems') {
            focusBarNote();
        } else if (decision.kind === 'check') {
            setCheckedForGenerate(false);
            validate(exportConfig());
        }
    }, [isInitialized, isRunning, checkingFor, checkStatus, problems, withdrawUndo, validate, exportConfig]);

    // excluding an ingredient from the LCM is done inside the validated plan, so it refreshes that plan itself
    const revalidateOnChangeRef = useRef(false);
    useEffect(() => {
        if (revalidateOnChangeRef.current) {
            revalidateOnChangeRef.current = false;
            validate(exportConfig());
        }
    }, [exportConfig, validate]);

    const handleGenerate = useCallback(() => runChecked((config) => {
        runSimulation(config, debugSteps, streamLogs);
        // progress and the clocks arrive there
        setView('results');
    }), [runChecked, runSimulation, debugSteps, streamLogs]);

    // Moving stores nothing, Standing `non_moving_belts: true`
    const handleBeltAnswer = useCallback(
        (answer: BeltAnswer) => updateOverrides('non_moving_belts', nonMovingBeltsFor(answer)),
        [updateOverrides]
    );
    // Results' "Generate again": checked first as Generate is, then the answer is set on the form and the clocks are
    // made for the build with it (a check is not changed by the answer, so one for the build as it was stays current)
    const handleSwitchBelts = useCallback((answer: BeltAnswer) => {
        if (busy) {
            return;
        }
        runChecked((config) => {
            if (beltQuestionOf(config).answer !== answer) {
                handleBeltAnswer(answer);
            }
            runSimulation(withBeltAnswer(config, answer), debugSteps, streamLogs);
            setView('results');
        });
    }, [busy, runChecked, handleBeltAnswer, runSimulation, debugSteps, streamLogs]);
    // the clocks on screen, read for belts that stand still; nothing while they may still change
    const beltAssumption = generatedFor?.beltQuestion ?? null;
    const beltHint = useMemo(
        () => busy || beltAssumption === null ? null : standingBeltsHint(alternatives, recommendedIndex, beltAssumption.answer),
        [busy, beltAssumption, alternatives, recommendedIndex]
    );

    // the actions that throw part of the build away offer Undo, just before they are applied
    const undoable = useMemo(() => {
        // a delete offers Undo, which brings the deleted row's delete button back for focus to go to
        const removal = (kind: EntityKind, remove: (index: number) => void) => (index: number) => {
            offerUndo((form) => removalMessage(form, kind, index), { restoredLabel: (form) => removedDeleteLabel(form, kind, index) });
            remove(index);
        };
        return {
            removeMachine: removal('machines', removeMachine),
            removeInserter: removal('inserters', removeInserter),
            removeBelt: removal('belts', removeBelt),
            removeChest: removal('chests', removeChest),
            removeDrill: removal('drills', removeDrill),
            switchChestType: (index: number, type: ChestType) => { offerUndo((form) => describeChestSwitch(form, index, type)); switchChestType(index, type); },
            disableDrills: () => { offerUndo(describeDrillsOff); disableDrills(); },
        };
    }, [offerUndo, removeMachine, removeInserter, removeBelt, removeChest, removeDrill, switchChestType, disableDrills]);
    // Import, Paste and Reset clear the generated clocks, which their Undo does not bring back; read when the build is
    // replaced, which for an import is after the file has been checked
    const hasResultsRef = useRef(false);
    useEffect(() => {
        hasResultsRef.current = alternatives.length > 0 || isRunning;
    }, [alternatives, isRunning]);
    const offerUndoOfReplace = useCallback(
        (message: string) => offerUndo(message, { resultsCleared: hasResultsRef.current }),
        [offerUndo]
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
        if (validation.status === 'valid' && checkStatus === 'valid') {
            revalidateOnChangeRef.current = true;
            setCheckedForGenerate(false);
            updateIgnoredIngredients(items, validation.validation.transfer_plan);
        }
    }, [validation, checkStatus, updateIgnoredIngredients]);

    const handleImportConfig = useCallback((imported: Config) => {
        importConfig(imported);
    }, [importConfig]);

    // Import, a Paste that replaced something, and Reset land on Configure, where the build's problems are shown
    const handleBuildReplaced = useCallback(() => {
        clearResults();
        setView('configure');
    }, [clearResults]);

    // Generate with the slower searches, checked first as Generate is: for this run only, or, kept on, by turning the
    // switch on in the form (one the check does not read, so it stays current)
    const handleSearchDeeper = useCallback((keepOn: boolean) => runChecked((config) => {
        if (keepOn) {
            // the form's key once the switch is on, so the results are not taken for out of date
            const kept = withDeeperSearch(config);
            updateOverrides('search_for_fewer_wake_ups', true);
            runSimulation(kept, debugSteps, streamLogs);
        } else {
            runSimulation(config, debugSteps, streamLogs, true);
        }
        setView('results');
    }), [runChecked, updateOverrides, runSimulation, debugSteps, streamLogs]);

    return (
        <PageProviders gameNames={gameNames} searchOnlyRecipes={searchOnlyRecipes}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                <AppBar position="sticky" ref={headerRef}>
                    <Toolbar>
                        <Icon sx={{ mr: 3 }}>
                            <img src="/big_biter_q5_right.png" alt="" style={{ width: 26, height: 26 }} />
                        </Icon>
                        <Typography variant="h6" component="h1" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Factorio </Box>Clock Generator
                        </Typography>
                        <ConfigImportExport
                            ref={buildEntryRef}
                            config={exportableConfig}
                            target={config.target_output}
                            onImport={handleImportConfig}
                            onReplaceTarget={replaceTarget}
                            onReplaceMachines={(machines) => replaceMachines(machines.map((m) => ({ ...m, _uuid: crypto.randomUUID() })))}
                            onReplaceDrills={(drills) => replaceDrills(drills.map((d) => ({ ...d, _uuid: crypto.randomUUID() })))}
                            onReplaceInserters={(inserters) => replaceInserters(inserters.map((ins, i) => ({ ...ins, id: ins.id ?? (i + 1), _uuid: crypto.randomUUID() })))}
                            onReplaceBelts={(belts) => replaceBelts(belts.map((b) => ({ ...b, _uuid: crypto.randomUUID() })))}
                            onReplaceChests={(chests) => replaceChests(chests.map((c) => ({ ...c, _uuid: crypto.randomUUID() } as ChestFormData)))}
                            onUpdateMiningProductivityLevel={(level) => updateDrillsConfig('mining_productivity_level', level)}
                            onReset={handleReset}
                            onBuildReplaced={handleBuildReplaced}
                            onUndoable={offerUndoOfReplace}
                            onShowIntro={showIntro}
                            pasteIsNextStep={blankBuild && !introVisible}
                        />
                    </Toolbar>
                    {isInitialized && (
                        <WorkflowBar
                            view={view}
                            onViewChange={setView}
                            isLoading={isRunning}
                            generationFailed={error !== null}
                            progressStore={progressStore}
                            onGenerate={handleGenerate}
                            onCheckOnly={handleCheckOnly}
                            primaryAction={primaryAction}
                            busy={busy}
                            checking={checking}
                            checkStatus={checkStatus}
                            checkedForGenerate={checkedForGenerate}
                            chip={checkChipOf({ checkStatus, clocksAreForThisBuild: generatedFor !== null && !resultsAreStale })}
                            blueprintString={blueprintString}
                            selectedLabel={selectedName}
                            selectedEngineName={selectedClock ? clockTechnicalName(selectedClock) : null}
                            selectedId={selectedClock?.id ?? null}
                            selectionQuiet={selectionQuiet}
                            rateWarning={rateWarning}
                            copyLabel={copyLabel}
                            staleFor={staleFor}
                            copied={copy.copied}
                            onCopy={copy.request}
                            problems={problems}
                            note={note}
                            startHere={blankBuild && problems.length > 0}
                            onGoToProblem={handleGoToProblem}
                        />
                    )}
                    {/* outside the condition: a message can come before the workflow bar is there */}
                    <MessageSlot active={!diagramFullscreen} />
                </AppBar>

                <Container component="main" maxWidth="xl" sx={{ py: 3, flexGrow: 1 }}>
                    {startupError ? (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            The page could not start: {startupError}. Reload the page to try again.
                        </Alert>
                    ) : !isInitialized ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
                            <CircularProgress aria-label={PROGRESS_NAMES.loadingData} />
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
                            <CheckErrorAlert message={validation.status === 'invalid' && checkStatus === 'invalid' ? validation.message : null} />

                            {introVisible && (
                                <IntroCard
                                    onPaste={() => buildEntryRef.current?.pasteFromFactorio()}
                                    onTryExample={() => buildEntryRef.current?.openExamples()}
                                    onBuildByHand={handleBuildByHand}
                                    onDismiss={dismissIntro}
                                />
                            )}

                            <TargetOutputForm
                                recipe={config.target_output.recipe}
                                itemsPerSecond={config.target_output.items_per_second}
                                copies={config.target_output.copies}
                                machinesMax={machinesMax}
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
                                        {/* in the button's own colour, which is black on the selected orange */}
                                        <Chip label="beta" size="small" variant="outlined" sx={{ ml: 0.75, height: 16, fontSize: '0.6rem', color: 'inherit', borderColor: 'currentColor', '& .MuiChip-label': { px: 0.5 } }} />
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
                                        beltQuestion={beltQuestion}
                                        onBeltAnswer={handleBeltAnswer}
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
                                    {/* the Belts card is not drawn here, so the belt question gets a card of its own */}
                                    {beltQuestion.ask && (
                                        <Paper sx={{ p: 2, mt: 2 }} data-belt-question-diagram="">
                                            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                                                {BELT_COPY.diagramHeading}
                                            </Typography>
                                            <BeltAssumption answer={beltQuestion.answer} onChange={handleBeltAnswer} />
                                        </Paper>
                                    )}
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
                                    searchForFewerWakeUps={config.overrides?.search_for_fewer_wake_ups}
                                    onUpdate={updateOverrides}
                                    planSlot={(
                                        <CheckPlanSection
                                            validation={validation}
                                            checkStatus={checkStatus}
                                            busy={busy}
                                            onCheckOnly={handleCheckOnly}
                                            note={note}
                                            excludedIngredients={config.overrides?.ignored_lcm_ingredients ?? []}
                                            onExcludeChange={handleExcludeChange}
                                        />
                                    )}
                                />
                            </Box>

                        </Box>

                        <Box sx={{ display: view === 'results' ? 'block' : 'none' }}>
                            <ResultsWorkspace
                                isRunning={isRunning}
                                error={error}
                                alternatives={alternatives}
                                selectedIndex={selectedAlternativeIndex}
                                onSelect={handleSelectClock}
                                recommendedIndex={recommendedIndex}
                                onSelectRecommended={handleSelectRecommended}
                                onCardBackToRecommended={handleCardBackToRecommended}
                                pickRule={pickRule}
                                pending={pendingAlternatives}
                                skippedSearches={skippedSearches}
                                searchedDeeper={searchedDeeper}
                                keptOn={config.overrides?.search_for_fewer_wake_ups === true}
                                canSearchDeeper={!busy}
                                searchDeeperBlockedBy={note}
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
                                copied={copy.copied}
                                onCopy={copy.request}
                                copyLabel={copyLabel}
                                copyIsNextStep={primaryAction === 'copy-page'}
                                // only when the run asked the belt question; otherwise the card says the belt itself
                                beltAction={beltAssumption?.ask ? (
                                    <BeltAssumptionLine
                                        assumption={beltAssumption}
                                        hint={beltHint}
                                        busy={busy}
                                        onSwitch={handleSwitchBelts}
                                    />
                                ) : undefined}
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
                aria-labelledby="diagram-fullscreen-title"
                open={diagramFullscreen}
                onClose={() => setDiagramFullscreen(false)}
                PaperProps={{ sx: { bgcolor: 'background.default' } }}
                // a view of the build, not an edit of one entity: Ctrl/Cmd+Z undoes in it as on the page
                data-fullscreen-diagram=""
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                    <Box
                        sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            columnGap: 1,
                            alignItems: 'center',
                            px: 2,
                            py: 1,
                            flexShrink: 0,
                            bgcolor: 'background.paper',
                            borderBottom: 1,
                            borderColor: 'divider',
                        }}
                    >
                        <Typography id="diagram-fullscreen-title" variant="h6" component="h2" sx={{ flex: 1 }}>Flow Diagram</Typography>
                        {/* the page's header is behind this dialog, so its message shows here */}
                        <MessageSlot active={diagramFullscreen} inBar />
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
                            {/* the page's own alert behind this dialog has the ids a problem's jump looks for */}
                            <MissingInserterAlert issues={coverageIssues} onApplyFix={applyInserterFix} focusTargets={false} />
                        </Box>
                    )}
                </Box>
            </Dialog>

            {staleFor && (
                <StaleCopyDialog
                    open={copy.confirmingStale}
                    generatedFor={staleFor}
                    onCancel={copy.cancel}
                    onConfirm={copy.confirm}
                />
            )}

            <MessageHost />
        </PageProviders>
    );
}

export default App;
