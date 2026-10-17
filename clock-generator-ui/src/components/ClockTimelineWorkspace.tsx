import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { lazy, Suspense, useState } from 'react';
import type { SerializableClockWindows, SerializableStateTransitionHistory, SerializableTransferHistory } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import type { TimelineViewContext } from '../utils/buildViewContext';

const StateTimeline = lazy(() => import('./StateTransitionTimeline').then(module => ({ default: module.StateTransitionTimeline })));
const TransferTimeline = lazy(() => import('./TransferHistoryVisualization').then(module => ({ default: module.TransferHistoryVisualization })));
const WakeWindows = lazy(() => import('./WakeWindowsView').then(module => ({ default: module.WakeWindowsView })));

type TimelineView = 'states' | 'transfers' | 'windows';

export interface ClockTimelineWorkspaceProps {
    selected: ClockAlternativeView;
    fullscreen?: boolean;
    timeline: TimelineViewContext;
    onTimelineChange(timeline: TimelineViewContext): void;
    wakeAsTable: boolean;
    onWakeAsTableChange(asTable: boolean): void;
    transferHistory: SerializableTransferHistory | null;
    stateTransitionHistory: SerializableStateTransitionHistory | null;
    clockOnlyTransferHistory: SerializableTransferHistory | null;
    clockOnlyStateTransitionHistory: SerializableStateTransitionHistory | null;
    clockWindows: SerializableClockWindows | null;
}

/** Charts load on first use and stay mounted so switching views preserves their controls and scroll position. */
export function ClockTimelineWorkspace(props: ClockTimelineWorkspaceProps) {
    const [view, setView] = useState<TimelineView>('windows');
    const [visited, setVisited] = useState<Partial<Record<TimelineView, boolean>>>({ windows: true });
    const [run, setRun] = useState<'clock' | 'plan'>('clock');
    const hasClockRun = props.clockOnlyTransferHistory !== null && props.clockOnlyStateTransitionHistory !== null;
    const showClock = hasClockRun && run === 'clock';
    const transfers = showClock ? props.clockOnlyTransferHistory : props.transferHistory;
    const states = showClock ? props.clockOnlyStateTransitionHistory : props.stateTransitionHistory;

    return <Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
            <ToggleButtonGroup value={view} exclusive size="small" aria-label="Timeline view" onChange={(_, next: TimelineView | null) => {
                if (!next) return;
                setView(next);
                setVisited(previous => ({ ...previous, [next]: true }));
            }}>
                <ToggleButton value="states">Entity states</ToggleButton>
                <ToggleButton value="transfers">Item transfers</ToggleButton>
                <ToggleButton value="windows">Wake windows</ToggleButton>
            </ToggleButtonGroup>
            {hasClockRun && view !== 'windows' && <ToggleButtonGroup value={run} exclusive size="small" aria-label="Simulation shown in the timelines"
                onChange={(_, next: 'clock' | 'plan' | null) => { if (next) setRun(next); }}>
                <ToggleButton value="clock">Exported clock</ToggleButton>
                <ToggleButton value="plan">Plan</ToggleButton>
            </ToggleButtonGroup>}
        </Box>
        {hasClockRun && view !== 'windows' && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {run === 'clock'
                ? 'The build running with the exported blueprint’s wake windows.'
                : 'The planning simulation. Inserters also wait on machine inventory, so timing can differ from the exported clock.'}
        </Typography>}
        {visited.states && <Box hidden={view !== 'states'} sx={{ display: view === 'states' ? 'block' : 'none' }}>
            <Suspense fallback={<Typography role="status">Loading entity states…</Typography>}>
                {states ? <StateTimeline fullscreen={props.fullscreen} options={props.timeline} onOptionsChange={props.onTimelineChange} stateTransitionHistory={states} clockWindows={props.clockWindows ?? undefined} />
                    : <Typography>No entity-state history is available for this clock.</Typography>}
            </Suspense>
        </Box>}
        {visited.transfers && <Box hidden={view !== 'transfers'} sx={{ display: view === 'transfers' ? 'block' : 'none' }}>
            <Suspense fallback={<Typography role="status">Loading item transfers…</Typography>}>
                {transfers ? <TransferTimeline fullscreen={props.fullscreen} transferHistory={transfers} /> : <Typography>No transfer history is available for this clock.</Typography>}
            </Suspense>
        </Box>}
        {visited.windows && <Box hidden={view !== 'windows'} sx={{ display: view === 'windows' ? 'block' : 'none' }}>
            <Suspense fallback={<Typography role="status">Loading wake windows…</Typography>}>
                <WakeWindows alternative={props.selected} asTable={props.wakeAsTable} onAsTableChange={props.onWakeAsTableChange} headingLevel="h3" />
            </Suspense>
        </Box>}
    </Box>;
}
