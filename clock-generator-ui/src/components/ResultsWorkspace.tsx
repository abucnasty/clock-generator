import { ExpandMore } from '@mui/icons-material';
import { Alert, Box, Button, Collapse, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Config } from 'clock-generator/browser';
import type { ResultDetail } from '../utils/resultsView';
import type { BuildViewContext, TimelineViewContext } from '../utils/buildViewContext';
import { useBuildSection } from '../hooks/useBuildViewContext';
import { SelectedClockContext } from './SelectedClockContext';
import { InserterAssumptions } from './InserterAssumptions';
import { PickupGeometrySummary } from './PickupGeometrySummary';
import type {
    LogMessage,
    DebugSteps,
    SerializableClockWindows,
    SerializableStateTransitionHistory,
    SerializableTransferHistory,
    SwingBackoffReport,
} from 'clock-generator/browser';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import type { FuelViewData, GenerationAssumptions, ShiftOptionsView } from '../worker/types';
import { startCheckSummary } from '../utils/modelAssumptions';
import { ClockAlternativesPanel } from './ClockAlternativesPanel';
import { DeeperSearchNotice } from './DeeperSearchNotice';
import { DetailsPanel } from './DetailsPanel';
import { InstallClockDialog } from './InstallClockDialog';
import { DeveloperToolsPanel } from './DeveloperToolsPanel';
import { ResultSummaryCard } from './ResultSummaryCard';
import { StaleResultsBanner } from './StaleResultsBanner';
import { RunNotes } from './RunNotes';
import { beltValue, clockTechnicalName, wakeUpsText } from '../utils/clockSummary';
import { rateWarningOf } from '../utils/rateWarning';
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
    comparison: BuildViewContext['comparison'];
    onComparisonChange(comparison: BuildViewContext['comparison']): void;
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
    stateTransitionHistory: SerializableStateTransitionHistory | null;
    /** The selected clock driven only by its exported windows; null when the histories above already are that run */
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
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
    /**
     * What the clocks assume of the input belts, with the action for the other answer (2.4's BeltAssumptionLine), shown in
     * the card in place of its own belt line
     */
    beltAction?: ReactNode;
}

/**
 * Everything a generation produced, the answer first: the selected clock with its install steps, its wake windows,
 * the other clocks to compare it with, and the details of the selected clock. Developer tools, when they are on, last.
 */
export function ResultsWorkspace(props: ResultsWorkspaceProps) {
    const [comparisonOpen, setComparisonOpen] = useBuildSection('comparison-open');
    const comparisonId = useId();
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
    useLayoutEffect(() => {
        const anchor = selectionAnchor.current;
        selectionAnchor.current = null;
        if (!anchor || anchor.clock === selected || !workspaceRef.current) return;
        const delta = workspaceRef.current.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
    }, [selected]);
    const selectableClocks = props.alternatives.map((clock, index) => ({ clock, index }))
        .filter(({ clock, index }) => clock.verdict === 'stable' || index === props.selectedIndex);
    const clockLabel = (clock: ClockAlternativeView) => [
        `${clock.terminalSwingCount} ${clock.terminalSwingCount === 1 ? 'swing' : 'swings'}`,
        wakeUpsText(clock).value.replace(' a minute', ' wake-ups/min'),
        clock.beltLabel ? beltValue(props.pickRule, clock.beltLabel) : '',
    ].filter(Boolean).join(' · ');
    const rateWarning = rateWarningOf(selected);
    const noticeKind = deeperSearchNoticeOf({
        searchesSkipped: props.skippedSearches.length > 0,
        searchedDeeper: props.searchedDeeper,
        keptOn: props.keptOn,
        isRunning: props.isRunning,
        stale: props.staleFor !== null,
    });

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

            <ResultSummaryCard
                generationAssumptions={props.generationAssumptions}
                alternatives={props.alternatives}
                selectedIndex={props.selectedIndex}
                recommendedIndex={props.recommendedIndex}
                onSelectRecommended={selectRecommended}
                pickRule={props.pickRule}
                isGenerating={props.isRunning}
                stoppedEarly={props.stoppedEarly}
                rateWarning={rateWarning}
                stale={props.staleFor !== null}
                beltAction={props.beltAction}
                comparisonAction={<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {props.blueprintString && <Button size="small" color="inherit" onClick={props.onInstall}>Install guide</Button>}
                    <Button size="small" color="inherit" aria-expanded={comparisonOpen} aria-controls={comparisonId}
                    onClick={() => setComparisonOpen(!comparisonOpen)}
                    endIcon={<ExpandMore sx={{ transform: comparisonOpen ? 'rotate(180deg)' : 'none' }} />}>
                    Compare clocks
                </Button></Box>}
                runAssumptions={selected && <Box data-result-assumptions sx={{ overflowWrap: 'anywhere' }}>
                    <Typography variant="body2">
                        These results assume {saved ? `${saved.target_output.copies} ${saved.target_output.copies === 1 ? 'copy' : 'copies'}; ${saved.overrides?.non_moving_belts ? 'backed-up' : 'moving'} input belts in the saved run` : 'a saved build whose metadata is unavailable'}.
                        {selected.assumptions?.loopSeeds.length ? ` ${selected.assumptions.loopSeeds.length} modeled loop seed(s).` : ''}
                        {selected.assumptions?.outputDrops.some(drop => drop.mode === 'shared-lanes') ? ' Supplied output-drop positions model shared-lane spacing.' : ''}
                        {selected.assumptions?.outputDrops.some(drop => drop.mode === 'free-lane') ? ' Output belts without supplied shared-lane positions use free-lane drop timing.' : ''}
                        {selected.assumptions?.machineFuel.length ? ' Imported machine fuel is in Why.' : ''}
                    </Typography>
                    {saved?.inserters && <InserterAssumptions inserters={saved.inserters} />}
                    {saved && <PickupGeometrySummary build={saved} onEdit={props.staleFor ? undefined : props.onEditPickup} busy={props.isRunning} />}
                </Box>}
            />

            <Box data-results-columns sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.5, '& > *': { minWidth: 0 } }}>
                <Collapse id={comparisonId} in={comparisonOpen || !selected} mountOnEnter timeout={150}>
                    <ClockAlternativesPanel
                        comparison={props.comparison}
                        onComparisonChange={props.onComparisonChange}
                        alternatives={props.alternatives}
                        selectedIndex={props.selectedIndex}
                        onSelect={selectClock}
                        recommendedIndex={props.recommendedIndex}
                        pickRule={props.pickRule}
                        isGenerating={props.isRunning}
                        pending={props.pending}
                        notice={
                            <DeeperSearchNotice
                                kind={noticeKind}
                                recommendedLabel={props.recommendedIndex === null ? null : props.alternatives[props.recommendedIndex]?.label ?? null}
                                canSearchDeeper={props.canSearchDeeper}
                                blockedBy={props.searchDeeperBlockedBy}
                                onSearchDeeper={props.onSearchDeeper}
                            />
                        }
                        holdNotice={noticeKind === 'searching'}
                    />
                </Collapse>

                {selected && <Box ref={workspaceRef}>
                    <SelectedClockContext selected={selected} detail={props.detail} onDetailChange={props.onDetailChange}
                        generation={props.generationAssumptions}
                        clockSelector={selectableClocks.length > 1 && <TextField select
                            label={selected.verdict !== 'stable' ? 'Clock · Not stable' : props.selectedIndex === props.recommendedIndex ? 'Clock · Recommended' : 'Clock'} size="small"
                            value={props.selectedIndex} onChange={event => selectClock(Number(event.target.value))}
                            slotProps={{ select: { renderValue: value => clockLabel(props.alternatives[Number(value)]) } }}
                            sx={{ width: { xs: 280, sm: 380 }, maxWidth: '100%' }}>
                            {selectableClocks.map(({ clock, index }) => <MenuItem key={clock.id} value={index}
                                sx={{ display: 'block', whiteSpace: 'normal', maxWidth: { xs: 320, sm: 520 } }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {clockLabel(clock)}{index === props.recommendedIndex ? ' · Recommended' : clock.verdict !== 'stable' ? ' · Not stable' : ''}
                                </Typography>
                                <Typography variant="caption" component="p" color="text.secondary">
                                    {clockTechnicalName(clock)}{!clock.ranking.matches_belt_choice ? ' · Requires a different belt setting' : ''}
                                </Typography>
                            </MenuItem>)}
                        </TextField>}
                        timelineProps={{
                            config: saved,
                            timeline: props.timeline, onTimelineChange: props.onTimelineChange,
                            wakeAsTable: props.wakeAsTable, onWakeAsTableChange: props.onWakeAsTableChange,
                            transferHistory: props.transferHistory, stateTransitionHistory: props.stateTransitionHistory,
                            clockOnlyTransferHistory: props.clockOnlyTransferHistory, clockOnlyStateTransitionHistory: props.clockOnlyStateTransitionHistory,
                            clockWindows: props.clockWindows,
                        }}
                        assumptions={saved?.inserters ? <InserterAssumptions inserters={saved.inserters} detailed /> : <Typography variant="body2">Saved inserter metadata unavailable.</Typography>}>
                        <DetailsPanel
                            insights={selected.insights}
                            shiftOptions={props.shiftOptions}
                            swingBackoffReport={props.swingBackoffReport}
                            fuelView={props.fuelView}
                        />
                    </SelectedClockContext>
                </Box>}
            </Box>

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
