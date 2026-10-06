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
import type { FuelConsumptionViewData, ShiftOptionsView } from '../worker/types';
import { BlueprintOutput } from './BlueprintOutput';
import { ClockAlternativesPanel } from './ClockAlternativesPanel';
import { DebugPanel } from './DebugPanel';
import { InsightsPanel } from './InsightsPanel';
import { ShiftRangePanel } from './ShiftRangePanel';
import { StateTransitionTimeline } from './StateTransitionTimeline';
import { SwingBackoffReportDisplay } from './SwingBackoffReportDisplay';
import { TransferHistoryVisualization } from './TransferHistoryVisualization';

type ResultsTab = 'insights' | 'timelines' | 'blueprint' | 'log';

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
    /** The exported clock run over several periods to show fuel consumption; null when no machine burns fuel */
    fuelConsumptionView: FuelConsumptionViewData | null;
    clockWindows: SerializableClockWindows | null;
    shiftOptions: ShiftOptionsView | null;
    swingBackoffReport: SwingBackoffReport | null;
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
    const [timelineRun, setTimelineRun] = useState<'clock' | 'plan' | 'fuel'>('clock');

    const hasClockOnlyRun = props.clockOnlyTransferHistory !== null && props.clockOnlyStateTransitionHistory !== null;
    const fuelView = props.fuelConsumptionView;
    const showFuelView = fuelView !== null && timelineRun === 'fuel';
    const showClockOnlyRun = hasClockOnlyRun && timelineRun === 'clock';
    const transferHistory = showFuelView ? fuelView.transferHistory
        : showClockOnlyRun ? props.clockOnlyTransferHistory : props.transferHistory;
    const stateTransitionHistory = showFuelView ? fuelView.stateTransitionHistory
        : showClockOnlyRun ? props.clockOnlyStateTransitionHistory : props.stateTransitionHistory;
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
                    {(hasClockOnlyRun || fuelView !== null) && (
                        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <ToggleButtonGroup
                                value={timelineRun}
                                exclusive
                                onChange={(_, value) => { if (value) setTimelineRun(value); }}
                                size="small"
                                aria-label="Simulation shown in the timelines"
                            >
                                {hasClockOnlyRun && <ToggleButton value="clock">Exported clock</ToggleButton>}
                                {hasClockOnlyRun && <ToggleButton value="plan">Plan</ToggleButton>}
                                {fuelView !== null && <ToggleButton value="fuel">Fuel consumption</ToggleButton>}
                            </ToggleButtonGroup>
                            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
                                {timelineRun === 'fuel' && fuelView !== null
                                    ? `The timelines show the exported clock run for ${fuelView.periods} periods (${fuelView.durationTicks} ticks). `
                                        + 'A hand of fuel lasts a machine longer than one clock period and the fuel slot only takes more once it is nearly empty, '
                                        + 'so a fuel inserter swings once in a few periods. The clock itself is still one period; '
                                        + 'this view is longer only to show the fuel being consumed.'
                                        + (fuelView.fuelSwingsRecorded ? '' : ' No fuel inserter swung even over this run.')
                                    : timelineRun === 'clock'
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
                                clockWindows={showFuelView ? undefined : props.clockWindows ?? undefined}
                            />
                        </Box>
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
