import { Alert, Box, Paper, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import type {
    LogMessage,
    DebugSteps,
    SerializableClockWindows,
    SerializableStateTransitionHistory,
    SerializableTransferHistory,
    SerializableTransferPlan,
    SwingBackoffReport,
} from 'clock-generator/browser';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import type { ShiftOptionsView } from '../worker/types';
import { BlueprintOutput } from './BlueprintOutput';
import { ClockAlternativesPanel } from './ClockAlternativesPanel';
import { DebugPanel } from './DebugPanel';
import { InsightsPanel } from './InsightsPanel';
import { ShiftRangePanel } from './ShiftRangePanel';
import { StateTransitionTimeline } from './StateTransitionTimeline';
import { SwingBackoffReportDisplay } from './SwingBackoffReportDisplay';
import { TransferHistoryVisualization } from './TransferHistoryVisualization';
import { TransferPlanPanel } from './TransferPlanPanel';

type ResultsTab = 'insights' | 'timelines' | 'transfer-plan' | 'blueprint' | 'log';

interface ResultsWorkspaceProps {
    isRunning: boolean;
    error: string | null;
    alternatives: ClockAlternativeView[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    pending: string[];
    blueprintString: string | null;
    simulationDurationTicks: number | null;
    transferHistory: SerializableTransferHistory | null;
    stateTransitionHistory: SerializableStateTransitionHistory | null;
    /** The selected clock driven only by its exported windows; null when the histories above already are that run */
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
    clockWindows: SerializableClockWindows | null;
    shiftOptions: ShiftOptionsView | null;
    swingBackoffReport: SwingBackoffReport | null;
    transferPlan: SerializableTransferPlan | null;
    usedLcm: number | null;
    excludedIngredients: string[];
    onExcludeChange: (items: string[]) => void;
    logs: LogMessage[];
    debugSteps: DebugSteps;
    onDebugStepsChange: (steps: DebugSteps) => void;
    streamLogs: boolean;
    onStreamLogsChange: (stream: boolean) => void;
    onClearLogs: () => void;
}

function TabBody({ shown, children }: { shown: boolean; children: ReactNode }) {
    // kept mounted so a tab keeps its filters and scroll position while another is shown
    return <Box sx={{ display: shown ? 'block' : 'none', pt: 2 }}>{children}</Box>;
}

/**
 * Everything a generation produced: the potential clocks to pick from, and one tabbed area of detail for the
 * selected clock, so the page stays one screen long.
 */
export function ResultsWorkspace(props: ResultsWorkspaceProps) {
    const [tab, setTab] = useState<ResultsTab>('timelines');
    const [timelineRun, setTimelineRun] = useState<'clock' | 'plan'>('clock');

    const hasClockOnlyRun = props.clockOnlyTransferHistory !== null && props.clockOnlyStateTransitionHistory !== null;
    const showClockOnlyRun = hasClockOnlyRun && timelineRun === 'clock';
    const transferHistory = showClockOnlyRun ? props.clockOnlyTransferHistory : props.transferHistory;
    const stateTransitionHistory = showClockOnlyRun ? props.clockOnlyStateTransitionHistory : props.stateTransitionHistory;
    const hasResults = props.alternatives.length > 0 || props.pending.length > 0;

    return (
        <Box>
            {props.error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {props.error}
                </Alert>
            )}

            {!hasResults && !props.isRunning && !props.error && (
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body1" color="text.secondary">
                        Nothing generated yet. Press Generate to create clocks for your configuration.
                    </Typography>
                </Paper>
            )}

            <ClockAlternativesPanel
                alternatives={props.alternatives}
                selectedIndex={props.selectedIndex}
                onSelect={props.onSelect}
                pending={props.pending}
            />

            <Box sx={{ display: hasResults ? 'block' : 'none', mt: 2 }}>
                <Tabs
                    value={tab}
                    onChange={(_, value: ResultsTab) => setTab(value)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                >
                    <Tab value="timelines" label="Timelines" />
                    <Tab value="insights" label="Insights" />
                    <Tab value="transfer-plan" label="Transfer plan" />
                    <Tab value="blueprint" label="Blueprint" />
                    <Tab value="log" label="Log" />
                </Tabs>

                <TabBody shown={tab === 'insights'}>
                    <SwingBackoffReportDisplay report={props.swingBackoffReport} />
                    <InsightsPanel
                        insights={props.alternatives[props.selectedIndex]?.insights ?? []}
                        clockLabel={props.alternatives[props.selectedIndex]?.label ?? null}
                    >
                        {props.shiftOptions && <ShiftRangePanel options={props.shiftOptions} />}
                    </InsightsPanel>
                </TabBody>

                <TabBody shown={tab === 'timelines'}>
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
                                    ? 'The timelines show the build driven only by the clock windows in the blueprint. '
                                        + 'This is the run the Status and Clock-only output columns are judged on.'
                                    : 'The timelines show the planning simulation the clock windows were taken from. '
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

                <TabBody shown={tab === 'transfer-plan'}>
                    {props.transferPlan && (
                        <TransferPlanPanel
                            transferPlan={props.transferPlan}
                            usedLcm={props.usedLcm!}
                            excludedIngredients={props.excludedIngredients}
                            onExcludeChange={props.onExcludeChange}
                        />
                    )}
                </TabBody>

                <TabBody shown={tab === 'blueprint'}>
                    <BlueprintOutput
                        blueprintString={props.blueprintString}
                        simulationDurationTicks={props.simulationDurationTicks ?? undefined}
                    />
                </TabBody>
            </Box>

            {/* reachable before anything is generated: it holds the debug options a generation runs with */}
            <Box sx={{ display: !hasResults || tab === 'log' ? 'block' : 'none', pt: 2 }}>
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
