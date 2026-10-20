import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
    AppBar,
    Box,
    Button,
    CircularProgress,
    Container,
    CssBaseline,
    Dialog,
    IconButton,
    Link,
    ThemeProvider,
    Typography,
    Alert,
} from '@mui/material';
import { Abc, Code, FullscreenExit, LocalCafe } from '@mui/icons-material';
import type { ChestType, Config, DebugSteps, InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import { useSimulationWorker } from './hooks/useSimulationWorker';
import { useConfigForm, type BuildMutationSnapshot } from './hooks/useConfigForm';
import type { InserterFormData } from './hooks/useConfigForm';
import { useInserterValidation } from './hooks/useInserterValidation';
import { useAnnounce, useDismissMessage, useNotify } from './hooks/useMessages';
import { useSharedBuildLink } from './hooks/useSharedBuildLink';
import { useStickyHeaderHeight } from './hooks/useStickyHeaderHeight';
import { useUndo } from './hooks/useUndo';
import { useCopyBlueprint, type BlueprintCopyFailure } from './hooks/useCopyBlueprint';
import { useIntroCard } from './hooks/useIntroCard';
import { BuildSectionsContext, useBuildViewContext, type BuildContextReady } from './hooks/useBuildViewContext';
import { serializeConfig } from './hooks/usePersistedConfigForm';
import { selectBuildEntity } from './utils/buildViewContext';
import { useMachinesMax } from './hooks/useMachineFacts';
import { TargetOutputForm } from './components/TargetOutputForm';
import { MachinesForm } from './components/MachinesForm';
import { InsertersForm } from './components/InsertersForm';
import { BeltsForm } from './components/BeltsForm';
import { ChestsForm } from './components/ChestsForm';
import { DrillsForm } from './components/DrillsForm';
import { OverridesForm } from './components/OverridesForm';
import { ConfigImportExport, type BuildEntryHandle, type ToolsMenuItem } from './components/ConfigImportExport';
import { TermsPopover } from './components/TermsPopover';
import { IntroCard } from './components/IntroCard';
import { BuildSwitcher } from './components/BuildSwitcher';
import { RenameBuildDialog } from './components/RenameBuildDialog';
import { OpenSharedBuildDialog } from './components/OpenSharedBuildDialog';
import { BuildValidationPanel } from './components/BuildValidationPanel';
import { outputChestIssues } from './utils/outputChestIssues';
import { buildValidationIssues } from './utils/buildValidation';
import { ConfigFlowDiagram } from './components/ConfigFlowDiagram';
import { BuildPanel, type BuildView } from './components/BuildPanel';
import { PanelSection } from './components/Panel';
import { advancedSetCount } from './utils/advancedSummary';
import { ChangelogDialog } from './components/ChangelogDialog';
import { MessageHost, MessageSlot } from './components/Messages';
import { DisplayPreferencesProvider } from './hooks/useDisplayPreferences';
import type { ResultDetail } from './utils/resultsView';
import { ResultsWorkspace } from './components/ResultsWorkspace';
import { StaleCopyDialog } from './components/StaleCopyDialog';
import { ManualBlueprintDialog } from './components/ManualBlueprintDialog';
import { CheckErrorAlert } from './components/CheckErrorAlert';
import { CheckPlanSection } from './components/CheckPlanSection';
import { BeltAssumption } from './components/BeltAssumption';
import { BeltAssumptionLine } from './components/BeltAssumptionLine';
import { WorkflowBar, type WorkflowView } from './components/WorkflowBar';
import { barNoteOf, focusBarNote, focusProblemTarget, needsListView, problemsOf, PROBLEM_TEXT, type FocusTarget, type Problem } from './utils/firstProblem';
import { afterCheck, checkChipOf, checkKeyOf, checkStatusOf, decideCheckOnly, decideGenerate, startsRun } from './utils/checkThenGenerate';
import { copyBlueprintLabelOf, rateWarningOf } from './utils/rateWarning';
import { buildChangesText } from './utils/buildChanges';
import { configKeyOf, isStale } from './utils/resultsStaleness';
import { withDeeperSearch } from './utils/deeperSearch';
import { clockTechnicalName, plainClockName } from './utils/clockSummary';
import { ANNOUNCEMENTS } from './utils/workflowAnnouncement';
import { BELT_COPY, beltQuestionOf, backedUpBeltsFor, backedUpBeltsHint, withBeltAnswer, type BeltAnswer } from './utils/beltQuestion';
import { PickupGeometrySummary } from './components/PickupGeometrySummary';
import { PROGRESS_NAMES } from './utils/a11yLabels';
import { entityLabel } from './utils/entityLabel';
import { NO_DEBUG_STEPS, developerToolsInitial, readDeveloperTools, writeDeveloperTools } from './utils/developerTools';
import { createAppTheme } from './theme/theme';
import { useResolvedColorScheme } from './hooks/useResolvedColorScheme';
import { nextStepOf } from './utils/nextStep';
import { itemName, recipeName, type GameNames } from './utils/gameNames';
import { GameNamesContext, SearchOnlyRecipesContext } from './hooks/useGameNames';
import { RuleTimingContext } from './components/RuleTimingContext';
import { ruleTimingOf, type RuleTiming } from './utils/ruleTiming';
import type { EntityKind } from './utils/configForm/formData';
import { describeChestSwitch, removalMessage, removedDeleteLabel, reorderMessage } from './utils/undoSnapshot';
import { isBlankBuild } from './utils/introCard';
import { configToFormData, formDataToConfig } from './utils/configForm/configMapping';
import { applyRepeatedUnitConversion } from './utils/configForm/repeatedUnitConversion';
import { askEngine } from './worker/engineClient';
import { applyInserterFix, inserterFixProblem } from './utils/configForm/inserterFix';
import { hasImportedBeltDrops } from './utils/inserterMetadata';
import {
    buildTitles,
    CHANGED_ELSEWHERE_MESSAGE,
    cleanName,
    deletedBuildMessage,
    duplicatedAnnouncement,
    LOAD_OTHER_TAB_LABEL,
    LOADED_OTHER_TAB_MESSAGE,
    NEW_BUILD_ANNOUNCEMENT,
    openedBuildAnnouncement,
    recipeTitle,
    renamedAnnouncement,
    renameBuild,
    UNTITLED_BUILD,
    type BuildMeta,
} from './utils/buildLibrary';
import { sharedBuildSummary, sharedOpenedMessage, sharedPlaceNote, type SharedBuild } from './utils/shareLink';

/** The page's own items in ⋮ */
const TOOLS_MENU = {
    terms: 'Terms',
    developerTools: 'Developer tools',
};

function DisplayThemeProvider({ children }: { children: ReactNode }) {
    const mode = useResolvedColorScheme();
    return <ThemeProvider theme={createAppTheme(mode)}>{children}</ThemeProvider>;
}

/** The theme, the in-game names every picker and label reads, and the timing the rule editor checks a rule against */
function PageProviders({ gameNames, searchOnlyRecipes, ruleTiming, children }: { gameNames: GameNames; searchOnlyRecipes: string[]; ruleTiming: RuleTiming; children: ReactNode }) {
    return (
        <DisplayPreferencesProvider>
            <DisplayThemeProvider>
                <GameNamesContext value={gameNames}>
                    <SearchOnlyRecipesContext value={searchOnlyRecipes}>
                        <RuleTimingContext value={ruleTiming}>{children}</RuleTimingContext>
                    </SearchOnlyRecipesContext>
                </GameNamesContext>
            </DisplayThemeProvider>
        </DisplayPreferencesProvider>
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
        errorRecovery,
        initialize,
        runSimulation,
        generatedFor,
        generationAssumptions,
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
    } = useSimulationWorker();

    const {
        config,
        isLoaded: isConfigLoaded,
        loadError: configLoadError,
        loadNotice,
        dismissLoadNotice,
        library,
        setConfig,
        captureBuildMutation,
        commitBuildReplacement,
        updateTargetOutput,
        duplicateEntity,
        updateInserters,
        addMachine,
        updateMachine,
        removeMachine,
        addInserter,
        updateInserter,
        removeInserter,
        addBelt,
        updateBelt,
        removeBelt,
        addChest,
        updateChest,
        switchChestType,
        removeChest,
        updateDrillsConfig,
        addDrill,
        updateDrill,
        removeDrill,
        updateOverrides,
        updateIgnoredIngredients,
        importConfig,
        engineConfig,
        exportableConfig,
        resetConfig,
        reorderMachines,
        reorderInserters,
        reorderBelts,
        reorderChests,
        reorderDrills,
    } = useConfigForm();

    const { offerUndo, withdrawUndo } = useUndo(config, setConfig, isConfigLoaded, library.currentId);
    const fixUnavailable = useCallback((fix: InserterFixOption, issue?: InserterCoverageIssue) => inserterFixProblem({ belts: config.belts, inserters: config.inserters }, fix, issue), [config.belts, config.inserters]);

    // nothing entered yet: the intro card shows above Target Output (its ways in are the app bar's), and the bar says
    // where to start instead of counting problems
    const blankBuild = isBlankBuild(config);
    const { visible: introVisible, builtByHand, dismiss: dismissIntro, buildByHand, show: showIntro, afterReset } = useIntroCard(blankBuild);
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
    // the clocks kept for the build (or shown last) come back once the saved build is loaded, before the page shows
    const [resultsRestored, setResultsRestored] = useState(false);
    // the page waits for the workers, for the saved config, which the engine's worker checks, and for its kept clocks
    const isInitialized = workersReady && isConfigLoaded && resultsRestored;
    // until the workers are ready, an error is one that stopped them starting
    const startupError = (!workersReady && error) || configLoadError;

    const [debugSteps, setDebugSteps] = useState<DebugSteps>({
        prepare: false,
        warm_up: false,
        simulate: false,
    });
    const [streamLogs, setStreamLogs] = useState(false);
    // ⋮ > Developer tools, or `?debug`: logging controls. While they are off their switches are out of sight,
    // so a generation runs without them
    const [developerTools, setDeveloperTools] = useState(() => developerToolsInitial(window.location.search, readDeveloperTools()));
    const runDebugSteps = developerTools ? debugSteps : NO_DEBUG_STEPS;
    const runStreamLogs = developerTools && streamLogs;
    // ⋮ > Terms: the popover hangs from the ⋮ button
    const [termsAnchor, setTermsAnchor] = useState<HTMLElement | null>(null);

    const replacementRevisionRef = useRef(0);
    const [replacedCount, setReplacedCount] = useState(0);
    const [contextReady, setContextReady] = useState<BuildContextReady | null>(null);
    const contextFormKey = useMemo(() => serializeConfig(config), [config]);
    const contextIdentity = useRef({ buildId: library.currentId, formKey: contextFormKey, replacementRevision: replacedCount });
    useLayoutEffect(() => { contextIdentity.current = { buildId: library.currentId, formKey: contextFormKey, replacementRevision: replacedCount }; }, [library.currentId, contextFormKey, replacedCount]);
    const { context: buildContext, patch: patchContext, cancelRestore, saveDeparture, resetForReplacement, forgetBuild } = useBuildViewContext({
        buildId: library.currentId, ready: isInitialized ? contextReady : null, form: config, formKey: contextFormKey, hasResults: alternatives.length > 0, hasFuel: fuelView !== null, replacementRevision: replacedCount,
        insightIds: alternatives.flatMap(clock => clock.insights.map(insight => insight.id)),
    });
    const { configView, view, resultDetail } = buildContext;
    const advancedOpen = buildContext.sections.advanced ?? false;
    const setConfigView = useCallback((configView: BuildView) => patchContext({ configView }), [patchContext]);
    const setView = useCallback((view: WorkflowView) => patchContext({ view }), [patchContext]);
    const setResultDetail = useCallback((resultDetail: ResultDetail) => patchContext({ resultDetail }), [patchContext]);
    const setAdvancedOpen = useCallback((open: boolean) => patchContext({ sections: { ...buildContext.sections, advanced: open } }), [patchContext, buildContext.sections]);
    const sectionContext = useMemo(() => ({ sections: buildContext.sections, onSectionChange: (key: string, open: boolean) => patchContext({ sections: { ...buildContext.sections, [key]: open } }) }), [buildContext.sections, patchContext]);
    const [diagramFullscreen, setDiagramFullscreen] = useState(false);
    const [inserterFocusRequest, setInserterFocusRequest] = useState<{ id: number; filters: boolean; pickup?: boolean } | null>(null);
    const [beltFocusRequest, setBeltFocusRequest] = useState<{ id: number } | null>(null);
    useEffect(() => {
        if (!beltFocusRequest) return;
        const frame = requestAnimationFrame(() => {
            const row = document.getElementById(`entity-belt-${beltFocusRequest.id}`);
            row?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
            row?.scrollIntoView({ block: 'center' });
            setBeltFocusRequest(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [beltFocusRequest]);
    const finishInserterFocus = useCallback(() => setInserterFocusRequest(null), []);
    const reviewPickup = useCallback((id: number) => {
        cancelRestore();
        setDiagramFullscreen(false);
        setConfigView('list');
        setView('configure');
        setInserterFocusRequest({ id, filters: false, pickup: true });
    }, [cancelRestore, setConfigView, setView]);
    const handleInserterFix = useCallback((issue: InserterCoverageIssue, fix: InserterFixOption) => {
        if (fixUnavailable(fix, issue)) return;
        setDiagramFullscreen(false);
        setConfigView('list');
        if (fix.type === 'review_filters') {
            setInserterFocusRequest({ id: fix.inserter_id, filters: true });
            return;
        }
        const before = captureBuildMutation().form;
        const next = applyInserterFix(before, issue, fix);
        if (next === before) return;
        const id = next.inserters.at(-1)?.id;
        offerUndo(fix.type === 'add_lane_to_existing_belt' ? `Added a lane to ${entityLabel('belt', fix.belt_id)}.` : `Added a connection for ${entityLabel('machine', issue.machine_id)}.`, { snapshot: before });
        setConfig(next);
        if (fix.type === 'add_lane_to_existing_belt') setBeltFocusRequest({ id: fix.belt_id });
        else if (id !== undefined) setInserterFocusRequest({ id, filters: false });
    }, [fixUnavailable, setConfigView, captureBuildMutation, offerUndo, setConfig]);
    const [changelogOpen, setChangelogOpen] = useState(false);

    // null until the engine has looked for missing inserters; until then the check catches them
    const checkedCoverage = useInserterValidation(engineConfig, isInitialized);
    // the header's height, so that what is focused and scrolled to is not left under it
    const headerRef = useRef<HTMLElement>(null);
    useStickyHeaderHeight(headerRef);
    const chestIssues = useMemo(() => outputChestIssues(config.chests, config.inserters), [config.chests, config.inserters]);

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
    const configKey = useMemo(() => configKeyOf(engineConfig), [engineConfig]);
    const resultsAreStale = isStale(generatedFor, configKey);
    const staleFor = resultsAreStale ? generatedFor : null;
    // what changed since the clocks on screen were made, for the stale banner and the Copy-old dialog
    const recipeLabel = useCallback((id: string) => recipeName(gameNames, id), [gameNames]);
    const staleChanges = useMemo(
        () => (staleFor ? buildChangesText(JSON.parse(staleFor.key) as Config, engineConfig, 3, recipeLabel) : []),
        [staleFor, engineConfig, recipeLabel],
    );
    // the key of the form as last rendered: a build replaced as a whole still has it when its replacement is handled
    const configKeyRef = useRef(configKey);
    useEffect(() => {
        configKeyRef.current = configKey;
    }, [configKey]);

    // on load: the clocks kept for the saved build, else the ones shown last (out of date, as they were on screen)
    useEffect(() => {
        if (isConfigLoaded && resultsStoreReady && !resultsRestored) {
            const requested = contextIdentity.current;
            void restoreResultsFor(configKeyRef.current, 'load').finally(() => {
                const current = contextIdentity.current;
                if (current.buildId === requested.buildId && current.formKey === requested.formKey && current.replacementRevision === requested.replacementRevision) setContextReady(requested);
                setResultsRestored(true);
            });
        }
    }, [isConfigLoaded, resultsStoreReady, resultsRestored, restoreResultsFor]);
    // an empty Results shows the clocks kept for the build it now has: after an Undo of Import, Paste or Reset, a
    // build switched back to, or an edit back to a build that has them
    const resultsEmpty = alternatives.length === 0 && !isRunning && error === null;
    // set by a switch to another build (Open, New, Duplicate) to what it says ("Opened build: …"): said once the restore
    // is known, with "Its clocks are back." when they are, so one message says both. Good for the render right after the
    // switch only
    const announce = useAnnounce();
    const switchMessageRef = useRef<string | ((restored: boolean) => void) | null>(null);
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    // bumped by every replace of the build, which drops a restore still on its way: the one for the build that is now
    // in the form starts again, even when the form already had it (a switch that set the form before it was handled)
    useEffect(() => {
        const requested = contextIdentity.current;
        const switched = switchMessageRef.current;
        const revision = replacementRevisionRef.current;
        const complete = (back: boolean) => {
            // The cache's own render does not cancel its completion. A newer replacement, edit or unmount does.
            if (!mountedRef.current || revision !== replacementRevisionRef.current || configKey !== configKeyRef.current) return;
            const current = contextIdentity.current;
            if (current.buildId !== requested.buildId || current.formKey !== requested.formKey || current.replacementRevision !== requested.replacementRevision) return;
            setContextReady(previous => previous?.buildId === requested.buildId && previous.formKey === requested.formKey && previous.replacementRevision === requested.replacementRevision ? previous : requested);
            if (typeof switched === 'function') switched(back);
            else if (switched !== null) announce(back ? `${switched} ${ANNOUNCEMENTS.itsClocksBack}` : switched);
        };
        const navigationNeedsCache = contextReady?.buildId !== requested.buildId || contextReady.replacementRevision !== requested.replacementRevision;
        if (isInitialized && (resultsEmpty || navigationNeedsCache)) {
            void restoreResultsFor(configKey, 'replace', { announce: switched === null }).then(complete, () => complete(false));
        } else if (switched !== null) {
            complete(false);
        }
    }, [configKey, contextFormKey, library.currentId, contextReady, isInitialized, resultsEmpty, replacedCount, restoreResultsFor, announce]);
    useEffect(() => {
        switchMessageRef.current = null;
    });
    // likewise a check, except that the switches only the clock search reads leave it current
    const checkKey = useMemo(() => checkKeyOf(engineConfig), [engineConfig]);
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
    const [installOpen, setInstallOpen] = useState(false);
    const copyLabel = copyBlueprintLabelOf(selectedClock, resultsAreStale, isRunning);

    // what the rule editor checks a rule against: the selected clock while it is for this build, else the last check
    const timingClock = generatedFor !== null && !resultsAreStale ? selectedClock ?? null : null;
    const checkedPlan = validation.status === 'valid' && checkStatus === 'valid' ? validation.validation : null;
    const checkedCycle = checkedPlan?.cycle_ticks ?? null;
    const checkedPeriod = checkedPlan?.period_ticks ?? null;
    const ruleTiming = useMemo(
        () => ruleTimingOf({
            results: timingClock
                ? { cycleTicks: timingClock.cycleTicks, periodTicks: timingClock.simulationDurationTicks, windows: timingClock.clockWindows }
                : null,
            check: checkedCycle !== null && checkedPeriod !== null ? { cycleTicks: checkedCycle, periodTicks: checkedPeriod } : null,
        }),
        [timingClock, checkedCycle, checkedPeriod],
    );

    // one copy for every Copy button: the bar's, the card's and the string's
    const notify = useNotify();
    const dismiss = useDismissMessage();
    const [manualCopy, setManualCopy] = useState<BlueprintCopyFailure | null>(null);
    const copyFailureMessage = useRef<number | null>(null);
    const retireCopyFailure = useCallback(() => {
        if (copyFailureMessage.current !== null) dismiss(copyFailureMessage.current);
        copyFailureMessage.current = null;
        setManualCopy(null);
    }, [dismiss, setManualCopy]);
    const handleCopyFailed = useCallback((failure: BlueprintCopyFailure) => {
        copyFailureMessage.current = notify({
            severity: 'error',
            text: 'Could not copy the blueprint. Select the string to copy it yourself.',
            action: { label: 'Select blueprint string', onClick: () => setManualCopy(failure) },
        });
    }, [notify, setManualCopy]);
    const copyIdentity = useMemo(() => ({ build: library.currentId, generatedFor, clock: selectedClock?.id, blueprintString, staleFor }),
        [library.currentId, generatedFor, selectedClock?.id, blueprintString, staleFor]);
    const handleCopied = useCallback((warning: string | null, whileRunning: boolean) => {
        // the best clock so far stays selected: said, with its name
        const copied = whileRunning && selectedName ? ANNOUNCEMENTS.copiedCurrentBest(selectedName) : null;
        if (warning !== null) {
            // the warning's own message says that it was copied
            notify({ severity: 'warning', text: `${copied ?? 'Copied.'} ${warning}` });
        } else {
            announce(copied ?? ANNOUNCEMENTS.copied);
        }
    }, [notify, announce, selectedName]);
    // copying the best clock so far picks it, as a click on its row does
    const pinSelected = useCallback(() => selectAlternative(selectedAlternativeIndex), [selectAlternative, selectedAlternativeIndex]);
    const copy = useCopyBlueprint({ blueprintString, rateWarning, staleFor, running: isRunning, copyIdentity,
        onCopied: handleCopied, onPinned: pinSelected, onCopyFailed: handleCopyFailed, onCopyAttempt: retireCopyFailure });

    // another clock is announced ("Showing the clock: …"), except after the card's Back to recommended, which moves the
    // focus to the card's name and so reads it out already
    const [selectionQuiet, setSelectionQuiet] = useState(false);
    const handleSelectClock = useCallback((index: number) => {
        setSelectionQuiet(false);
        selectAlternative(index);
    }, [selectAlternative]);
    // ⋮ > Terms and ⋮ > Developer tools; the setting is kept for the next visit, and said, as the section it adds is at
    // the end of Results
    const toggleDeveloperTools = useCallback(() => {
        const next = !developerTools;
        setDeveloperTools(next);
        writeDeveloperTools(next);
        announce(next ? ANNOUNCEMENTS.developerToolsOn : ANNOUNCEMENTS.developerToolsOff);
    }, [developerTools, announce]);
    const toolsMenuItems = useMemo<ToolsMenuItem[]>(() => [
        { key: 'terms', label: TOOLS_MENU.terms, icon: <Abc fontSize="small" />, onClick: setTermsAnchor },
        {
            key: 'developer-tools',
            label: TOOLS_MENU.developerTools,
            icon: <Code fontSize="small" />,
            checked: developerTools,
            onClick: toggleDeveloperTools,
        },
    ], [developerTools, toggleDeveloperTools]);

    const handleCardBackToRecommended = useCallback(() => {
        setSelectionQuiet(true);
        selectRecommended();
    }, [selectRecommended]);

    // the most the machines making the target recipe can make: a target above it is a problem
    const machinesMax = useMachinesMax(config.target_output.recipe, config.machines);
    // what keeps the build from being clocked, and so where Generate goes instead
    const validationIssues = useMemo(() => buildValidationIssues({
        fieldProblems: problemsOf({
            targetOutput: config.target_output,
            machines: config.machines,
            machinesMax,
        }),
        coverage: checkedCoverage?.issues ?? [], scopeRefusal: checkedCoverage?.refusal, chests: config.chests, inserters: config.inserters, machines: config.machines, chestIssues,
        coverageText: issue => (issue.kind === 'missing_input_inserter' ? PROBLEM_TEXT.missingInput : PROBLEM_TEXT.missingOutput)(
            issue.machine_id, issue.item_name, id => itemName(gameNames, id)),
        failure: validation.status === 'invalid' && checkStatus === 'invalid' && !validation.crashed
            ? { message: validation.message, diagnostics: validation.diagnostics }
            : error && errorRecovery?.sourceConfigKey === configKey ? { message: error } : undefined,
    }), [config.target_output, config.machines, config.chests, config.inserters, checkedCoverage, chestIssues, machinesMax, gameNames, validation, checkStatus, error, errorRecovery, configKey]);
    const problems = useMemo(() => validationIssues.filter(issue => issue.blocksGeneration), [validationIssues]);

    // set while a check Generate started runs, which goes on to generate
    const [checkingFor, setCheckingFor] = useState<'generate' | null>(null);
    const [conversionPending, setConversionPending] = useState(false);
    const conversionTokenRef = useRef(0);
    const conversionPendingRef = useRef(false);
    const conversionRecheckRef = useRef<{
        token: number; owner: BuildMutationSnapshot; key: string; complete?: (suffix?: string) => void;
    } | null>(null);
    const retireConversion = useCallback(() => {
        conversionTokenRef.current++;
        conversionPendingRef.current = false;
        conversionRecheckRef.current = null;
        setConversionPending(false);
    }, []);
    useEffect(() => () => { conversionTokenRef.current++; }, []);
    // both buttons are off while a check or a generation runs
    const busy = isRunning || validation.status === 'running' || checkingFor !== null || conversionPending;
    // a check the swing plan's Exclude chips start shows on Check only, as one of its own
    const checking = conversionPending ? 'generate' : validation.status === 'running' ? (checkingFor ?? 'check-only') : null;
    const note = blankBuild ? barNoteOf({ problems, busy, checkStatus, blank: true, entryRoute: builtByHand ? 'manual' : 'routes' }) : null;
    // the one filled button of the bar and the card: Generate, or the Copy of the clocks it made
    const primaryAction = nextStepOf({
        problemCount: problems.length,
        // a generation, with the check Generate starts first; Check only alone leaves fresh clocks the next step
        isRunning: isRunning || checkingFor !== null,
        hasBlueprint: blueprintString !== null,
        stale: resultsAreStale,
        view,
        // Copy stays in the sticky toolbar on both Configure and Results.
        pageHasCopy: false,
    });
    // who started the running or last check, for the announcements: Generate leads on by itself
    const [checkedForGenerate, setCheckedForGenerate] = useState(false);

    // to where the problem is fixed: the Configure view, the List for the machines' fields, and the field itself
    const goToTarget = useCallback((target: FocusTarget) => {
        cancelRestore();
        // shown before the focus moves: a hidden element takes no focus
        flushSync(() => {
            if (needsListView(target)) {
                setConfigView('list');
            }
            setView('configure');
        });
        focusProblemTarget(target);
    }, [cancelRestore, setConfigView, setView]);
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
            if (!focusProblemTarget(focusRequest.target) && focusRequest.target.kind === 'validation-panel')
                focusProblemTarget({ kind: 'validation-error' });
        }
    }, [focusRequest]);
    const goToCheckError = useCallback(() => {
        cancelRestore();
        setView('configure');
        setFocusRequest({ target: { kind: 'validation-panel' } });
    }, [cancelRestore, setView]);

    /**
     * What Generate and Search deeper share: go to the first problem, or to the reason the last check failed; or check
     * the build first; then `start` the generation for the build as it was checked
     */
    const runChecked = useCallback((start: (config: Config) => void) => {
        cancelRestore();
        const config = engineConfig;
        // a check whose worker crashed did not judge the build: Generate checks again instead of going to its error
        const lastCheckCrashed = validation.status === 'invalid' && validation.crashed === true;
        const decision = decideGenerate({ initialized: isInitialized, generating: isRunning || checkingFor !== null || conversionPendingRef.current, checkStatus, problems, lastCheckCrashed });
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
    }, [cancelRestore, engineConfig, isInitialized, isRunning, checkingFor, checkStatus, validation, problems, withdrawUndo, goToTarget, goToCheckError, validate, setCheckingFor]);

    // stops the generation, or the check Generate started (whose Generate then does not start)
    const handleCancel = useCallback(() => {
        retireConversion();
        cancel();
        setCheckingFor(null);
    }, [cancel, setCheckingFor, retireConversion]);

    // checks without moving the page: the result shows as the chip, the alert and the swing plan
    const handleCheckOnly = useCallback(() => {
        cancelRestore();
        const liveProblems = problems.filter(issue => issue.source !== 'engine');
        const decision = decideCheckOnly({ initialized: isInitialized, generating: isRunning || checkingFor !== null || conversionPendingRef.current, checkStatus, problems: liveProblems });
        if (startsRun(decision)) withdrawUndo();
        if (decision.kind === 'show-problems') {
            if (blankBuild) focusBarNote();
            else if (liveProblems[0]?.target) goToTarget(liveProblems[0].target);
        } else if (decision.kind === 'check') {
            setCheckedForGenerate(false);
            validate(engineConfig);
        }
    }, [cancelRestore, isInitialized, isRunning, checkingFor, checkStatus, problems, withdrawUndo, validate, engineConfig, blankBuild, goToTarget]);

    // excluding an ingredient from the LCM is done inside the validated plan, so it refreshes that plan itself
    const revalidateOnChangeRef = useRef(false);
    useEffect(() => {
        const conversion = conversionRecheckRef.current;
        if (conversion) {
            conversionRecheckRef.current = null;
            const current = captureBuildMutation();
            if (conversion.token !== conversionTokenRef.current || current.buildId !== conversion.owner.buildId
                || current.revision !== conversion.owner.revision || current.form !== conversion.owner.form
                || configKeyOf(engineConfig) !== conversion.key) return;
            setCheckedForGenerate(true); // D10 owns the single deferred announcement and focus.
            // The accepted action has disappeared; move focus only while this committed owner is current.
            cancelRestore();
            focusProblemTarget({ kind: 'target-rate' });
            // Internal Check intentionally retains whole-build Undo; it never starts Generate.
            void validate(formDataToConfig(current.form)).then(outcome => {
                const owner = captureBuildMutation();
                if (!mountedRef.current || conversion.token !== conversionTokenRef.current || outcome.kind === 'dropped'
                    || owner.buildId !== current.buildId || owner.revision !== current.revision || owner.form !== current.form) return;
                conversion.complete?.(outcome.kind === 'valid' ? 'Check passed.' : 'The check failed. Review the reason in Configure.');
                if (outcome.kind === 'invalid') goToCheckError();
            });
            return;
        }
        if (revalidateOnChangeRef.current) {
            revalidateOnChangeRef.current = false;
            validate(engineConfig);
        }
    }, [cancelRestore, engineConfig, validate, captureBuildMutation, goToCheckError]);

    const handleGenerate = useCallback(() => runChecked((config) => {
        runSimulation(config, runDebugSteps, runStreamLogs);
        // progress and the clocks arrive there
        setView('results');
    }), [runChecked, runSimulation, runDebugSteps, runStreamLogs, setView]);

    // Moving stores nothing, BackedUp `backed_up_belts: true`
    const handleBeltAnswer = useCallback(
        (answer: BeltAnswer) => updateOverrides('backed_up_belts', backedUpBeltsFor(answer)),
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
            runSimulation(withBeltAnswer(config, answer), runDebugSteps, runStreamLogs);
            setView('results');
        });
    }, [busy, runChecked, handleBeltAnswer, runSimulation, runDebugSteps, runStreamLogs, setView]);
    // the clocks on screen, read for backed-up belts; nothing while they may still change
    const beltAssumption = generatedFor?.beltQuestion ?? null;
    const beltHint = useMemo(
        () => busy || beltAssumption === null ? null : backedUpBeltsHint(alternatives, recommendedIndex, beltAssumption.answer),
        [busy, beltAssumption, alternatives, recommendedIndex]
    );

    // the actions that throw part of the build away offer Undo, just before they are applied
    const undoable = useMemo(() => {
        // a delete offers Undo, which brings the deleted row's delete button back for focus to go to
        const removal = (kind: EntityKind, remove: (index: number) => void) => (index: number) => {
            offerUndo((form) => removalMessage(form, kind, index), { restoredLabel: (form) => removedDeleteLabel(form, kind, index) });
            remove(index);
        };
        const reorder = (kind: EntityKind, run: (from: number, to: number) => void) => (from: number, to: number) => {
            if (from === to) return;
            offerUndo(form => reorderMessage(form, kind, from, to));
            run(from, to);
        };
        return {
            reorderMachines: reorder('machines', reorderMachines),
            reorderInserters: reorder('inserters', reorderInserters),
            reorderBelts: reorder('belts', reorderBelts),
            reorderChests: reorder('chests', reorderChests),
            reorderDrills: reorder('drills', reorderDrills),
            removeMachine: removal('machines', removeMachine),
            removeInserter: removal('inserters', removeInserter),
            removeBelt: removal('belts', removeBelt),
            removeChest: removal('chests', removeChest),
            removeDrill: removal('drills', removeDrill),
            switchChestType: (index: number, type: ChestType, disposal = false) => { offerUndo((form) => describeChestSwitch(form, index, type)); switchChestType(index, type, disposal); },
            enableChestRemoval: (index: number) => {
                offerUndo(form => `Enabled output removal for ${entityLabel('chest', form.chests[index].id)}.`);
                updateChest(index, { remove_unfiltered_items: true });
            },
        };
    }, [offerUndo, removeMachine, removeInserter, removeBelt, removeChest, removeDrill, switchChestType, updateChest, reorderMachines, reorderInserters, reorderBelts, reorderChests, reorderDrills]);
    const duplicate = useMemo(() => ({
        machines: (index: number) => duplicateEntity('machines', index),
        inserters: (index: number) => duplicateEntity('inserters', index),
        belts: (index: number) => duplicateEntity('belts', index),
        chests: (index: number) => duplicateEntity('chests', index),
        drills: (index: number) => duplicateEntity('drills', index),
    }), [duplicateEntity]);
    const updateInsertersUndoable = useCallback((uuids: string[], updates: Partial<InserterFormData>, message: string) => {
        offerUndo(message);
        updateInserters(uuids, updates);
    }, [offerUndo, updateInserters]);
    // the key of the build an action with Undo is about to replace as a whole (Import, Paste, Reset, an example, Delete
    // build, a share link, another tab's version): its clocks are set aside under it, and its Undo brings them back
    const replacedKeyRef = useRef<string | null>(null);
    const offerUndoOfBuild = useCallback((message: string, options?: Parameters<typeof offerUndo>[1], sourceKey?: string) => {
        replacedKeyRef.current = sourceKey ?? configKeyRef.current;
        return offerUndo(message, options);
    }, [offerUndo]);
    const offerUndoOfReplace = useCallback((message: string) => offerUndoOfBuild(message), [offerUndoOfBuild]);

    const drillConfigs = useMemo(() => config.drills?.configs ?? [], [config.drills]);
    const openDiagramFullscreen = useCallback(() => setDiagramFullscreen(true), []);

    // Shared by the inline and fullscreen diagrams
    const flowDiagramProps = {
        selection: buildContext.entity,
        onSelectionChange: (selection: Parameters<typeof selectBuildEntity>[1]) => patchContext({ entity: selectBuildEntity(config, selection), entityConfigKey: contextFormKey }),
        detailedMode: buildContext.diagramDetailed,
        onDetailedModeChange: (diagramDetailed: boolean) => patchContext({ diagramDetailed }),
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

    // Import, a Paste that replaced something, and Reset land on Configure, where the build's problems are shown. The
    // clocks are set aside for the Undo offered just before, if any
    const clearForBuildChange = useCallback(() => {
        cancelRestore();
        retireConversion();
        replacementRevisionRef.current++;
        const formKey = replacedKeyRef.current ?? undefined;
        replacedKeyRef.current = null;
        clearResults({ formKey });
        setReplacedCount((count) => count + 1);
    }, [cancelRestore, clearResults, retireConversion]);
    const handleBuildReplaced = useCallback(() => {
        resetForReplacement();
        clearForBuildChange();
    }, [resetForReplacement, clearForBuildChange]);

    // A conversion capability belongs to the complete current input, including generation-only settings.
    const checkRecovery = validation.status === 'invalid' && checkStatus === 'invalid' && !validation.crashed
        && validation.recovery?.sourceConfigKey === configKey ? validation.recovery : undefined;
    const generationRecovery = errorRecovery?.sourceConfigKey === configKey ? errorRecovery : undefined;
    const conversionRecovery = checkRecovery ?? generationRecovery;
    const conversionIsNextStep = view === 'configure' && !busy && conversionRecovery?.conversion.kind === 'available'
        && !(validation.status === 'invalid' && validation.crashed === true);
    const handleConvertRepeatedUnit = useCallback(async () => {
        if (!isInitialized || busy || conversionPendingRef.current || conversionRecovery?.conversion.kind !== 'available'
            || document.querySelector('[data-edits-build]')) return;
        const snapshot = captureBuildMutation();
        const capturedConfig = formDataToConfig(snapshot.form), oldKey = configKeyOf(capturedConfig);
        if (oldKey !== conversionRecovery.sourceConfigKey) return;
        const token = ++conversionTokenRef.current;
        conversionPendingRef.current = true;
        setConversionPending(true);
        try {
            const checked = await askEngine({ kind: 'repeated-unit-conversion', config: capturedConfig });
            if (!mountedRef.current || token !== conversionTokenRef.current) return;
            const current = captureBuildMutation();
            if (current.buildId !== snapshot.buildId || current.revision !== snapshot.revision || current.form !== snapshot.form
                || document.querySelector('[data-edits-build]')) return;
            if (checked.kind === 'unavailable') {
                notify({ severity: 'warning', text: checked.stage === 'check'
                    ? `One complete unit was identified, but its check failed: ${checked.reason.message} Your build has not changed.`
                    : `${checked.reason.message} Your build has not changed. Select one complete unit in Factorio and paste it again. Keep Items per Second as the total rate.` });
                return;
            }
            if (checked.plan.sourceConfigKey !== oldKey) throw new Error('The conversion answer does not match this build.');
            const next = applyRepeatedUnitConversion(snapshot.form, checked.plan);
            if (!next) throw new Error('The conversion answer could not be applied completely.');
            let complete: ((suffix?: string) => void) | undefined;
            const committed = commitBuildReplacement(snapshot, next, () => {
                complete = offerUndoOfBuild(`Using one complete modeled unit with ${checked.plan.copies} copies. Items per Second is still the total.`,
                    { deferAnnouncement: true, snapshot: snapshot.form }, oldKey);
            });
            if (!committed) return;
            handleBuildReplaced();
            const committedToken = conversionTokenRef.current;
            conversionRecheckRef.current = { token: committedToken, owner: captureBuildMutation(), key: configKeyOf(formDataToConfig(next)), complete };
        } catch (failure) {
            const current = captureBuildMutation();
            if (mountedRef.current && token === conversionTokenRef.current && current.buildId === snapshot.buildId
                && current.revision === snapshot.revision && current.form === snapshot.form) {
                notify({ severity: 'error', text: `Could not check the conversion: ${failure instanceof Error ? failure.message : 'The engine did not answer.'} Your build has not changed. Try again, or select one complete unit in Factorio and paste it again. Keep Items per Second as the total rate.` });
            }
        } finally {
            if (mountedRef.current && token === conversionTokenRef.current) {
                conversionPendingRef.current = false;
                setConversionPending(false);
            }
        }
    }, [isInitialized, busy, conversionRecovery, captureBuildMutation, commitBuildReplacement, offerUndoOfBuild, handleBuildReplaced, notify]);
    // the same for a switch to another build, which says `message` once it is known whether its clocks come back
    const handleBuildSwitched = useCallback((message: string | ((restored: boolean) => void)) => {
        switchMessageRef.current = message;
        clearForBuildChange();
    }, [clearForBuildChange]);

    // ---- Your builds
    const titles = useMemo(() => buildTitles(library.builds, recipeLabel), [library.builds, recipeLabel]);
    /** The title a build has, or would have with `extra` in the list (one just made or renamed) */
    const titleOf = useCallback((id: string, extra?: BuildMeta) => {
        if (!extra) return titles.get(id) ?? UNTITLED_BUILD;
        const rows = [...library.builds.filter((build) => build.id !== extra.id), extra];
        return buildTitles(rows, recipeLabel).get(id) ?? UNTITLED_BUILD;
    }, [titles, library.builds, recipeLabel]);
    const currentTitle = titleOf(library.currentId);
    const switcherBuilds = useMemo(() => [...library.builds]
        .sort((a, b) => b.openedAt - a.openedAt)
        .map((build) => ({
            id: build.id,
            title: titles.get(build.id) ?? UNTITLED_BUILD,
            secondary: build.name !== null && build.recipe !== '' ? recipeTitle(build.recipe, recipeLabel) : null,
        })), [library.builds, titles, recipeLabel]);
    const switcherRef = useRef<HTMLButtonElement>(null);
    const focusSwitcher = useCallback(() => switcherRef.current?.focus(), []);

    // opening another build ends any Undo offer (the form is replaced, as by an edit), and its clocks go
    const handleOpenBuild = useCallback(async (id: string) => {
        retireConversion();
        saveDeparture();
        cancelRestore();
        if (await library.openBuild(id)) {
            withdrawUndo();
            handleBuildSwitched(openedBuildAnnouncement(titleOf(id)));
        }
    }, [retireConversion, saveDeparture, cancelRestore, library, withdrawUndo, handleBuildSwitched, titleOf]);
    const handleNewBuild = useCallback(() => {
        saveDeparture();
        const added = library.newBuild();
        forgetBuild(added.id);
        withdrawUndo();
        handleBuildSwitched(NEW_BUILD_ANNOUNCEMENT);
        // blank: the intro card shows again, unless it was closed
        afterReset();
    }, [saveDeparture, forgetBuild, library, withdrawUndo, handleBuildSwitched, afterReset]);
    const handleDuplicateBuild = useCallback(() => {
        saveDeparture();
        const copy = library.duplicateBuild();
        forgetBuild(copy.id);
        withdrawUndo();
        handleBuildSwitched(duplicatedAnnouncement(titleOf(copy.id, copy)));
    }, [saveDeparture, forgetBuild, library, withdrawUndo, handleBuildSwitched, titleOf]);
    // a new dialog for each opening, so its field starts from the name
    const [renaming, setRenaming] = useState({ key: 0, open: false });
    const handleRenameBuild = useCallback(() => setRenaming((state) => ({ key: state.key + 1, open: true })), []);
    const closeRename = useCallback(() => setRenaming((state) => ({ ...state, open: false })), []);
    // the field starts from the name shown; left as the recipe's name, the build stays named after its recipe
    const automaticName = library.currentMeta.recipe === '' ? UNTITLED_BUILD : recipeTitle(library.currentMeta.recipe, recipeLabel);
    const handleRenameSave = useCallback((text: string) => {
        const typed = cleanName(text);
        const name = typed === automaticName ? null : typed;
        const id = library.currentId;
        library.renameBuild(name);
        closeRename();
        const renamed = renameBuild({ version: 1, builds: [library.currentMeta] }, id, name).builds[0];
        announce(renamedAnnouncement(titleOf(id, renamed)));
    }, [library, automaticName, closeRename, announce, titleOf]);
    // Delete offers Undo, which brings the build back and opens it
    const handleDeleteBuild = useCallback(async () => {
        retireConversion();
        saveDeparture();
        cancelRestore();
        const deleted = library.currentMeta;
        // Only offer Undo and clear this build's results if the checked deletion is still current.
        let deleting: ReturnType<typeof library.deleteBuild> | null = null;
        deleting = library.deleteBuild(() => {
            offerUndoOfBuild(deletedBuildMessage(currentTitle), {
                revert: (form) => {
                    void deleting?.then(result => {
                        if (result) library.restore({ meta: deleted, form, removeId: result.madeId ?? undefined });
                    });
                },
            });
            forgetBuild(deleted.id);
            clearForBuildChange();
        });
        await deleting;
    }, [retireConversion, saveDeparture, cancelRestore, forgetBuild, library, currentTitle, offerUndoOfBuild, clearForBuildChange]);

    // another tab saved this build: one warning per episode, whose action loads that tab's version (with Undo)
    const conflictStatus = library.conflict.status;
    const { loadOtherTabVersion, closeConflict } = library;
    const conflictMessageRef = useRef<number | null>(null);
    useEffect(() => {
        if (conflictStatus === 'raised' && conflictMessageRef.current === null) {
            conflictMessageRef.current = notify({
                severity: 'warning',
                durationMs: null,
                text: CHANGED_ELSEWHERE_MESSAGE,
                action: {
                    label: LOAD_OTHER_TAB_LABEL,
                    onClick: () => {
                        loadOtherTabVersion(() => offerUndoOfBuild(LOADED_OTHER_TAB_MESSAGE)).then((loaded) => {
                            if (loaded) {
                                handleBuildReplaced();
                                // the message and its button are gone: focus goes to the switcher
                                focusSwitcher();
                            }
                        });
                    },
                },
                onClose: closeConflict,
            });
        } else if (conflictStatus === 'none' && conflictMessageRef.current !== null) {
            // ended here (an edit, another build): the warning goes, as its action would now throw that away
            dismiss(conflictMessageRef.current);
            conflictMessageRef.current = null;
        }
    }, [conflictStatus, notify, dismiss, loadOtherTabVersion, closeConflict, offerUndoOfBuild, handleBuildReplaced, focusSwitcher]);

    // a share link: asked first, then added as a new build (or in the place of an empty one), with Undo
    const shared = useSharedBuildLink(isInitialized);
    // kept while the dialog closes, so its text does not go blank
    const [sharedShown, setSharedShown] = useState<SharedBuild | null>(null);
    if (shared.pending !== null && shared.pending !== sharedShown) {
        setSharedShown(shared.pending);
    }
    const sharedReplacesBlank = blankBuild && library.currentMeta.name === null;
    const sharedTitle = (build: SharedBuild) => build.name
        ?? (build.config.target_output.recipe === '' ? UNTITLED_BUILD : recipeTitle(build.config.target_output.recipe, recipeLabel));
    const handleOpenShared = useCallback(() => {
        const build = shared.accept();
        if (!build) return;
        saveDeparture();
        const previous = library.currentMeta;
        const replaceId = sharedReplacesBlank ? previous.id : undefined;
        const title = build.name
            ?? (build.config.target_output.recipe === '' ? UNTITLED_BUILD : recipeTitle(build.config.target_output.recipe, recipeLabel));
        // the build the link added, which its Undo takes out again (none when it took the empty build's place)
        const added: { id?: string } = {};
        const complete = offerUndoOfBuild(sharedOpenedMessage(title), {
            deferAnnouncement: true,
            revert: (form) => library.restore({ meta: previous, form, removeId: replaceId === undefined ? added.id : undefined }),
        });
        added.id = library.addBuild(configToFormData(build.config), build.name, { replaceId }).id;
        forgetBuild(added.id);
        handleBuildSwitched((back) => complete?.(back ? ANNOUNCEMENTS.itsClocksBack : undefined));
    }, [saveDeparture, forgetBuild, shared, library, sharedReplacesBlank, recipeLabel, offerUndoOfBuild, handleBuildSwitched]);

    // Generate with the slower searches, checked first as Generate is: for this run only, or, kept on, by turning the
    // switch on in the form (one the check does not read, so it stays current)
    const handleSearchDeeper = useCallback((keepOn: boolean) => runChecked((config) => {
        if (keepOn) {
            // the form's key once the switch is on, so the results are not taken for out of date
            const kept = withDeeperSearch(config);
            updateOverrides('search_for_fewer_wake_ups', true);
            runSimulation(kept, runDebugSteps, runStreamLogs);
        } else {
            runSimulation(config, runDebugSteps, runStreamLogs, true);
        }
        setView('results');
    }), [runChecked, updateOverrides, runSimulation, runDebugSteps, runStreamLogs, setView]);

    return (
        <BuildSectionsContext value={sectionContext}>
        <PageProviders gameNames={gameNames} searchOnlyRecipes={searchOnlyRecipes} ruleTiming={ruleTiming}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', pb: { xs: 'calc(72px + env(safe-area-inset-bottom))', sm: 'calc(48px + env(safe-area-inset-bottom))' } }}>
                <AppBar position="sticky" ref={headerRef}>
                    {isInitialized && (
                        <ConfigImportExport
                            currentForm={config}
                            ref={buildEntryRef}
                            config={exportableConfig}
                            target={config.target_output}
                            onImport={handleImportConfig}
                            onApplyPaste={setConfig}
                            onReset={handleReset}
                            onBuildReplaced={handleBuildReplaced}
                            onUndoable={offerUndoOfReplace}
                            onShowIntro={showIntro}
                            pasteIsNextStep={blankBuild && !introVisible}
                            buildName={library.currentMeta.name}
                            buildTitle={currentTitle}
                            toolsMenuItems={toolsMenuItems}
                            onInstall={blueprintString ? () => setInstallOpen(true) : undefined}
                            onCheckOnly={handleCheckOnly}
                            checkDisabled={busy}
                            renderControls={(paste, menu) => (
                                <WorkflowBar
                                    entryAction={paste}
                                    menu={menu}
                                    identity={
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', minWidth: 0 }}>
                                            <Typography variant="subtitle1" component="h1" sx={{ minWidth: 0, fontWeight: 600 }}>
                                                Clock Generator
                                            </Typography>
                                            <BuildSwitcher
                                                ref={switcherRef}
                                                builds={switcherBuilds}
                                                currentId={library.currentId}
                                                currentTitle={currentTitle}
                                                onOpen={handleOpenBuild}
                                                onNew={handleNewBuild}
                                                onDuplicate={handleDuplicateBuild}
                                                onRename={handleRenameBuild}
                                                onDelete={handleDeleteBuild}
                                                readOnly={!library.writable}
                                            />
                                        </Box>
                                    }
                                    view={view}
                                    onViewChange={setView}
                                    isLoading={isRunning}
                                    generationFailed={error !== null}
                                    progressStore={progressStore}
                                    onGenerate={handleGenerate}
                                    onCheckOnly={handleCheckOnly}
                                    primaryAction={conversionIsNextStep ? null : primaryAction}
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
                                    onCopy={() => { cancelRestore(); copy.request(); }}
                                    problems={problems}
                                    note={note}
                                    startHere={blankBuild && problems.length > 0}
                                    onGoToProblem={handleGoToProblem}
                                    running={isRunning || checkingFor !== null || conversionPending}
                                    onCancel={handleCancel}
                                    lastStop={lastStop}
                                    restoredId={restoredId}
                                    pickGone={pickGone?.label ?? null}
                                />
                            )}
                        />
                    )}
                    {!isInitialized && <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography component="h1" variant="subtitle1">Clock Generator</Typography>
                    </Box>}
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
                        <Box data-build-view="configure" data-build-anchor="configure" sx={{ display: view === 'configure' ? 'block' : 'none' }}>
                            {loadNotice && (
                                <Alert severity="warning" sx={{ mb: 2 }} onClose={dismissLoadNotice}>
                                    {loadNotice}
                                </Alert>
                            )}
                            {error && !generationRecovery && (
                                <Alert severity="error" sx={{ mb: 2 }}>
                                    {error}
                                </Alert>
                            )}
                            <CheckErrorAlert message={validation.status === 'invalid' && checkStatus === 'invalid' && validation.crashed ? validation.message : null} crashed />

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

                            <BuildPanel view={configView} onViewChange={setConfigView}>
                                <PickupGeometrySummary build={config} onEdit={reviewPickup} busy={busy} />
                                <BuildValidationPanel issues={validationIssues} machines={config.machines} belts={config.belts} chests={config.chests} inserters={config.inserters}
                                    onApplyFix={handleInserterFix} fixUnavailable={fixUnavailable} onSwitchType={undoable.switchChestType} onEnableRemoval={undoable.enableChestRemoval}
                                    onReview={goToTarget} recovery={conversionRecovery} conversionPending={conversionPending} onConvert={handleConvertRepeatedUnit} />
                                {/* in the order a row's sources are made in: an inserter's machines, belts and chests are above it */}
                                {configView === 'list' ? (
                                    <>
                                        <MachinesForm
                                            engineConfig={engineConfig}
                                            machines={config.machines}
                                            recipeNames={recipeNames}
                                            onAdd={addMachine}
                                            onUpdate={updateMachine}
                                            onRemove={undoable.removeMachine}
                                            onReorder={undoable.reorderMachines}
                                            onDuplicate={duplicate.machines}
                                        />

                                        <PanelSection level={3} title="Belts and chests">
                                            <BeltsForm
                                                geometryBeltIds={config.belts.filter(belt => hasImportedBeltDrops(config.inserters, belt.id)).map(belt => belt.id)}
                                                belts={config.belts}
                                                itemNames={itemNamesComposite}
                                                onAdd={addBelt}
                                                onUpdate={updateBelt}
                                                onRemove={undoable.removeBelt}
                                                onReorder={undoable.reorderBelts}
                                                onDuplicate={duplicate.belts}
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
                                                onReorder={undoable.reorderChests}
                                                onDuplicate={duplicate.chests}
                                            />
                                        </PanelSection>

                                        <InsertersForm
                                            key={library.currentId}
                                            focusRequest={inserterFocusRequest}
                                            onFocusHandled={finishInserterFocus}
                                            inserters={config.inserters}
                                            machines={config.machines}
                                            belts={config.belts}
                                            chests={config.chests}
                                            itemNames={itemNamesComposite}
                                            getRecipeInfo={getRecipeInfo}
                                            onAdd={addInserter}
                                            onUpdate={updateInserter}
                                            onRemove={undoable.removeInserter}
                                            onReorder={undoable.reorderInserters}
                                            onDuplicate={duplicate.inserters}
                                            onBulkUpdate={updateInsertersUndoable}
                                        />
                                    </>
                                ) : (
                                    <Box sx={{ mb: 3 }}>
                                        <ConfigFlowDiagram
                                            key={`${library.currentId}:${replacedCount}`}
                                            {...flowDiagramProps}
                                            onRequestFullscreen={openDiagramFullscreen}
                                        />
                                        {/* the Belts section is not drawn here, so the belt question gets one of its own */}
                                        {beltQuestion.ask && (
                                            <PanelSection level={3} title={BELT_COPY.diagramHeading} sx={{ mt: 2 }} data-belt-question-diagram="">
                                                <BeltAssumption answer={beltQuestion.answer} onChange={handleBeltAnswer} />
                                            </PanelSection>
                                        )}
                                    </Box>
                                )}

                                {/* outside the toggle: the diagram does not show the drills' settings */}
                                <DrillsForm
                                    miningProductivityLevel={config.drills?.mining_productivity_level ?? 0}
                                    drills={drillConfigs}
                                    resourceNames={resourceNames}
                                    machineIds={machineIds}
                                    onUpdateProductivityLevel={updateMiningProductivityLevel}
                                    onAdd={addDrill}
                                    onUpdate={updateDrill}
                                    onRemove={undoable.removeDrill}
                                    onReorder={undoable.reorderDrills}
                                    onDuplicate={duplicate.drills}
                                />
                            </BuildPanel>


                            <Box data-build-anchor="advanced" sx={{ mb: 2 }}>
                                <OverridesForm
                                    importedChecks={config.overrides}
                                    lcm={config.overrides?.lcm}
                                    terminalSwingCount={config.overrides?.terminal_swing_count}
                                    useFractionalSwings={config.overrides?.use_fractional_swings}
                                    searchForFewerWakeUps={config.overrides?.search_for_fewer_wake_ups}
                                    onUpdate={updateOverrides}
                                    expanded={advancedOpen}
                                    onExpandedChange={setAdvancedOpen}
                                    setCount={advancedSetCount(config.overrides)}
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

                        <Box data-build-view="results" data-build-anchor="results" sx={{ display: view === 'results' ? 'block' : 'none' }}>
                            <ResultsWorkspace key={library.currentId}
                                onEditPickup={reviewPickup}
                                installOpen={installOpen}
                                onInstallClose={() => setInstallOpen(false)}
                                onInstall={() => setInstallOpen(true)}
                                copyLabel={copyLabel}
                                comparison={buildContext.comparison}
                                onComparisonChange={comparison => patchContext({ comparison })}
                                wakeAsTable={buildContext.wakeAsTable}
                                onWakeAsTableChange={wakeAsTable => patchContext({ wakeAsTable })}
                                timeline={buildContext.timeline}
                                onTimelineChange={timeline => patchContext({ timeline })}
                                detail={resultDetail}
                                onDetailChange={setResultDetail}
                                generatedFor={generatedFor}
                                generationAssumptions={generationAssumptions}
                                isRunning={isRunning}
                                error={error}
                                alternatives={alternatives}
                                selectedIndex={selectedAlternativeIndex}
                                onSelect={handleSelectClock}
                                recommendedIndex={recommendedIndex}
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
                                developerTools={developerTools}
                                logs={logs}
                                debugSteps={debugSteps}
                                onDebugStepsChange={setDebugSteps}
                                streamLogs={streamLogs}
                                onStreamLogsChange={setStreamLogs}
                                onClearLogs={clearLogs}
                                staleFor={staleFor}
                                changes={staleChanges}
                                onGenerate={handleGenerate}
                                canGenerate={!busy}
                                stoppedEarly={stoppedEarly}
                                pickGone={pickGone}
                                copied={copy.copied}
                                onCopy={() => { cancelRestore(); copy.request(); }}
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
                        position: 'fixed',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        zIndex: theme => theme.zIndex.appBar,
                        minHeight: { xs: 72, sm: 48 },
                        py: 0.5,
                        pb: 'calc(4px + env(safe-area-inset-bottom))',
                        px: 2,
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 1.5,
                        rowGap: 0.5,
                        bgcolor: 'background.paper',
                        borderTop: 1,
                        borderColor: 'divider',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                            Created by <Link href="https://www.youtube.com/@abucnasty" target="_blank" rel="noopener noreferrer"
                                color="inherit" underline="hover">abucnasty</Link>
                        </Typography>
                        <Button size="small" color="inherit" onClick={() => setChangelogOpen(true)} title="View changelog"
                            sx={{ textTransform: 'none', minWidth: 0 }}>v{__APP_VERSION__}</Button>
                    </Box>
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
            <RenameBuildDialog
                key={renaming.key}
                open={renaming.open}
                initialName={library.currentMeta.name ?? automaticName}
                onSave={handleRenameSave}
                onClose={closeRename}
                onExited={focusSwitcher}
            />
            <OpenSharedBuildDialog
                open={shared.pending !== null}
                title={sharedShown ? sharedTitle(sharedShown) : ''}
                summary={sharedShown ? sharedBuildSummary(sharedShown.config, recipeLabel, { withRecipe: sharedShown.name !== null }) : ''}
                placeNote={sharedPlaceNote(sharedReplacesBlank, currentTitle)}
                onOpen={handleOpenShared}
                onCancel={shared.cancel}
                onExited={focusSwitcher}
            />
            <TermsPopover anchorEl={termsAnchor} onClose={() => setTermsAnchor(null)} />

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
                    <Box sx={{ px: 2, pt: 1, flexShrink: 0 }}>
                        <BuildValidationPanel issues={validationIssues} machines={config.machines} belts={config.belts} chests={config.chests} inserters={config.inserters}
                            onApplyFix={handleInserterFix} fixUnavailable={fixUnavailable} onSwitchType={undoable.switchChestType} onEnableRemoval={undoable.enableChestRemoval}
                            onReview={target => { setDiagramFullscreen(false); goToTarget(target); }} recovery={conversionRecovery} conversionPending={conversionPending} onConvert={handleConvertRepeatedUnit} focusTargets={false} />
                    </Box>
                    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <ConfigFlowDiagram
                            {...flowDiagramProps}
                            height="100%"
                        />
                    </Box>
                </Box>
            </Dialog>

            {staleFor && (
                <StaleCopyDialog
                    open={copy.confirmingStale}
                    generatedFor={staleFor}
                    changes={staleChanges}
                    onCancel={copy.cancel}
                    onConfirm={copy.confirm}
                />
            )}

            {manualCopy && <ManualBlueprintDialog failure={manualCopy} onClose={() => setManualCopy(null)} />}

            <MessageHost />
        </PageProviders>
        </BuildSectionsContext>
    );
}

export default App;
