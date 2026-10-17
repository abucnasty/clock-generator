import { Box, Button, Typography } from '@mui/material';
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TimelineEntity, TimelineEvent, TimelineRecording, TimelineSeries } from 'clock-generator/browser';
import { BELT_CHART, canvasChartFill, itemChartStyles } from '../theme/beltCharts';
import { deliveryRateSeries, productionBatches, timelineEntityName, timelinePoints, timelineValueAt, upperBound, type TimelineRange, type TimelineSignalGroup } from '../utils/timelineInspection';
import { timelineStateLabel, timelineStateStyle, timelineSignalVisible } from '../utils/timelinePresentation';
import { BeltChartSurface, ChartSwatch } from './BeltChart';
import { FactorioIcon } from './FactorioIcon';
import { formatNumberText } from '../utils/numberText';
import { useGameNames } from '../hooks/useGameNames';
import { axisTicks } from '../utils/wakeWindows';

interface EvidenceLane {
    id: string;
    entity: TimelineEntity;
    series?: TimelineSeries;
    events?: TimelineEvent[];
    label: string;
    color: string;
    unit?: string;
    ceiling?: number;
    production?: boolean;
    item?: string;
    itemStyles?: Map<string, { color: string }>;
}

function drawSeries(context: CanvasRenderingContext2D, series: TimelineSeries, range: TimelineRange, width: number, height: number, color: string, ceiling: number, end: number): void {
    if (end < range.start) return;
    const x = (tick: number) => (tick - range.start) / (range.end - range.start) * width;
    context.save();
    context.beginPath(); context.rect(0, 0, Math.max(0, x(Math.min(end, range.end))), height); context.clip();
    if (series.unit === 'state' || series.unit === 'enabled') {
        const first = Math.max(0, upperBound(series.ticks, range.start) - 1), last = upperBound(series.ticks, Math.min(end, range.end));
        const forced = matchMedia('(forced-colors: active)').matches;
        const fills = new Map<string, string | CanvasPattern>();
        const top = 3, barHeight = height - 6;
        for (let i = first; i < last; i++) {
            const a = x(Math.max(range.start, series.ticks[i])), b = x(Math.min(range.end, end, series.ticks[i + 1] ?? end));
            const value = String(series.values[i]);
            if (!fills.has(value)) {
                const fill = series.unit === 'enabled' ? Number(value) ? (forced ? 'CanvasText' : color) : (forced ? 'GrayText' : '#303030')
                    : forced ? value.toLowerCase().includes('disabled') ? 'GrayText' : value.toLowerCase() === 'working' ? 'CanvasText' : 'Highlight'
                    : canvasChartFill(context, timelineStateStyle(value));
                fills.set(value, fill);
            }
            context.fillStyle = fills.get(value)!;
            context.fillRect(a, top, Math.max(1, b - a), barHeight);

        }
    } else {
        const y = (value: number) => height - 7 - value / ceiling * (height - 18);
        const points = timelinePoints(series, { ...range, end: Math.min(range.end, end) }, width);
        if (points.length) {
            context.strokeStyle = color; context.lineWidth = 1.6;
            context.beginPath(); context.moveTo(x(points[0].tick), y(points[0].value));
            let previous = points[0].value;
            for (const point of points.slice(1)) { context.lineTo(x(point.tick), y(previous)); context.lineTo(x(point.tick), y(point.value)); previous = point.value; }
            context.stroke();
        }
    }
    context.restore();
}

function drawEvents(context: CanvasRenderingContext2D, events: TimelineEvent[], range: TimelineRange, width: number, y: number, styles: Map<string, { color: string }>): void {
    const ticks = events.map(event => event.tick);
    const first = Math.max(0, upperBound(ticks, range.start - 1)), end = upperBound(ticks, range.end);
    const occupied = new Set<string>();
    const forced = matchMedia('(forced-colors: active)').matches;
    for (let i = first; i < end; i++) {
        const event = events[i], x = Math.round((event.tick - range.start) / (range.end - range.start) * width);
        const bucket = `${x}:${event.kind}`;
        if (occupied.has(bucket)) continue;
        occupied.add(bucket);
        context.fillStyle = context.strokeStyle = forced ? 'CanvasText' : styles.get(event.item ?? '')?.color ?? '#bcbcbc';
        context.lineWidth = 1.5;
        context.beginPath();
        if (event.kind === 'pickup') { context.moveTo(x, y - 4); context.lineTo(x + 4, y); context.lineTo(x, y + 4); context.lineTo(x - 4, y); context.closePath(); }
        else if (event.kind === 'drop') context.arc(x, y, 3.5, 0, Math.PI * 2);
        else continue;
        context.fill();
    }
}

function drawProduction(context: CanvasRenderingContext2D, events: TimelineEvent[], range: TimelineRange, width: number, y: number, color: string): void {
    const forced = matchMedia('(forced-colors: active)').matches;
    context.fillStyle = context.strokeStyle = forced ? 'CanvasText' : color;
    context.font = '12px sans-serif'; context.textAlign = 'center'; context.lineWidth = 1;
    for (const batch of productionBatches(events, range, width / 54)) {
        const x = (batch.start - range.start) / (range.end - range.start) * width;
        const end = (batch.end - range.start) / (range.end - range.start) * width;
        const text = `+${formatNumberText(batch.amount, { maxDecimals: 2 })}`;
        const half = context.measureText(text).width / 2 + 2;
        context.fillText(text, Math.max(half, Math.min(width - half, (x + end) / 2)), y);
        context.beginPath(); context.moveTo(x, y + 4); context.lineTo(Math.max(x + 1, end), y + 4); context.stroke();
    }
}

/** The expensive data layer is independent of cursor movement; only the CSS guide/readouts change on a scrub. */
const EvidenceCanvas = memo(function EvidenceCanvas({ lane, range, end, height, onTick, onRange, onZoom }: {
    lane: EvidenceLane; range: TimelineRange; end: number; height: number;
    onTick(tick: number): void; onRange(range: TimelineRange): void; onZoom(factor: number, tick: number): void;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = useState(0);
    const gesture = useRef<{ x: number; tick: number; shift: boolean } | null>(null);
    const ticksAt = (x: number, element: HTMLElement) => range.start + Math.max(0, Math.min(1, (x - element.getBoundingClientRect().left) / element.getBoundingClientRect().width)) * (range.end - range.start);
    useEffect(() => {
        const node = canvas.current;
        if (!node) return;
        const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const node = canvas.current;
        if (!node || width <= 0) return;
        const forced = matchMedia('(forced-colors: active)');
        const paint = () => {
            const ratio = Math.min(2, window.devicePixelRatio || 1);
            node.width = width * ratio; node.height = height * ratio;
            const context = node.getContext('2d'); if (!context) return;
            context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
            context.strokeStyle = forced.matches ? 'GrayText' : BELT_CHART.grid; context.lineWidth = 1;
            for (const tick of axisTicks(range.end - range.start, width < 450 ? 4 : 7)) {
                const x = tick / (range.end - range.start) * width;
                context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
            }
            const ceiling = lane.ceiling ?? 1;
            if (lane.series && !lane.production) drawSeries(context, lane.series, range, width, height, forced.matches ? 'CanvasText' : lane.color, ceiling, end);
            if (lane.events) {
                const styles = lane.itemStyles ?? new Map();
                if (lane.production) {
                    drawProduction(context, lane.events, range, width, 16, lane.color);
                } else {
                    drawEvents(context, lane.events, range, width, 12, styles);
                }
            }
        };
        paint(); forced.addEventListener('change', paint);
        return () => forced.removeEventListener('change', paint);
    }, [lane, range, width, height, end]);
    useEffect(() => {
        const node = canvas.current;
        if (!node) return;
        const wheel = (event: WheelEvent) => {
            if (!event.ctrlKey) return;
            event.preventDefault(); onZoom(event.deltaY > 0 ? 1.4 : 1 / 1.4, ticksAt(event.clientX, node));
        };
        node.addEventListener('wheel', wheel, { passive: false });
        return () => node.removeEventListener('wheel', wheel);
    });
    const onUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const start = gesture.current; gesture.current = null;
        if (!start) return;
        const tick = ticksAt(event.clientX, event.currentTarget);
        if (Math.abs(event.clientX - start.x) > 14 && event.pointerType !== 'touch') {
            if (start.shift) onRange({ start: range.start + start.tick - tick, end: range.end + start.tick - tick });
            else onRange({ start: Math.min(tick, start.tick), end: Math.max(tick, start.tick) });
        } else onTick(Math.round(tick));
    };
    return <Box component="canvas" ref={canvas} role="img" tabIndex={0} aria-label={`${lane.label}, ${range.start} to ${range.end} ticks. Values are available in the tick inspector.`}
        onPointerDown={event => { gesture.current = { x: event.clientX, tick: ticksAt(event.clientX, event.currentTarget), shift: event.shiftKey }; if (event.pointerType !== 'touch') event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={onUp} onPointerCancel={() => { gesture.current = null; }}
        sx={{ display: 'block', width: '100%', height, touchAction: 'pan-y', cursor: 'crosshair', forcedColorAdjust: 'none', '&:focus-visible': { outline: '2px solid #ffa600', outlineOffset: 2 } }} />;
});

export function TimelineEvidenceChart({ recording, selected, groups, range, tick, view, showConnections: requestedConnections = false, onTick, onInspect, onRange, onZoom }: {
    recording: TimelineRecording; selected: TimelineEntity; groups: TimelineSignalGroup[];
    range: TimelineRange; tick: number; view: 'activity' | 'states' | 'transfers';
    showConnections?: boolean;
    onTick(tick: number): void; onInspect?(entityId: string, tick: number): void; onRange(range: TimelineRange): void; onZoom(factor: number, tick: number): void;
}) {
    const { itemLabel, recipeLabel } = useGameNames();
    // Belts have no recorded occupancy: their useful activity is always on their connected inserters.
    const showConnections = selected.type === 'belt' || requestedConnections;
    const [page, setPage] = useState(0);
    const lanes = useMemo(() => {
        const related = recording.entities.filter(entity => entity.id === selected.id || showConnections && (entity.source === selected.id || entity.sink === selected.id || entity.id === selected.source || entity.id === selected.sink));
        const rows: EvidenceLane[] = [];
        const styles = itemChartStyles(recording.entities.flatMap(entity => entity.items));
        for (const entity of related) {
            for (const series of entity.signals) {
                if (series.id === 'hand-item') continue;
                if (!timelineSignalVisible(entity, series, view, groups)) continue;
                // The products lane below provides the total; keep the numeric production trace opt-in.
                if (series.id === 'produced' && !groups.includes('production')) continue;
                rows.push({ id: `${entity.id}/${series.id}`, entity, series,
                    label: series.item ? `${series.label} · ${itemLabel(series.item)}` : series.label, color: series.item ? styles.get(series.item)?.color ?? '#56B4E9' : entity.type === 'inserter' ? BELT_CHART.entity.inserter : '#56B4E9', unit: series.unit });
            }
            if ((groups.includes('transfers') || view === 'transfers') && view !== 'states') {
                if (entity.type === 'machine') {
                    const productEvents = recording.events.filter(event => event.entity_id === entity.id && event.kind === 'produce');
                    const products = new Set([...productEvents, ...entity.signals.filter(signal => signal.id === 'produced')].flatMap(event => event.item ? [event.item] : []));
                    for (const item of products) rows.push({ id: `${entity.id}/products/${item}`, entity, label: 'Products made', production: true, item,
                        color: styles.get(item)?.color ?? '#56B4E9', series: entity.signals.find(signal => signal.id === 'produced' && signal.item === item),
                        events: productEvents.filter(event => event.item === item) });
                } else {
                    const events = recording.events.filter(event => event.entity_id === entity.id && ['pickup', 'drop'].includes(event.kind));
                    if (events.length) rows.push({ id: `${entity.id}/events`, entity, label: 'Pickups ◆ / deliveries ●', color: '#56B4E9', itemStyles: styles, events });
                }
            }
        }
        if (view === 'activity' && groups.includes('throughput')) {
            const events = recording.events.filter(event => event.kind === 'drop' && (event.entity_id === selected.id || event.source === selected.id || event.sink === selected.id));
            for (const item of [...new Set(events.flatMap(event => event.item ? [event.item] : []))]) rows.push({
                id: `rate:${item}`, entity: selected, label: `Delivered · ${itemLabel(item)} · rolling 1 s`, color: styles.get(item)?.color ?? '#56B4E9',
                series: deliveryRateSeries(events, item, recording.end_tick),
            });
        }
        return rows;
    }, [recording, selected, groups, view, showConnections, itemLabel]);
    const scaledLanes = useMemo(() => lanes.map(lane => {
        const maximum = (series?: TimelineSeries) => !lane.production && series && !['state', 'enabled'].includes(series.unit)
            ? Math.max(series.limit ?? 0, ...timelinePoints(series, range, 300).map(point => point.value), 1) : 1;
        return { ...lane, ceiling: maximum(lane.series) };
    }), [lanes, range]);
    const pageCount = Math.max(1, Math.ceil(lanes.length / 12)), shownPage = Math.min(page, pageCount - 1);
    const legend = useMemo(() => {
        const states = new Set<string>();
        for (const lane of scaledLanes.slice(shownPage * 12, (shownPage + 1) * 12)) {
            const series = lane.series, end = recording.end_tick;
            if (series?.id !== 'state' || series.unit !== 'state' || end < range.start) continue;
            const first = Math.max(0, upperBound(series.ticks, range.start) - 1);
            const last = upperBound(series.ticks, Math.min(range.end, end));
            for (let i = first; i < last; i++) states.add(String(series.values[i]));
        }
        return [...states].map(state => ({ state, label: timelineStateLabel(state), ...timelineStateStyle(state) }));
    }, [scaledLanes, shownPage, recording.end_tick, range]);
    const hasProduction = scaledLanes.some(lane => lane.production);
    const marks = axisTicks(range.end - range.start, 5);
    const valueText = (series: TimelineSeries, end: number) => {
        if (tick > end) return 'Outside recorded span';
        const value = timelineValueAt(series, tick);
        if (series.unit === 'state') return timelineStateLabel(String(value));
        if (series.unit === 'enabled') return Number(value) ? 'Enabled' : 'Disabled';
        return `${formatNumberText(Number(value), { maxDecimals: 2 })}${series.unit === '%' ? '%' : ` ${series.unit}`}`;
    };
    return <Box data-timeline-evidence sx={{ color: 'text.primary', minWidth: 0 }}>
        <Typography variant="body2" component="p" sx={{ mb: 1 }}>
            Charts show one modelled copy. Whole-build rates above cover {formatNumberText(recording.copies)} {recording.copies === 1 ? 'copy' : 'copies'}.
            {hasProduction && ' +N means items made in the marked span; totals run from tick 0 to the selected tick.'}
        </Typography>
        {legend.length > 0 && <Box component="ul" aria-label="State legend" sx={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', p: 0, m: 0, mb: 1, gap: 1.5 }}>
            {legend.map(state => <Box component="li" key={state.state} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}><ChartSwatch color={state.color} pattern={state.pattern} /><Typography variant="caption">{state.label}</Typography></Box>)}
        </Box>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px minmax(0, 1fr)' }, columnGap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>Game ticks · seconds</Typography>
            <BeltChartSurface><Box aria-hidden sx={{ position: 'relative', height: 38, borderBottom: 1, borderColor: 'divider' }}>
                {marks.map(mark => {
                    const fraction = mark / (range.end - range.start), actual = range.start + mark;
                    return <Box key={mark} sx={{ position: 'absolute', left: `${fraction * 100}%`, transform: fraction > 0.85 ? 'translateX(-100%)' : fraction > 0 ? 'translateX(-50%)' : undefined, whiteSpace: 'nowrap' }}>
                        <Typography variant="caption" component="div">{formatNumberText(actual, { maxDecimals: 1 })} t</Typography>
                        <Typography variant="caption" component="div" color="text.secondary">{formatNumberText(actual / 60, { maxDecimals: 2 })} s</Typography>
                    </Box>;
                })}
            </Box></BeltChartSurface>
        </Box>
        {scaledLanes.slice(shownPage * 12, (shownPage + 1) * 12).map(lane => <Box key={lane.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px minmax(0, 1fr)' }, columnGap: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ minWidth: 0 }}>
                {showConnections && <Typography variant="caption" color="text.secondary" component="div">{timelineEntityName(lane.entity, recipeLabel)}</Typography>}
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflowWrap: 'anywhere' }}>{(lane.item ?? lane.series?.item) && <FactorioIcon name={(lane.item ?? lane.series?.item)!} size={18} alt="" />}{lane.label}{lane.production && lane.item ? ` · ${itemLabel(lane.item)}` : ''}</Typography>
                {lane.series && <Typography variant="caption" component="div">{lane.production && tick <= recording.end_tick ? 'Total by selected tick · ' : ''}{valueText(lane.series, recording.end_tick)}{lane.series.limit !== undefined ? ` · threshold ${formatNumberText(lane.series.limit)}` : ''}</Typography>}
                {lane.series && !lane.production && !['state', 'enabled'].includes(lane.series.unit) && <Typography variant="caption" color="text.secondary" component="div">Scale 0–{formatNumberText(lane.ceiling, { maxDecimals: 2 })} {lane.series.unit}</Typography>}
            </Box>
            <BeltChartSurface sx={{ position: 'relative', alignSelf: 'center' }}>
                <EvidenceCanvas lane={lane} range={range} end={recording.end_tick}
                    height={lane.production ? 32 : lane.events || lane.series?.unit === 'state' || lane.series?.unit === 'enabled' ? 26 : 68}
                    onTick={value => onInspect ? onInspect(lane.entity.id, value) : onTick(value)} onRange={onRange} onZoom={onZoom} />
                {tick >= range.start && tick <= range.end && <Box aria-hidden sx={{ pointerEvents: 'none', position: 'absolute', top: 0, bottom: 0, left: `${(tick - range.start) / (range.end - range.start) * 100}%`, borderLeft: '1px solid #ffa600', '@media (forced-colors: active)': { borderColor: 'Highlight' } }} />}
            </BeltChartSurface>
        </Box>)}
        {lanes.length === 0 && <Typography variant="body2" sx={{ p: 2 }}>{selected.type === 'belt' ? recording.entities.some(entity => entity.source === selected.id || entity.sink === selected.id) ? 'No matching signals were recorded for connected inserters. Choose State or Products made & deliveries in Signals to view their activity.' : 'No recorded inserters are connected to this belt.' : 'No selected signals were recorded for this entity. Choose another signal group or inspect a connected entity.'}</Typography>}
        {pageCount > 1 && <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
            <Button color="inherit" size="small" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>Previous signals</Button>
            <Typography variant="caption">{shownPage + 1} / {pageCount}</Typography>
            <Button color="inherit" size="small" disabled={shownPage + 1 === pageCount} onClick={() => setPage(shownPage + 1)}>Next signals</Button>
        </Box>}
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Inventories are step changes. Production labels show items made; nearby events are grouped when zoomed out. ◆ pickup · ● delivery. Tap to inspect; drag to zoom, Shift-drag to pan, Ctrl-wheel to zoom.
        </Typography>
    </Box>;
}
