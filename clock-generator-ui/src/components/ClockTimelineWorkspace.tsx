import { Alert, Autocomplete, Box, Button, Checkbox, CircularProgress, FormControlLabel, IconButton, MenuItem, Slider, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, RestartAlt, ZoomIn, ZoomOut } from '@mui/icons-material';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Config, SerializableClockWindows, SerializableStateTransitionHistory, SerializableTransferHistory, TimelineEntity } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import type { TimelineViewContext } from '../utils/buildViewContext';
import { timelineRequestFor } from '../utils/timelineRequest';
import { useTimelineRecording } from '../hooks/useTimelineRecording';
import { useGameNames } from '../hooks/useGameNames';
import { DEFAULT_INSPECTION, validInspection, timelineEntityName, clampTimelineRange, panTimeline, relevantTimelineEvents, relatedTimelineEntities, upperBound, zoomTimeline, type TimelineInspection, type TimelineRange } from '../utils/timelineInspection';
import { formatNumberText } from '../utils/numberText';
import { signalsForTimelinePause } from '../utils/timelinePresentation';
import { TimelineSignals } from './TimelineSignals';
import { TimelineTickInspector } from './TimelineTickInspector';
import { TimelinePauses } from './TimelinePauses';
import { FactorioIcon } from './FactorioIcon';
import { BeltChartSurface } from './BeltChart';
import { BELT_CHART } from '../theme/beltCharts';

const EvidenceChart = lazy(() => import('./TimelineEvidenceChart').then(module => ({ default: module.TimelineEvidenceChart })));
const WakeWindows = lazy(() => import('./WakeWindowsView').then(module => ({ default: module.WakeWindowsView })));
const OriginalStates = lazy(() => import('./StateTransitionTimeline').then(module => ({ default: module.StateTransitionTimeline })));
const OriginalTransfers = lazy(() => import('./TransferHistoryVisualization').then(module => ({ default: module.TransferHistoryVisualization })));

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
    /** The immutable config captured with the generated results, not the live form. */
    config?: Config | null;
}

function entityOptions(config: Config | null | undefined, clock: ClockAlternativeView): TimelineEntity[] {
    const entities = new Map<string, TimelineEntity>();
    for (const entity of clock.stateTransitionHistory.entities) entities.set(entity.entity_id, {
        id: entity.entity_id, type: entity.entity_type, items: entity.items, source: entity.source?.entity_id, sink: entity.sink?.entity_id, signals: [],
    });
    for (const machine of config?.machines ?? []) entities.set(`machine:${machine.id}`, { ...entities.get(`machine:${machine.id}`), id: `machine:${machine.id}`, type: 'machine', recipe: machine.recipe, items: entities.get(`machine:${machine.id}`)?.items ?? [], signals: [] });
    for (const belt of config?.belts ?? []) entities.set(`belt:${belt.id}`, { id: `belt:${belt.id}`, type: 'belt', items: belt.lanes.map(lane => lane.ingredient), signals: [] });
    for (const chest of config?.chests ?? []) entities.set(`chest:${chest.id}`, { id: `chest:${chest.id}`, type: 'chest', items: typeof chest.item_filter === 'string' ? [chest.item_filter] : chest.item_filter.map(filter => filter.item_name), signals: [] });
    for (const [index, inserter] of (config?.inserters ?? []).entries()) {
        const id = `inserter:${inserter.id ?? index + 1}`;
        if (!entities.has(id)) entities.set(id, { id, type: 'inserter', source: `${inserter.source.type}:${inserter.source.id}`, sink: `${inserter.sink.type}:${inserter.sink.id}`, items: inserter.filters ?? [], signals: [] });
    }
    for (const drill of config?.drills?.configs ?? []) {
        const id = `drill:${drill.id}`;
        if (!entities.has(id)) entities.set(id, { id, type: 'drill', sink: `machine:${drill.target.id}`, items: [drill.mined_item_name], signals: [] });
    }
    return [...entities.values()].sort((a, b) => a.type.localeCompare(b.type) || Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]));
}

/** Local cursor updates stay below App; only settled inspection choices are saved with the build. */
function useInspection(props: ClockTimelineWorkspaceProps) {
    const configKey = useMemo(() => JSON.stringify(props.config), [props.config]);
    const [inspection, setInspection] = useState<TimelineInspection>(() => props.timeline.inspection ? validInspection(props.timeline.inspection) : DEFAULT_INSPECTION);
    const latest = useRef(props); latest.current = props;
    const lastSaved = useRef<TimelineInspection | undefined>(props.timeline.inspection);
    useEffect(() => { setInspection(latest.current.timeline.inspection ? validInspection(latest.current.timeline.inspection) : DEFAULT_INSPECTION); }, [configKey]);
    useEffect(() => {
        if (props.timeline.inspection && props.timeline.inspection !== lastSaved.current) setInspection(validInspection(props.timeline.inspection));
    }, [props.timeline.inspection]);
    useEffect(() => {
        const timeout = setTimeout(() => {
            lastSaved.current = inspection;
            latest.current.onTimelineChange({ ...latest.current.timeline, inspection });
        }, 300);
        return () => clearTimeout(timeout);
    }, [inspection]);
    const patch = useCallback((change: Partial<TimelineInspection>) => setInspection(previous => ({ ...previous, ...change })), []);
    return [inspection, patch] as const;
}

const number = (value: number) => formatNumberText(value, { maxDecimals: 2 });

export function ClockTimelineWorkspace(props: ClockTimelineWorkspaceProps) {
    const { recipeLabel, itemLabel } = useGameNames();
    const [inspection, patch] = useInspection(props);
    const [retry, setRetry] = useState(0);
    const recordingWanted = inspection.view !== 'windows';
    const options = useMemo(() => entityOptions(props.config, props.selected), [props.config, props.selected]);
    const request = useMemo(() => recordingWanted ? timelineRequestFor(props.config, props.selected, inspection.run) : null, [props.config, props.selected, inspection.run, recordingWanted, retry]);
    const primary = useTimelineRecording(request, retry);
    const recording = primary.data;
    const selectedId = options.some(entity => entity.id === inspection.entityId) ? inspection.entityId : options.find(entity => entity.type === 'machine')?.id ?? options[0]?.id;
    const selected = recording?.entities.find(entity => entity.id === selectedId) ?? options.find(entity => entity.id === selectedId) ?? recording?.entities[0] ?? null;
    const duration = inspection.view === 'windows'
        ? props.selected.simulationDurationTicks
        : recording?.end_tick ?? props.selected.simulationDurationTicks;
    const domain = inspection.view === 'windows' ? 'windows' : inspection.run;
    const savedRange = inspection.ranges[domain];
    const range = useMemo(() => clampTimelineRange(savedRange, duration), [savedRange, duration]);
    const tick = Math.max(0, Math.min(Math.floor(duration), inspection.tick));
    const current = useRef({ inspection, duration, domain, range }); current.current = { inspection, duration, domain, range };
    const setRange = useCallback((next: TimelineRange) => {
        const { inspection: previous, duration: end, domain: key } = current.current;
        patch({ ranges: { ...previous.ranges, [key]: clampTimelineRange(next, end) } });
    }, [patch]);
    const setTick = useCallback((value: number) => {
        const { duration: end, range: window } = current.current;
        const next = Math.max(0, Math.min(Math.floor(end), Math.round(value)));
        patch({ tick: next });
        if (next < window.start || next > window.end) {
            const half = (window.end - window.start) / 2;
            setRange({ start: next - half, end: next + half });
        }
    }, [patch, setRange]);
    const zoom = useCallback((factor: number, cursor: number) => setRange(zoomTimeline(current.current.range, factor, cursor, current.current.duration)), [setRange]);
    const inspect = useCallback((entityId: string, at: number) => {
        patch({ entityId, tick: Math.round(at) });
        const { range: window, duration: end } = current.current;
        if (at < window.start || at > window.end) { const half = (window.end - window.start) / 2; setRange(clampTimelineRange({ start: at - half, end: at + half }, end)); }
    }, [patch, setRange]);
    const connected = useMemo(() => recording && selected ? relatedTimelineEntities(recording, selected) : [], [recording, selected]);
    const events = useMemo(() => recording && selected ? relevantTimelineEvents(recording, selected) : [], [recording, selected]);
    const eventTicks = useMemo(() => events.map(event => event.tick), [events]);
    const tickEvents = events.slice(upperBound(eventTicks, tick - 1), upperBound(eventTicks, tick));
    const [eventPage, setEventPage] = useState(0);
    const eventStart = Math.min(eventPage * 8, Math.max(0, Math.floor((events.length - 1) / 8) * 8));
    const onKeys = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest('input,select,textarea,button,[role="combobox"]')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setTick(tick + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 15 : 1)); }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.5, tick); }
        if (event.key === '-') { event.preventDefault(); zoom(2, tick); }
    };
    return <Box data-clock-inspection onKeyDown={onKeys}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
            <TextField select size="small" label="Timeline view" value={inspection.view} onChange={event => patch({ view: event.target.value as TimelineInspection['view'] })} sx={{ display: { xs: 'block', sm: 'none' }, flex: '1 1 100%' }}>
                <MenuItem value="windows">Wake windows</MenuItem><MenuItem value="activity">Activity</MenuItem><MenuItem value="transfers">Item transfers</MenuItem>
            </TextField>
            <ToggleButtonGroup value={inspection.view} exclusive size="small" aria-label="Timeline view" onChange={(_, view: TimelineInspection['view'] | null) => { if (view) patch({ view }); }} sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap' }}>
                <ToggleButton value="windows">Wake windows</ToggleButton>
                <ToggleButton value="activity">Activity</ToggleButton>
                <ToggleButton value="transfers">Item transfers</ToggleButton>
            </ToggleButtonGroup>
            {recordingWanted && <ToggleButtonGroup value={inspection.run} exclusive size="small" aria-label="Simulation shown in the timelines" onChange={(_, run: 'clock' | 'plan' | null) => { if (run) patch({ run }); }}>
                <ToggleButton value="clock">Exported clock</ToggleButton><ToggleButton value="plan">Plan</ToggleButton>
            </ToggleButtonGroup>}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1 }}>
            <Autocomplete options={options} value={options.find(option => option.id === selectedId) ?? null} isOptionEqualToValue={(a, b) => a.id === b.id}
                getOptionLabel={entity => timelineEntityName(entity, recipeLabel)}
                filterOptions={(entities, state) => entities.filter(entity => `${timelineEntityName(entity, recipeLabel)} ${entity.items.map(itemLabel).join(' ')}`.toLowerCase().includes(state.inputValue.toLowerCase())).slice(0, 80)}
                onChange={(_, entity) => { if (entity) { patch({ entityId: entity.id }); setEventPage(0); } }}
                renderInput={params => <TextField {...params} label="Inspect entity" size="small" />}
                renderOption={(attributes, entity) => { const { key, ...rest } = attributes; return <li key={key} {...rest}>{entity.items[0] && <FactorioIcon name={entity.items[0]} size={22} alt="" />}<span>{timelineEntityName(entity, recipeLabel)}</span></li>; }}
                sx={{ width: 330, maxWidth: '100%', flexGrow: { xs: 1, sm: 0 } }} />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.25 }}>
                <Tooltip title="Pan earlier"><IconButton size="small" aria-label="Pan timeline earlier" onClick={() => setRange(panTimeline(range, -0.5, duration))}><ChevronLeft /></IconButton></Tooltip>
                <Tooltip title="Zoom out"><IconButton size="small" aria-label="Zoom timeline out" onClick={() => zoom(2, tick)}><ZoomOut /></IconButton></Tooltip>
                <Tooltip title="Zoom in"><IconButton size="small" aria-label="Zoom timeline in" onClick={() => zoom(0.5, tick)}><ZoomIn /></IconButton></Tooltip>
                <Tooltip title="Pan later"><IconButton size="small" aria-label="Pan timeline later" onClick={() => setRange(panTimeline(range, 0.5, duration))}><ChevronRight /></IconButton></Tooltip>
                <Button color="inherit" size="small" startIcon={<RestartAlt />} onClick={() => setRange({ start: 0, end: duration })}>Fit run</Button>
                <Typography variant="caption" color="text.secondary">{number(range.start)}–{number(range.end)} t</Typography>
            </Box>
        </Box>
        {recordingWanted && <FormControlLabel sx={{ mb: 0.5 }} label="Show connected entities" control={<Checkbox size="small" checked={inspection.showConnections === true} onChange={(_, showConnections) => patch({ showConnections })} />} />}
        {inspection.view === 'activity' && <TimelineSignals signals={inspection.signals} onChange={signals => patch({ signals })} />}
        {recordingWanted && <Typography variant="body2" sx={{ mb: 1 }}>
            {props.selected.ranking.meets_target_rate ? `This clock meets ${number(props.selected.assessment.items_per_second)} items/s across all copies. Pauses can be part of that pattern.`
                : 'Explore the recorded activity alongside this clock’s assessed output.'}
        </Typography>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: recordingWanted ? 'minmax(0,1fr) 245px' : 'minmax(0,1fr)' }, gap: 1.5, alignItems: 'start' }}>
            <Box sx={{ minWidth: 0 }}>
                <Suspense fallback={<Typography role="status">Loading chart…</Typography>}>
                    {inspection.view === 'windows' ? <>
                        <WakeWindows config={props.config} alternative={props.selected} asTable={props.wakeAsTable} onAsTableChange={props.onWakeAsTableChange} headingLevel="h3" inspection={{ range, tick, onInspect: inspect }} />
                        {selected && <Button color="inherit" size="small" sx={{ mt: 1 }} onClick={() => patch({ view: 'activity' })}>Inspect {timelineEntityName(selected, recipeLabel)} activity</Button>}
                    </> : <>
                        {primary.status === 'loading' && <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}><CircularProgress size={20} />Recording this clock’s activity…</Box>}
                        {primary.status === 'idle' && <Alert severity="info">This saved result lacks the build or exact fuel-clock metadata needed for a detailed replay. Generate again to record its activity.</Alert>}
                        {primary.error && <Alert severity="warning" action={<Button color="inherit" onClick={() => setRetry(retry + 1)}>Retry</Button>}>{primary.error}</Alert>}
                        {recording && selected && <BeltChartSurface><Box sx={{ p: { xs: 1, sm: 1.5 }, bgcolor: BELT_CHART.background }}>
                            <EvidenceChart recording={recording} selected={selected} groups={inspection.signals} range={range} tick={tick} view={inspection.view} showConnections={inspection.showConnections} onTick={setTick} onInspect={inspect} onRange={setRange} onZoom={zoom} />
                        </Box></BeltChartSurface>}
                        {recording?.truncated && <Alert severity="info" sx={{ mt: 1 }}>Detailed recording is limited to the first {number(recording.end_tick)} ticks of {number(recording.requested_ticks)} requested ticks to bound memory. Zoom and inspection use only this excerpt.</Alert>}
                    </>}
                </Suspense>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
                    <TextField label="Inspect tick" type="number" size="small" value={tick} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setTick(value); }} slotProps={{ htmlInput: { min: 0, max: Math.floor(duration), step: 1 } }} sx={{ width: 125 }} />
                    <Slider aria-label="Timeline tick cursor" value={tick} min={0} max={Math.max(1, Math.floor(duration))} step={1} onChange={(_, value) => setTick(Number(value))} sx={{ mx: 1, flex: 1 }} />
                    <Typography variant="caption" sx={{ minWidth: 55 }}>{number(tick / 60)} s</Typography>
                </Box>
                {recording && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>One modelled unit · {inspection.run === 'clock' ? 'exported clock, including circuit latency' : 'planning controls'} · tick 0 is the baseline after preparation/warm-up ({number(recording.ticks_before_recording)} ticks excluded); controls restart at phase 0 with that inventory. Full input supplies; delivery rates exclude events before tick 0. This replay does not change the clock assessment.</Typography>}
            </Box>
            {recordingWanted && selected && recording && <TimelineTickInspector recording={recording} entity={selected} inspection={inspection} tick={tick} events={tickEvents} connected={connected} onEntityChange={entityId => patch({ entityId })} />}

        </Box>
        {recording && selected && <Box sx={{ mt: 1.5 }}>
            <TimelinePauses key={selected.id} recording={recording} entityId={selected.id} targetMet={props.selected.ranking.meets_target_rate} onExplore={wait => {
                const padding = Math.max(15, (wait.end - wait.start) * 0.2);
                patch({ view: 'activity', signals: signalsForTimelinePause(inspection.signals, wait.state), tick: wait.start, entityId: wait.entityId,
                    showConnections: inspection.showConnections || (wait.state === 'waiting_for_space_in_destination' && selected.type === 'inserter' && Boolean(selected.sink)),
                });
                setRange({ start: wait.start - padding, end: wait.end + padding });
            }} />
            <Box component="details" sx={{ mt: 1 }}>
                <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>Exact events · {events.length}</Typography>
                {events.slice(eventStart, eventStart + 8).map((event, index) => <Button key={`${event.tick}-${event.entity_id}-${event.kind}-${index}`} color="inherit" size="small" sx={{ display: 'flex', textAlign: 'left' }} onClick={() => inspect(event.entity_id, event.tick)}>
                    {event.tick} t · {event.entity_id} · {event.kind.replaceAll('-', ' ')} · {number(event.amount)} {event.item ? itemLabel(event.item) : ''}
                </Button>)}
                {events.length > 8 && <Box><Button color="inherit" size="small" disabled={eventStart === 0} onClick={() => setEventPage(Math.max(0, eventPage - 1))}>Previous events</Button><Button color="inherit" size="small" disabled={eventStart + 8 >= events.length} onClick={() => setEventPage(eventPage + 1)}>Next events</Button></Box>}
            </Box>
        </Box>}
        <Box component="details" sx={{ mt: 1.5 }}>
            <Typography component="summary" variant="caption" color="text.secondary" sx={{ cursor: 'pointer' }}>Original full histories & planning ranges</Typography>
            <LegacyHistories props={props} />
        </Box>
    </Box>;
}

function LegacyHistories({ props }: { props: ClockTimelineWorkspaceProps }) {
    const [open, setOpen] = useState(false);
    return <Box sx={{ mt: 1 }}>
        <Typography variant="body2">Planning transfer ranges are merged and adjusted to derive clock windows; their endpoints are not exact delivery times.</Typography>
        <Button color="inherit" size="small" onClick={() => setOpen(!open)}>{open ? 'Hide full histories' : 'Load full histories'}</Button>
        {open && <Suspense fallback={<Typography>Loading full histories…</Typography>}>
            {props.stateTransitionHistory && <OriginalStates fullscreen={props.fullscreen} options={props.timeline} onOptionsChange={props.onTimelineChange} stateTransitionHistory={props.stateTransitionHistory} clockWindows={props.clockWindows ?? undefined} />}
            {props.transferHistory && <OriginalTransfers fullscreen={props.fullscreen} transferHistory={props.transferHistory} />}
        </Suspense>}
    </Box>;
}
