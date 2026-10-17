import { Box, Tab, Tabs, Typography } from '@mui/material';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { ClockTimelineWorkspaceProps } from './ClockTimelineWorkspace';
import type { ClockAlternativeView, GenerationAssumptions } from '../worker/types';
import type { ResultDetail } from '../utils/resultsView';
import { MODELED_START, PLANNING_START, modeledDetails, startCheckSummary } from '../utils/modelAssumptions';
import { useGameNames } from '../hooks/useGameNames';
import { recoversOf } from '../utils/clockSummary';
import { formatNumberText } from '../utils/numberText';
import { buildWakeWindowRows } from '../utils/wakeWindows';
import { FullscreenWorkspace } from './FullscreenWorkspace';
import { InstallSteps } from './InstallSteps';
import { tabProps } from '../utils/tabIds';
import { TabBody } from './TabBody';
import { useBuildSection } from '../hooks/useBuildViewContext';

const ClockTimeline = lazy(() => import('./ClockTimelineWorkspace').then(module => ({ default: module.ClockTimelineWorkspace })));

export function SelectedClockContext({ selected, detail, onDetailChange, timelineProps, generation, stale, assumptions, installContent, clockSelector, children }: {
    selected: ClockAlternativeView;
    detail: ResultDetail;
    onDetailChange: (detail: ResultDetail) => void;
    timelineProps: Omit<ClockTimelineWorkspaceProps, 'selected' | 'fullscreen'>;
    installContent: ReactNode;
    clockSelector: ReactNode;
    generation: GenerationAssumptions | null;
    stale: boolean;
    assumptions: ReactNode;
    children: ReactNode;
}) {
    const { itemLabel } = useGameNames();
    const [fullscreen, setFullscreen] = useState(false);
    const [timelineVisited, setTimelineVisited] = useState(detail === 'timeline');
    useEffect(() => { if (detail === 'timeline') setTimelineVisited(true); }, [detail]);
    const [assumptionsOpen, setAssumptionsOpen] = useBuildSection('model-assumptions');
    const moves = new Map(buildWakeWindowRows(selected).map(row => [row.id, { items: row.items, route: row.route }]));
    return <FullscreenWorkspace fullscreen={fullscreen} onFullscreenChange={setFullscreen} actions={clockSelector}>
        <Tabs value={detail} onChange={(_, value: ResultDetail) => onDetailChange(value)} selectionFollowsFocus
            aria-label="Selected clock workspace" sx={{ ...(fullscreen && { position: 'sticky', top: -16, zIndex: 1, bgcolor: 'background.paper' }), borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minWidth: 0, flex: 1 } }}>
            <Tab label="Overview" value="overview" {...tabProps('result-context', 'overview')} />
            <Tab label="Timeline" value="timeline" {...tabProps('result-context', 'timeline')} />
            <Tab label="Install" value="install" {...tabProps('result-context', 'install')} />
        </Tabs>
        <TabBody prefix="result-context" tab="overview" shown={detail === 'overview'}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>Why this clock</Typography>
            <Typography variant="body2" sx={{ my: 1, overflowWrap: 'anywhere' }}>{selected.description}</Typography>
            <Typography variant="body2">Clock period: {formatNumberText(selected.simulationDurationTicks, { maxDecimals: 3 })} ticks; {selected.inserterWindowCount} wake windows. Wake-ups count one modeled unit, and are different from wake windows.</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{recoversOf(selected).detail}</Typography>
            <Box component="details" open={assumptionsOpen} onToggle={event => { const open = (event.currentTarget as HTMLDetailsElement).open; if (open !== assumptionsOpen) setAssumptionsOpen(open); }} sx={{ mt: 1, overflowWrap: 'anywhere' }} data-model-assumptions>
                <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>Model and tested starts</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>{MODELED_START} {PLANNING_START}</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>{startCheckSummary([selected], generation)}</Typography>
                {modeledDetails(selected, itemLabel).map(line => <Typography key={line} variant="body2" sx={{ mt: 1 }}>{line}</Typography>)}
                <Typography variant="body2" sx={{ mt: 1 }}>Existing clock-phase checks: {selected.asBuilt?.start_phases_checked ?? 'unavailable'}. Extended sampled starts are a separate check.</Typography>
                {selected.assessment.start_dependence?.starts.map(start => <Typography key={start.id} variant="body2" sx={{ mt: 0.5 }}>
                    {start.label}: {start.reaches_target ? 'reaches target' : 'does not reach target'}{start.output_items_per_period === null ? '; settled rate unavailable' : `; ${formatNumberText(start.output_items_per_period)} items per period`}.
                </Typography>)}
                <Typography variant="body2" sx={{ mt: 1 }}>These empty-start phase/order samples do not cover every running inventory, build order, physical belt throughput or in-game recovery. Input-belt slack is a timing rule of thumb, not a physical belt-capacity check.</Typography>
                {assumptions}
            </Box>
            {children}
        </TabBody>
        <TabBody prefix="result-context" tab="timeline" shown={detail === 'timeline'}>
            {(timelineVisited || detail === 'timeline') && <Suspense fallback={<Typography role="status">Loading timelines…</Typography>}>
                <ClockTimeline {...timelineProps} selected={selected} fullscreen={fullscreen} />
            </Suspense>}
        </TabBody>
        <TabBody prefix="result-context" tab="install" shown={detail === 'install'}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>Install in Factorio</Typography>
            <InstallSteps install={selected.install} movesOf={id => moves.get(id) ?? { items: [], route: '' }} stale={stale} alwaysOpen />
            {installContent}
        </TabBody>
    </FullscreenWorkspace>;
}
