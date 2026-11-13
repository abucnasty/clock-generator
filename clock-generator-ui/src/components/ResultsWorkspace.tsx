import { Alert, Box, Button, Paper, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Config, NotMadeClock } from 'clock-generator/browser';
import type { ResultDetail } from '../utils/resultsView';
import type { TimelineViewContext } from '../utils/buildViewContext';
import { SelectedClockContext } from './SelectedClockContext';
import { InserterAssumptions } from './InserterAssumptions';
import { PickupGeometrySummary } from './PickupGeometrySummary';
import { pickupGeometryOf } from '../utils/pickupGeometry';
import type {
    LogMessage,
    DebugSteps,
    SerializableClockWindows,
    PortableStateTransitionHistory,
    SerializableTransferHistory,
    SwingBackoffReport,
} from 'clock-generator/browser';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import type { FuelViewData, GenerationAssumptions, ShiftOptionsView } from '../worker/types';
import { startCheckSummary } from '../utils/modelAssumptions';
import { CompareClocksDialog } from './ClockAlternativesPanel';
import { ClockList } from './ClockList';
import { ClockDiagnostics } from './ClockDiagnostics';
import { Panel } from './Panel';
import { DeeperSearchNotice } from './DeeperSearchNotice';
import { DetailsPanel } from './DetailsPanel';
import { InstallClockDialog } from './InstallClockDialog';
import { DeveloperToolsPanel } from './DeveloperToolsPanel';
import { ResultSummaryCard } from './ResultSummaryCard';
import { StaleResultsBanner } from './StaleResultsBanner';
import { RunNotes } from './RunNotes';
import { cardWarningOf } from '../utils/rateWarning';
import { whyNotStableOf } from '../utils/whyNotStable';
import { madeForLead } from '../utils/checkedLanes';
import { DIAGNOSTICS_COPY, notesOf } from '../utils/diagnostics';
import { tabIds } from '../utils/tabIds';
import type { GeneratedFor } from '../utils/resultsStaleness';
import type { PickRule } from '../utils/recommendedClock';
import { deeperSearchNoticeOf } from '../utils/deeperSearch';
import type { Problem } from '../utils/firstProblem';

interface ResultsWorkspaceProps {
    onEditPickup?: (id: number) => void;
    installOpen: boolean;
    onInstallClose: () => void;
    onInstall: () => void;
    copyLabel: string;
    wakeAsTable: boolean;
    onWakeAsTableChange(asTable: boolean): void;
    timeline: TimelineViewContext;
    onTimelineChange(timeline: TimelineViewContext): void;
    detail: ResultDetail;
    onDetailChange: (detail: ResultDetail) => void;
    generatedFor: GeneratedFor | null;
    generationAssumptions: GenerationAssumptions | null;
    isRunning: boolean;
    error: string | null;
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** The clock the selection rule picks; null while there are none */
    recommendedIndex: number | null;
    /** The card's Back to recommended: selects it, with the focus moving to the card's name, which reads it out */
    onCardBackToRecommended: () => void;
    /** What the selection rule was given by the latest generation's config; null before one */
    pickRule: PickRule | null;
    pending: string[];
    skippedSearches: string[];
    /** The alternatives the latest generation could not make, with the generator's reasons */
    notMade: NotMadeClock[];
    /** The latest generation ran the slower searches because it asked for them */
    searchedDeeper: boolean;
    /** "Search for fewer wake-ups" is on in the form */
    keptOn: boolean;
    /** False whenever Generate would be disabled */
    canSearchDeeper: boolean;
    /** Why Search deeper is off, as Generate says it; null when it is on or a run is going */
    searchDeeperBlockedBy: Problem | null;
    /** Generates again with the slower searches; `keepOn` also turns the switch on in the form */
    onSearchDeeper: (keepOn: boolean) => void;
    blueprintString: string | null;
    simulationDurationTicks: number | null;
    transferHistory: SerializableTransferHistory | null;
    stateTransitionHistory: PortableStateTransitionHistory | null;
    /** Fuel use and the exported fuel clocks of the selected clock; null when no inserter only fills a fuel slot */
    fuelView: FuelViewData | null;
    clockWindows: SerializableClockWindows | null;
    shiftOptions: ShiftOptionsView | null;
    swingBackoffReport: SwingBackoffReport | null;
    /** ⋮ > Developer tools, or `?debug`: logging controls at the end of the page. */
    developerTools: boolean;
    logs: LogMessage[];
    debugSteps: DebugSteps;
    onDebugStepsChange: (steps: DebugSteps) => void;
    streamLogs: boolean;
    onStreamLogsChange: (stream: boolean) => void;
    onClearLogs: () => void;
    /** What the clocks were made for, while the build has changed since. Null when not */
    staleFor: GeneratedFor | null;
    /** What changed since the clocks were made, for the stale banner */
    changes: string[];
    /** Generate, from the stale banner */
    onGenerate: () => void;
    /** False whenever Generate would be disabled */
    canGenerate: boolean;
    /** The clocks shown are of a run the player stopped */
    stoppedEarly: boolean;
    /** The clock the player picked, which the last run did not make */
    pickGone: { label: string } | null;
    /** Every Copy button says "Copied" for a moment after any of them copied */
    copied: boolean;
    /** The copy every Copy button shares */
    onCopy: () => void;
}

/**
 * Everything a generation produced: the clocks as a list on the left, which stays in view while the page scrolls, and the
 * selected clock on the right, its card over its workspace; on a wide page (from 1536 px) Diagnostics is a third column
 * beside them and no tab. On a phone the list stands above the card. The compare table of every clock opens over the
 * page from the list. Developer tools, when they are on, last.
 */
export function ResultsWorkspace(props: ResultsWorkspaceProps) {
    const theme = useTheme();
    const twoColumns = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
    const wide = useMediaQuery(theme.breakpoints.up('xl'), { noSsr: true });
    const [compareOpen, setCompareOpen] = useState(false);
    const saved = useMemo(() => {
        try {
            return props.generatedFor ? JSON.parse(props.generatedFor.key) as Config : null;
        } catch {
            return null;
        }
    }, [props.generatedFor]);
    const hasResults = props.alternatives.length > 0 || props.pending.length > 0;
    const selected = props.alternatives[props.selectedIndex];
    const workspaceRef = useRef<HTMLDivElement>(null);
    const selectionAnchor = useRef<{ clock: ClockAlternativeView; top: number } | null>(null);
    const captureWorkspacePosition = (next: ClockAlternativeView | undefined) => {
        // Keep the workspace at the same viewport offset when summary/comparison text changes above it.
        selectionAnchor.current = selected?.verdict === 'stable' && next?.verdict === 'stable' && workspaceRef.current && !workspaceRef.current.querySelector('[aria-modal="true"]')
            ? { clock: selected, top: workspaceRef.current.getBoundingClientRect().top }
            : null;
    };
    const selectClock = (index: number) => {
        const next = props.alternatives[index];
        if (!next || next === selected) return;
        captureWorkspacePosition(next);
        props.onSelect(index);
    };
    const selectRecommended = () => {
        captureWorkspacePosition(props.recommendedIndex === null ? undefined : props.alternatives[props.recommendedIndex]);
        props.onCardBackToRecommended();
    };
    // the card's "See diagnostics": the Diagnostics tab of the clock, the workspace brought into view, the focus on the tab's panel
    const [diagnosticsAsked, setDiagnosticsAsked] = useState(0);
    const diagnosticsFocusPending = useRef(false);
    const showDiagnostics = () => {
        props.onDetailChange('diagnostics');
        diagnosticsFocusPending.current = true;
        setDiagnosticsAsked(asked => asked + 1);
    };
    // once the tab is shown, wherever the page keeps which tab is shown
    useEffect(() => {
        if (!diagnosticsFocusPending.current || props.detail !== 'diagnostics') return;
        diagnosticsFocusPending.current = false;
        workspaceRef.current?.scrollIntoView?.({ block: 'start' });
        document.getElementById(tabIds('result-context', 'diagnostics').panel)?.focus({ preventScroll: true });
    }, [diagnosticsAsked, props.detail]);
    const selectClockById = (id: string) => {
        const index = props.alternatives.findIndex(clock => clock.id === id);
        if (index >= 0) selectClock(index);
    };
    useLayoutEffect(() => {
        const anchor = selectionAnchor.current;
        selectionAnchor.current = null;
        if (!anchor || anchor.clock === selected || !workspaceRef.current) return;
        const delta = workspaceRef.current.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
    }, [selected]);
    const rateWarning = cardWarningOf(selected);
    // what a saved run assumed, in the card's Simulation results: a line, and the belt pickups where the build has some
    const runLead = selected ? [
        madeForLead(saved, selected),
        selected.assumptions?.kickStarts.length ? `${selected.assumptions.kickStarts.length} modeled kick start(s).` : '',
        selected.assumptions?.outputDrops.some(drop => drop.mode === 'shared-lanes') ? 'The drop positions you gave are used to space the output drops on the belt.' : '',
        selected.assumptions?.machineFuel.length ? 'Imported machine fuel is in Why.' : '',
    ].filter(Boolean).join(' ') : '';
    const pickupsShown = saved !== null && saved !== undefined && pickupGeometryOf(saved).total > 0;
    // said of the whole run once it is done: while clocks still arrive, a stable one may yet come
    const whyNotStable = props.isRunning ? null
        : whyNotStableOf(props.alternatives, props.recommendedIndex, props.notMade);
    const noticeKind = deeperSearchNoticeOf({
        searchesSkipped: props.skippedSearches.length > 0,
        searchedDeeper: props.searchedDeeper,
        keptOn: props.keptOn,
        isRunning: props.isRunning,
        stale: props.staleFor !== null,
    });

    // the list shows while there are clocks, or a run that keeps the notice of Search deeper (and its focus) on the page
    const listShown = hasResults || noticeKind === 'searching';
    const diagnosticsBeside = wide && selected !== undefined;
    const columns = !listShown || !twoColumns ? 'minmax(0, 1fr)'
        : diagnosticsBeside ? '360px minmax(0, 1fr) minmax(0, 0.8fr)' : '360px minmax(0, 1fr)';

    return (
        <Box>
            {props.staleFor !== null && hasResults && (
                <StaleResultsBanner generatedFor={props.staleFor} changes={props.changes} onGenerate={props.onGenerate} canGenerate={props.canGenerate} />
            )}

            {props.error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {props.error}
                </Alert>
            )}

            {!props.isRunning && hasResults && <RunNotes stoppedEarly={props.stoppedEarly} pickGone={props.pickGone} />}
            {!hasResults && props.generationAssumptions && <Typography variant="body2" data-start-assumption>{startCheckSummary([], props.generationAssumptions)}</Typography>}

            {!hasResults && !props.isRunning && !props.error && (
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body1" color="text.secondary">
                        {props.generationAssumptions ? 'This run made no clocks. Check the build or generate again.' : 'Nothing generated yet. Press Generate to make clocks for your build.'}
                    </Typography>
                </Paper>
            )}

            <Box data-results-columns sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 2, rowGap: 1.5, alignItems: 'start', '& > *': { minWidth: 0 } }}>
                {listShown && <Box data-clock-list-column="" sx={twoColumns ? {
                    // in view while the selected clock scrolls; its own scroll where it is taller than the page
                    position: 'sticky', top: 'calc(var(--app-header-height, 0px) + 8px)',
                    maxHeight: 'calc(100vh - var(--app-header-height, 0px) - 16px)', overflowY: 'auto',
                } : undefined}>
                    <ClockList
                        alternatives={props.alternatives}
                        selectedIndex={props.selectedIndex}
                        onSelect={selectClock}
                        onCompare={() => setCompareOpen(true)}
                        pending={props.pending}
                        running={props.isRunning}
                        notice={
                            <DeeperSearchNotice
                                kind={noticeKind}
                                recommendedLabel={props.recommendedIndex === null ? null : props.alternatives[props.recommendedIndex]?.label ?? null}
                                canSearchDeeper={props.canSearchDeeper}
                                blockedBy={props.searchDeeperBlockedBy}
                                onSearchDeeper={props.onSearchDeeper}
                            />
                        }
                    />
                </Box>}

                <Box sx={{ display: 'grid', rowGap: 1.5, alignContent: 'start', '& > *': { minWidth: 0 } }}>
                    <ResultSummaryCard
                        alternatives={props.alternatives}
                        selectedIndex={props.selectedIndex}
                        recommendedIndex={props.recommendedIndex}
                        onSelectRecommended={selectRecommended}
                        // beside the card, Diagnostics needs no link
                        onShowDiagnostics={diagnosticsBeside ? undefined : showDiagnostics}
                        isGenerating={props.isRunning}
                        stoppedEarly={props.stoppedEarly}
                        rateWarning={rateWarning}
                        whyNotStable={whyNotStable}
                        stale={props.staleFor !== null}
                        actions={props.blueprintString && <Button size="small" color="inherit" onClick={props.onInstall}>Install guide</Button>}
                        runAssumptions={selected && (runLead !== '' || pickupsShown) ? <Box data-result-assumptions sx={{ overflowWrap: 'anywhere' }}>
                            {runLead !== '' && <Typography variant="body2">{runLead}</Typography>}
                            {saved && <PickupGeometrySummary build={saved} savedRun backedUp={selected.belt ? selected.belt.kind === 'backed_up' : selected.beltLabel === 'backed-up'} onEdit={props.staleFor ? undefined : props.onEditPickup} busy={props.isRunning} />}
                        </Box> : null}
                    />

                    {/* brought into view below the sticky header */}
                    {selected && <Box ref={workspaceRef} sx={{ scrollMarginTop: 'calc(var(--app-header-height, 0px) + 8px)' }}>
                        <SelectedClockContext selected={selected} detail={props.detail} onDetailChange={props.onDetailChange} onSelectClock={selectClockById}
                            generation={props.generationAssumptions}
                            swingBackoffReport={props.swingBackoffReport}
                            diagnosticsBeside={diagnosticsBeside}
                            timelineProps={{
                                config: saved,
                                timeline: props.timeline, onTimelineChange: props.onTimelineChange,
                                wakeAsTable: props.wakeAsTable, onWakeAsTableChange: props.onWakeAsTableChange,
                                transferHistory: props.transferHistory, stateTransitionHistory: props.stateTransitionHistory,
                                clockWindows: props.clockWindows,
                            }}
                            assumptions={saved?.inserters ? <InserterAssumptions inserters={saved.inserters} detailed /> : <Typography variant="body2">Saved inserter metadata unavailable.</Typography>}>
                            <DetailsPanel
                                insights={notesOf(selected).overview}
                                nothing={notesOf(selected).diagnostics ? DIAGNOSTICS_COPY.overviewNothing : undefined}
                                shiftOptions={props.shiftOptions}
                                swingBackoffReport={props.swingBackoffReport}
                                fuelView={props.fuelView}
                                inserters={saved?.inserters}
                            />
                        </SelectedClockContext>
                    </Box>}
                </Box>

                {diagnosticsBeside && selected && (
                    <Panel title={DIAGNOSTICS_COPY.tab} sx={{ mb: 0 }} data-diagnostics-column="">
                        <ClockDiagnostics key={selected.id} clock={selected} onSelectClock={selectClockById} />
                    </Panel>
                )}
            </Box>

            <CompareClocksDialog
                open={compareOpen && props.alternatives.length > 0}
                onClose={() => setCompareOpen(false)}
                alternatives={props.alternatives}
                selectedIndex={props.selectedIndex}
                onSelect={selectClock}
                pickRule={props.pickRule}
                pending={props.pending}
                running={props.isRunning}
            />

            {selected && <InstallClockDialog open={props.installOpen} onClose={props.onInstallClose}
                selected={selected} blueprintString={props.blueprintString} staleFor={props.staleFor}
                copyLabel={props.copyLabel} copied={props.copied} onCopy={props.onCopy} />}

            {/* Debug logging remains opt-in; timelines are available in the normal workspace. */}
            {props.developerTools && (
                <DeveloperToolsPanel
                    logs={props.logs}
                    debugSteps={props.debugSteps}
                    onDebugStepsChange={props.onDebugStepsChange}
                    streamLogs={props.streamLogs}
                    onStreamLogsChange={props.onStreamLogsChange}
                    onClearLogs={props.onClearLogs}
                />
            )}
        </Box>
    );
}
