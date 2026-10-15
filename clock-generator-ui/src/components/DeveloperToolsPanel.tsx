import { Box, Paper, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState } from 'react';
import type {
    DebugSteps,
    LogMessage,
    SerializableClockWindows,
    SerializableStateTransitionHistory,
    SerializableTransferHistory,
} from 'clock-generator/browser';
import { TABLIST_NAMES } from '../utils/a11yLabels';
import { DebugPanel } from './DebugPanel';
import { Panel } from './Panel';
import { StateTransitionTimeline } from './StateTransitionTimeline';
import { TabBody } from './TabBody';
import { tabProps } from '../utils/tabIds';
import { TransferHistoryVisualization } from './TransferHistoryVisualization';

type DeveloperTab = 'timelines' | 'log';

const DEVELOPER_COPY = {
    heading: 'Developer tools',
    timelines: 'Timelines',
    log: 'Log',
    nothingYet: 'Nothing generated yet: the timelines come with the clocks.',
    clockRun: 'The timelines show the build driven only by the wake windows in the blueprint. This is the run the Status '
        + 'and Output per clock period columns are judged on.',
    planRun: 'The timelines show the planning simulation the wake windows were taken from. Inserters also wait on their '
        + 'machine\'s inventory there, so swings can land differently than with the clock alone.',
};

/** The tabs' ids start with this */
const PREFIX = 'developer';

interface DeveloperToolsPanelProps {
    /** A generation has clocks, or some on the way */
    hasResults: boolean;
    transferHistory: SerializableTransferHistory | null;
    stateTransitionHistory: SerializableStateTransitionHistory | null;
    /** The selected clock driven only by its exported windows; null when the histories above already are that run */
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
    clockWindows: SerializableClockWindows | null;
    logs: LogMessage[];
    debugSteps: DebugSteps;
    onDebugStepsChange: (steps: DebugSteps) => void;
    streamLogs: boolean;
    onStreamLogsChange: (stream: boolean) => void;
    onClearLogs: () => void;
}

/**
 * For whoever works on the generator, behind ⋮ > Developer tools or `?debug`: the tick-level timelines of the selected
 * clock (the exported clock's run, or the plan's) and the generator's log with its debug switches. Not mounted while
 * the tools are off, so its canvases cost nothing then.
 */
export function DeveloperToolsPanel(props: DeveloperToolsPanelProps) {
    const [tab, setTab] = useState<DeveloperTab>('timelines');
    const [timelineRun, setTimelineRun] = useState<'clock' | 'plan'>('clock');

    // before anything is generated there is only the log, which holds the switches a generation runs with
    const shownTab: DeveloperTab = props.hasResults ? tab : 'log';
    const hasClockOnlyRun = props.clockOnlyTransferHistory !== null && props.clockOnlyStateTransitionHistory !== null;
    const showClockOnlyRun = hasClockOnlyRun && timelineRun === 'clock';
    const transferHistory = showClockOnlyRun ? props.clockOnlyTransferHistory : props.transferHistory;
    const stateTransitionHistory = showClockOnlyRun ? props.clockOnlyStateTransitionHistory : props.stateTransitionHistory;

    return (
        <Panel title={DEVELOPER_COPY.heading} sx={{ mt: 2, mb: 0 }} data-developer-tools="">
            <Tabs
                value={shownTab}
                onChange={(_, value: DeveloperTab) => setTab(value)}
                // the arrow keys show the tab they move to
                selectionFollowsFocus
                aria-label={TABLIST_NAMES.developerTools}
                sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
                <Tab value="timelines" label={DEVELOPER_COPY.timelines} disabled={!props.hasResults} {...tabProps(PREFIX, 'timelines')} />
                <Tab value="log" label={DEVELOPER_COPY.log} {...tabProps(PREFIX, 'log')} />
            </Tabs>

            <TabBody prefix={PREFIX} tab="timelines" shown={shownTab === 'timelines'}>
                {!props.hasResults && (
                    <Typography variant="body2" color="text.secondary">{DEVELOPER_COPY.nothingYet}</Typography>
                )}
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
                            {timelineRun === 'clock' ? DEVELOPER_COPY.clockRun : DEVELOPER_COPY.planRun}
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

            <TabBody prefix={PREFIX} tab="log" shown={shownTab === 'log'}>
                <DebugPanel
                    logs={props.logs}
                    debugSteps={props.debugSteps}
                    onDebugStepsChange={props.onDebugStepsChange}
                    streamLogs={props.streamLogs}
                    onStreamLogsChange={props.onStreamLogsChange}
                    onClearLogs={props.onClearLogs}
                />
            </TabBody>
        </Panel>
    );
}
