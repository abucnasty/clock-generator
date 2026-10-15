import { Alert, Box, Paper, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
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
import { BlueprintOutput } from './BlueprintOutput';
import { ClockAlternativesPanel } from './ClockAlternativesPanel';
import { DebugPanel } from './DebugPanel';
import { DeeperSearchNotice } from './DeeperSearchNotice';
import { FuelPanel } from './FuelPanel';
import { InsightsPanel } from './InsightsPanel';
import { ShiftRangePanel } from './ShiftRangePanel';
import { StaleResultsBanner } from './StaleResultsBanner';
import { StateTransitionTimeline } from './StateTransitionTimeline';
import { SwingBackoffReportDisplay } from './SwingBackoffReportDisplay';
import { TransferHistoryVisualization } from './TransferHistoryVisualization';
import { rateWarningOf } from '../utils/rateWarning';
import type { GeneratedFor } from '../utils/resultsStaleness';
import type { PickRule } from '../utils/recommendedClock';
import { deeperSearchNoticeOf } from '../utils/deeperSearch';
import type { Problem } from '../utils/firstProblem';

type ResultsTab = 'insights' | 'timelines' | 'fuel' | 'blueprint' | 'log';

interface ResultsWorkspaceProps {
    isRunning: boolean;
    error: string | null;
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** The clock the selection rule picks; null while there are none */
    recommendedIndex: number | null;
    onSelectRecommended: () => void;
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
    logs: LogMessage[];
    debugSteps: DebugSteps;
    onDebugStepsChange: (steps: DebugSteps) => void;
    streamLogs: boolean;
    onStreamLogsChange: (stream: boolean) => void;
    onClearLogs: () => void;
    /** What the clocks were made for, while the build has changed since. Null when not */
    staleFor: GeneratedFor | null;
}

const tabId = (tab: ResultsTab) => `results-tab-${tab}`;
const panelId = (tab: ResultsTab) => `results-panel-${tab}`;
/** What a tab says about the panel it opens, and the panel about its tab */
const tabProps = (tab: ResultsTab) => ({ id: tabId(tab), 'aria-controls': panelId(tab) });

function TabBody({ tab, shown, children }: { tab: ResultsTab; shown: boolean; children: ReactNode }) {
    // kept mounted so a tab keeps its filters and scroll position while another is shown
    return (
        <Box
            role="tabpanel"
            id={panelId(tab)}
            aria-labelledby={tabId(tab)}
            hidden={!shown}
            sx={{ display: shown ? 'block' : 'none', pt: 2 }}
        >
            {children}
        </Box>
    );
}

/**
 * Everything a generation produced: the clocks to pick from, and one tabbed area of detail for the
 * selected clock, so the page stays one screen long.
 */
export function ResultsWorkspace(props: ResultsWorkspaceProps) {
    const [tab, setTab] = useState<ResultsTab>('timelines');
    const [timelineRun, setTimelineRun] = useState<'clock' | 'plan'>('clock');

    const hasClockOnlyRun = props.clockOnlyTransferHistory !== null && props.clockOnlyStateTransitionHistory !== null;
    const fuelView = props.fuelView;
    // the fuel tab is only there for a build with fuel inserters
    const shownTab: ResultsTab = tab === 'fuel' && fuelView === null ? 'timelines' : tab;
    const showClockOnlyRun = hasClockOnlyRun && timelineRun === 'clock';
    const transferHistory = showClockOnlyRun ? props.clockOnlyTransferHistory : props.transferHistory;
    const stateTransitionHistory = showClockOnlyRun ? props.clockOnlyStateTransitionHistory : props.stateTransitionHistory;
    const hasResults = props.alternatives.length > 0 || props.pending.length > 0;
    const noticeKind = deeperSearchNoticeOf({
        searchesSkipped: props.skippedSearches.length > 0,
        searchedDeeper: props.searchedDeeper,
        keptOn: props.keptOn,
        isRunning: props.isRunning,
        stale: props.staleFor !== null,
    });

    return (
        <Box>
            {props.staleFor !== null && hasResults && <StaleResultsBanner generatedFor={props.staleFor} />}

            {props.error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {props.error}
                </Alert>
            )}

            {!hasResults && !props.isRunning && !props.error && (
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body1" color="text.secondary">
                        Nothing generated yet. Press Generate to create clocks for your build.
                    </Typography>
                </Paper>
            )}

            <ClockAlternativesPanel
                alternatives={props.alternatives}
                selectedIndex={props.selectedIndex}
                onSelect={props.onSelect}
                recommendedIndex={props.recommendedIndex}
                onSelectRecommended={props.onSelectRecommended}
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

            <Box sx={{ display: hasResults ? 'block' : 'none', mt: 2 }}>
                <Tabs
                    value={shownTab}
                    onChange={(_, value: ResultsTab) => setTab(value)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                >
                    <Tab value="timelines" label="Timelines" {...tabProps('timelines')} />
                    {fuelView !== null && <Tab value="fuel" label="Fuel" {...tabProps('fuel')} />}
                    <Tab value="insights" label="Insights" {...tabProps('insights')} />
                    <Tab value="blueprint" label="Blueprint" {...tabProps('blueprint')} />
                    <Tab value="log" label="Log" {...tabProps('log')} />
                </Tabs>

                <TabBody tab="insights" shown={shownTab === 'insights'}>
                    <SwingBackoffReportDisplay report={props.swingBackoffReport} />
                    <InsightsPanel
                        insights={props.alternatives[props.selectedIndex]?.insights ?? []}
                        clockLabel={props.alternatives[props.selectedIndex]?.label ?? null}
                    >
                        {props.shiftOptions && <ShiftRangePanel options={props.shiftOptions} />}
                    </InsightsPanel>
                </TabBody>

                <TabBody tab="timelines" shown={shownTab === 'timelines'}>
                    {hasClockOnlyRun && (
                        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <ToggleButtonGroup
                                value={timelineRun}
                                exclusive
                                onChange={(_, value) => { if (value) setTimelineRun(value); }}
                                size="small"
                                aria-label="Simulation shown in the timelines"
                            >
                                <ToggleButton value="clock">Exported clock</ToggleButton>
                                <ToggleButton value="plan">Plan</ToggleButton>
                            </ToggleButtonGroup>
                            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
                                {timelineRun === 'clock'
                                    ? 'The timelines show the build driven only by the wake windows in the blueprint. '
                                        + 'This is the run the Status and Output per clock period columns are judged on.'
                                    : 'The timelines show the planning simulation the wake windows were taken from. '
                                        + 'Inserters also wait on their machine\'s inventory there, so swings can land differently than with the clock alone.'}
                            </Typography>
                        </Paper>
                    )}
                    {transferHistory && (
                        <Box sx={{ mt: 2 }}>
                            <TransferHistoryVisualization transferHistory={transferHistory} />
                        </Box>
                    )}
                    {stateTransitionHistory && (
                        <Box sx={{ mt: 2 }}>
                            <StateTransitionTimeline
                                stateTransitionHistory={stateTransitionHistory}
                                clockWindows={props.clockWindows ?? undefined}
                            />
                        </Box>
                    )}
                </TabBody>

                {fuelView !== null && (
                    <TabBody tab="fuel" shown={shownTab === 'fuel'}>
                        <FuelPanel fuel={fuelView} />
                    </TabBody>
                )}

                <TabBody tab="blueprint" shown={shownTab === 'blueprint'}>
                    <BlueprintOutput
                        rateWarning={rateWarningOf(props.alternatives[props.selectedIndex])}
                        blueprintString={props.blueprintString}
                        simulationDurationTicks={props.simulationDurationTicks ?? undefined}
                        staleFor={props.staleFor}
                    />
                </TabBody>
            </Box>

            {/* reachable before anything is generated: it holds the debug options a generation runs with */}
            <Box
                // the Log tab's panel; with no results there are no tabs, and the options are plain content
                role={hasResults ? 'tabpanel' : undefined}
                id={panelId('log')}
                aria-labelledby={hasResults ? tabId('log') : undefined}
                hidden={hasResults && shownTab !== 'log'}
                sx={{ display: !hasResults || shownTab === 'log' ? 'block' : 'none', pt: 2 }}
            >
                <DebugPanel
                    logs={props.logs}
                    debugSteps={props.debugSteps}
                    onDebugStepsChange={props.onDebugStepsChange}
                    streamLogs={props.streamLogs}
                    onStreamLogsChange={props.onStreamLogsChange}
                    onClearLogs={props.onClearLogs}
                />
            </Box>
        </Box>
    );
}
