import { Alert, Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type {
    LogMessage,
    DebugSteps,
    SerializableClockWindows,
    SerializableStateTransitionHistory,
    SerializableTransferHistory,
    SwingBackoffReport,
} from 'clock-generator/browser';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import type { FuelViewData, ShiftOptionsView } from '../worker/types';
import { ClockAlternativesPanel } from './ClockAlternativesPanel';
import { DeeperSearchNotice } from './DeeperSearchNotice';
import { DetailsPanel } from './DetailsPanel';
import { DeveloperToolsPanel } from './DeveloperToolsPanel';
import { ResultSummaryCard } from './ResultSummaryCard';
import { StaleResultsBanner } from './StaleResultsBanner';
import { RunNotes } from './RunNotes';
import { WakeWindowsView } from './WakeWindowsView';
import { rateWarningOf } from '../utils/rateWarning';
import type { GeneratedFor } from '../utils/resultsStaleness';
import type { PickRule } from '../utils/recommendedClock';
import { deeperSearchNoticeOf } from '../utils/deeperSearch';
import type { Problem } from '../utils/firstProblem';

interface ResultsWorkspaceProps {
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
    /** ⋮ > Developer tools, or `?debug`: the timelines and the log, at the end of the page */
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
    /** What the Copy buttons say: "Copy blueprint", "… below target", or "Copy old clock…" */
    copyLabel: string;
    /** The card's Copy is the page's one filled button (the bar's is then outlined) */
    copyIsNextStep: boolean;
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
    const hasResults = props.alternatives.length > 0 || props.pending.length > 0;
    const selected = props.alternatives[props.selectedIndex];
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

            {!hasResults && !props.isRunning && !props.error && (
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body1" color="text.secondary">
                        Nothing generated yet. Press Generate to make clocks for your build.
                    </Typography>
                </Paper>
            )}

            <ResultSummaryCard
                alternatives={props.alternatives}
                selectedIndex={props.selectedIndex}
                recommendedIndex={props.recommendedIndex}
                onSelectRecommended={props.onCardBackToRecommended}
                pickRule={props.pickRule}
                isGenerating={props.isRunning}
                stoppedEarly={props.stoppedEarly}
                copied={props.copied}
                onCopy={props.onCopy}
                copyLabel={props.copyLabel}
                copyIsNextStep={props.copyIsNextStep}
                rateWarning={rateWarning}
                stale={props.staleFor !== null}
                beltAction={props.beltAction}
            />

            {/* 2.6's slot: the Wake windows section, between the card and the clocks to compare */}
            {selected && <WakeWindowsView alternative={selected} headingLevel="h2" />}

            <ClockAlternativesPanel
                alternatives={props.alternatives}
                selectedIndex={props.selectedIndex}
                onSelect={props.onSelect}
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

            {selected && (
                <DetailsPanel
                    insights={selected.insights}
                    shiftOptions={props.shiftOptions}
                    swingBackoffReport={props.swingBackoffReport}
                    fuelView={props.fuelView}
                    blueprintString={props.blueprintString}
                    simulationDurationTicks={props.simulationDurationTicks}
                    rateWarning={rateWarning}
                    staleFor={props.staleFor}
                    copied={props.copied}
                    onCopy={props.onCopy}
                />
            )}

            {/* not mounted while off: no timelines, no log and no debug switches on the page */}
            {props.developerTools && (
                <DeveloperToolsPanel
                    hasResults={hasResults}
                    transferHistory={props.transferHistory}
                    stateTransitionHistory={props.stateTransitionHistory}
                    clockOnlyTransferHistory={props.clockOnlyTransferHistory}
                    clockOnlyStateTransitionHistory={props.clockOnlyStateTransitionHistory}
                    clockWindows={props.clockWindows}
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
