import { Box, Tab, Tabs, Typography } from '@mui/material';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { ClockTimelineWorkspaceProps } from './ClockTimelineWorkspace';
import type { ClockAlternativeView, GenerationAssumptions } from '../worker/types';
import type { ResultDetail } from '../utils/resultsView';
import { MODELED_START, START_LIMITS, modeledDetails, phaseChecksText, startCheckSummary } from '../utils/modelAssumptions';
import { useGameNames } from '../hooks/useGameNames';
import { lossLimitText, recoversOf } from '../utils/clockSummary';
import { formatNumberText } from '../utils/numberText';
import { FullscreenWorkspace } from './FullscreenWorkspace';
import { tabProps } from '../utils/tabIds';
import { TabBody } from './TabBody';
import { useBuildSection } from '../hooks/useBuildViewContext';

const ClockTimeline = lazy(() => import('./ClockTimelineWorkspace').then(module => ({ default: module.ClockTimelineWorkspace })));

export function SelectedClockContext({ selected, detail, onDetailChange, timelineProps, generation, assumptions, clockSelector, children }: {
    selected: ClockAlternativeView;
    detail: ResultDetail;
    onDetailChange: (detail: ResultDetail) => void;
    timelineProps: Omit<ClockTimelineWorkspaceProps, 'selected' | 'fullscreen'>;
    clockSelector: ReactNode;
    generation: GenerationAssumptions | null;
    assumptions: ReactNode;
    children: ReactNode;
}) {
    const { itemLabel } = useGameNames();
    const [fullscreen, setFullscreen] = useState(false);
    const [timelineVisited, setTimelineVisited] = useState(detail === 'timeline');
    if (detail === 'timeline' && !timelineVisited) setTimelineVisited(true);
    const [assumptionsOpen, setAssumptionsOpen] = useBuildSection('model-assumptions');
    return <FullscreenWorkspace fullscreen={fullscreen} onFullscreenChange={setFullscreen} actions={clockSelector}>
        {/* Above floating field labels (z-index 1) while the fullscreen body scrolls. */}
        <Tabs value={detail} onChange={(_, value: ResultDetail) => onDetailChange(value)} selectionFollowsFocus
            aria-label="Selected clock workspace" sx={{ ...(fullscreen && { position: 'sticky', top: -16, zIndex: 2, bgcolor: 'background.paper' }), borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minWidth: 0, flex: 1 } }}>
            <Tab label="Overview" value="overview" {...tabProps('result-context', 'overview')} />
            <Tab label="Timeline" value="timeline" {...tabProps('result-context', 'timeline')} />
        </Tabs>
        <TabBody prefix="result-context" tab="overview" shown={detail === 'overview'}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>Why this clock</Typography>
            <Typography variant="body2" sx={{ my: 1, overflowWrap: 'anywhere' }}>{selected.description}</Typography>
            <Typography variant="body2">The clock repeats every {formatNumberText(selected.simulationDurationTicks, { maxDecimals: 3 })} ticks ({formatNumberText(selected.simulationDurationTicks / 60, { maxDecimals: 2 })} s). In each repeat, each inserter is switched on in its own wake windows: {selected.inserterWindowCount} in all. A wake window can hold several swings, and a swing can finish in a later window, so the number of wake windows and the number of swings need not match.</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{[recoversOf(selected).detail, lossLimitText(selected, itemLabel)].filter(Boolean).join(' ')}</Typography>
            <Box component="details" open={assumptionsOpen} onToggle={event => { const open = (event.currentTarget as HTMLDetailsElement).open; if (open !== assumptionsOpen) setAssumptionsOpen(open); }} sx={{ mt: 1, overflowWrap: 'anywhere' }} data-model-assumptions>
                <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>Model and tested starts</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>{MODELED_START}</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>{startCheckSummary([selected], generation)}</Typography>
                {modeledDetails(selected, itemLabel).map(line => <Typography key={line} variant="body2" sx={{ mt: 1 }}>{line}</Typography>)}
                <Typography variant="body2" sx={{ mt: 1 }}>{phaseChecksText(selected.asBuilt?.start_phases_checked)}</Typography>
                {selected.assessment.start_dependence?.starts.map(start => <Typography key={start.id} variant="body2" sx={{ mt: 0.5 }}>
                    {start.label}: {start.reaches_target ? 'reaches target' : 'does not reach target'}{start.output_items_per_period === null ? '; settled rate unavailable' : `; ${formatNumberText(start.output_items_per_period)} items per period`}.
                </Typography>)}
                <Typography variant="body2" sx={{ mt: 1 }}>{START_LIMITS}</Typography>
                {assumptions}
            </Box>
            {children}
        </TabBody>
        <TabBody prefix="result-context" tab="timeline" shown={detail === 'timeline'}>
            {(timelineVisited || detail === 'timeline') && <Suspense fallback={<Typography role="status">Loading timelines…</Typography>}>
                <ClockTimeline {...timelineProps} selected={selected} fullscreen={fullscreen} />
            </Suspense>}
        </TabBody>
    </FullscreenWorkspace>;
}
