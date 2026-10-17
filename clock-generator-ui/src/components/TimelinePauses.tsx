import { Box, Button, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import type { TimelineRecording } from 'clock-generator/browser';
import { timelineStateDurations, timelineWaits, type TimelineWait } from '../utils/timelineInspection';
import { formatNumberText } from '../utils/numberText';
import { timelineStateLabel } from '../utils/timelinePresentation';

export function TimelinePauses({ recording, entityId, targetMet, onExplore }: {
    recording: TimelineRecording; entityId: string; targetMet: boolean; onExplore(wait: TimelineWait): void;
}) {
    const waits = useMemo(() => timelineWaits(recording, entityId), [recording, entityId]);
    const states = useMemo(() => timelineStateDurations(recording, entityId), [recording, entityId]);
    const groups = useMemo(() => states.filter(state => waits.some(wait => wait.state === state.state)).sort((a, b) => b.ticks - a.ticks), [states, waits]);
    const [choice, setChoice] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const selected = groups.find(group => group.state === choice) ?? groups[0];
    const examples = waits.filter(wait => wait.state === selected?.state);
    const start = Math.min(page * 5, Math.max(0, Math.floor((examples.length - 1) / 5) * 5));
    const stateSummary = states.filter(state => state.ticks > 0).map(state => `${timelineStateLabel(state.state)} ${formatNumberText(state.share * 100, { maxDecimals: 1 })}%`).join(' · ');
    return <Box component="details" data-timeline-pauses>
        <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>Explore pauses</Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
            Pauses are normal when a clock batches work or runs below maximum capacity.
            {targetMet ? ' This clock meets the assessed target despite its pauses.' : ' A pause by itself does not explain a missed target.'}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            Recorded time in this replay: {stateSummary || 'No state history available'}.
            {recording.truncated ? ' This covers the recorded excerpt only.' : ''} Choose a pause category, then an interval to see what happened around it.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, my: 1 }}>{groups.map(group => <Button key={group.state} color="inherit" size="small" variant={selected?.state === group.state ? 'outlined' : 'text'}
            aria-pressed={selected?.state === group.state} onClick={() => { setChoice(group.state); setPage(0); }}>
            {timelineStateLabel(group.state)} · {formatNumberText(group.share * 100, { maxDecimals: 1 })}%
        </Button>)}</Box>
        {selected && <Typography variant="caption" color="text.secondary">{timelineStateLabel(selected.state)} · {selected.ticks} ticks across {examples.length} {examples.length === 1 ? 'pause' : 'pauses'}</Typography>}
        {examples.slice(start, start + 5).map(wait => <Button key={`${wait.start}-${wait.state}`} color="inherit" size="small" sx={{ display: 'flex' }} onClick={() => onExplore(wait)}>
            Show {wait.start}–{wait.end} ticks · {wait.end - wait.start} ticks long
        </Button>)}
        {examples.length > 5 && <Box><Button color="inherit" size="small" disabled={start === 0} onClick={() => setPage(Math.max(0, page - 1))}>Previous pauses</Button><Button color="inherit" size="small" disabled={start + 5 >= examples.length} onClick={() => setPage(page + 1)}>Next pauses</Button></Box>}
        {!groups.length && <Typography variant="body2">No ingredient, output-space or fuel pauses were recorded for this entity.</Typography>}
    </Box>;
}
