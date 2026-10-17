import { Box, Button, Typography } from '@mui/material';
import { useMemo } from 'react';
import type { TimelineEntity, TimelineEvent, TimelineRecording, TimelineSeries } from 'clock-generator/browser';
import { timelineEntityName, timelineValueAt, type TimelineInspection } from '../utils/timelineInspection';
import { timelineSignalVisible, timelineStateLabel } from '../utils/timelinePresentation';
import { formatNumberText } from '../utils/numberText';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';

const number = (value: number) => formatNumberText(value, { maxDecimals: 2 });

export function TimelineTickInspector({ recording, entity, inspection, tick, events, connected, onEntityChange }: {
    recording: TimelineRecording; entity: TimelineEntity; inspection: TimelineInspection; tick: number;
    events: TimelineEvent[]; connected: TimelineEntity[]; onEntityChange(id: string): void;
}) {
    const { recipeLabel, itemLabel } = useGameNames();
    const { visible, details } = useMemo(() => {
        const visible: TimelineSeries[] = [], details: TimelineSeries[] = [];
        for (const signal of entity.signals) {
            (timelineSignalVisible(entity, signal, inspection.view, inspection.signals) ? visible : details).push(signal);
        }
        return { visible, details };
    }, [entity, inspection.view, inspection.signals]);
    const outside = tick > recording.end_tick;
    const showEventFacts = inspection.view === 'transfers' || (inspection.view === 'activity' && inspection.signals.includes('transfers'));
    const shownEvents = showEventFacts ? events.filter(event => ['produce', 'pickup', 'drop'].includes(event.kind)) : [];
    const detailedEvents = events.filter(event => !shownEvents.includes(event));
    const fields = (signals: TimelineSeries[]) => <Box component="dl" sx={{ m: 0, mt: 1 }}>{signals.map(signal => {
        const value = timelineValueAt(signal, tick);
        const label = signal.id === 'produced' ? 'Total by selected tick' : signal.label;
        const text = typeof value === 'number' ? signal.unit === 'enabled' ? value ? 'Enabled' : 'Disabled' : `${number(value)} ${signal.unit}`
            : signal.id === 'hand-item' ? value ? itemLabel(String(value)) : 'Empty hand' : timelineStateLabel(String(value));
        return <Box key={signal.id} sx={{ mb: 0.75 }}>
            <Typography component="dt" variant="caption" color="text.secondary">{signal.item ? `${label} · ${itemLabel(signal.item)}` : label}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>{text}{signal.limit !== undefined ? ` · threshold ${number(signal.limit)}` : ''}</Typography>
        </Box>;
    })}</Box>;
    const eventList = (values: TimelineEvent[]) => values.slice(0, 8).map((event, index) => <Typography key={index} variant="body2">
        {event.entity_id} · {event.kind === 'produce' ? 'products made' : event.kind.replaceAll('-', ' ')} · {number(event.amount)} {event.item ? itemLabel(event.item) : ''}
    </Typography>);
    return <Box component="aside" aria-label="Tick inspector" sx={{ p: 1.5, border: 1, borderColor: 'divider', position: { lg: 'sticky' }, top: 8, minWidth: 0, overflowWrap: 'anywhere' }}>
        <Typography variant="overline">Tick inspector · {tick}</Typography>
        <Typography component="h3" variant="subtitle2">{timelineEntityName(entity, recipeLabel)}</Typography>
        {entity.note && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>{entity.note}</Typography>}
        {outside ? <Typography variant="body2" sx={{ mt: 1 }}>The selected tick is outside its recorded span.</Typography> : <>
            {fields(visible)}
            {shownEvents.length > 0 && <Box sx={{ my: 1 }}><Typography variant="caption" color="text.secondary">Events at this tick</Typography>{eventList(shownEvents)}</Box>}
            {(details.length > 0 || detailedEvents.length > 0) && <Box component="details" data-inspector-details sx={{ my: 1 }}>
                <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>{entity.type === 'machine' ? 'More machine details' : 'More entity details'}</Typography>
                {fields(details)}
                {detailedEvents.length > 0 && <Box sx={{ my: 1 }}><Typography variant="caption" color="text.secondary">Additional events at this tick</Typography>{eventList(detailedEvents)}</Box>}
            </Box>}
        </>}
        {connected.some(other => other.id !== entity.id) && <Typography variant="caption" color="text.secondary">Follow a connection</Typography>}
        {connected.filter(other => other.id !== entity.id).map(other => <Button key={other.id} color="inherit" size="small" onClick={() => onEntityChange(other.id)} sx={{ display: 'flex', justifyContent: 'flex-start', textAlign: 'left' }}>
            {other.items[0] && <FactorioIcon name={other.items[0]} size={18} alt="" />}{timelineEntityName(other, recipeLabel)}
        </Button>)}
    </Box>;
}
