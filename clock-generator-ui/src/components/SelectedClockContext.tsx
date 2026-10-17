import { Box, Tab, Tabs, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { ClockAlternativeView, GenerationAssumptions } from '../worker/types';
import type { ResultDetail } from '../utils/resultsView';
import { MODELED_START, PLANNING_START, modeledDetails, startCheckSummary } from '../utils/modelAssumptions';
import { useGameNames } from '../hooks/useGameNames';
import { recoversOf } from '../utils/clockSummary';
import { formatNumberText } from '../utils/numberText';
import { buildWakeWindowRows } from '../utils/wakeWindows';
import { Panel } from './Panel';
import { InstallSteps } from './InstallSteps';
import { WakeWindowsView } from './WakeWindowsView';
import { tabProps } from '../utils/tabIds';
import { TabBody } from './TabBody';

export function SelectedClockContext({ selected, detail, onDetailChange, generation, stale, assumptions, children }: {
    selected: ClockAlternativeView;
    detail: ResultDetail;
    onDetailChange: (detail: ResultDetail) => void;
    generation: GenerationAssumptions | null;
    stale: boolean;
    assumptions: ReactNode;
    children: ReactNode;
}) {
    const { itemLabel } = useGameNames();
    const moves = new Map(buildWakeWindowRows(selected).map(row => [row.id, { items: row.items, route: row.route }]));
    return <Panel title="Selected clock details" sx={{ mb: 0 }} data-result-context="">
        <Tabs value={detail} onChange={(_, value: ResultDetail) => onDetailChange(value)} selectionFollowsFocus
            aria-label="Selected clock details" sx={{ borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minWidth: 0, flex: 1 } }}>
            <Tab label="Why" value="why" {...tabProps('result-context', 'why')} />
            <Tab label="Wake" value="wake" {...tabProps('result-context', 'wake')} />
            <Tab label="Install" value="install" {...tabProps('result-context', 'install')} />
        </Tabs>
        <TabBody prefix="result-context" tab="why" shown={detail === 'why'}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>Why this clock</Typography>
            <Typography variant="body2" sx={{ my: 1, overflowWrap: 'anywhere' }}>{selected.description}</Typography>
            <Typography variant="body2">Clock period: {formatNumberText(selected.simulationDurationTicks, { maxDecimals: 3 })} ticks; {selected.inserterWindowCount} wake windows. Wake-ups count one modeled unit, and are different from wake windows.</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{recoversOf(selected).detail}</Typography>
            <Box component="details" sx={{ mt: 1, overflowWrap: 'anywhere' }} data-model-assumptions>
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
        <TabBody prefix="result-context" tab="wake" shown={detail === 'wake'}>
            <WakeWindowsView alternative={selected} headingLevel="h3" />
        </TabBody>
        <TabBody prefix="result-context" tab="install" shown={detail === 'install'}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>Install in Factorio</Typography>
            <InstallSteps install={selected.install} movesOf={id => moves.get(id) ?? { items: [], route: '' }} stale={stale} alwaysOpen />
        </TabBody>
    </Panel>;
}
