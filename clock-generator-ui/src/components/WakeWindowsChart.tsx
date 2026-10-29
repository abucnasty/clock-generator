import { BELT_CHART } from '../theme/beltCharts';
import { TimelineAxis } from './BeltChart';
import type { Theme } from '@mui/material/styles';
import { themeTokens } from '../theme/runtimeTokens';
import { Box, Typography } from '@mui/material';
import { BedtimeOutlined, Loop, MoreTime, TimerOutlined, ToggleOnOutlined, TrendingUp } from '@mui/icons-material';
import {
    memo,
    useCallback,
    useMemo,
    useRef,
    useState,
    type ComponentType,
    type KeyboardEvent,
    type MouseEvent,
} from 'react';
import { useElementWidth } from '../hooks/useElementWidth';
import { useGameNames } from '../hooks/useGameNames';
import {
    axisTicks,
    barsToDraw,
    nearestWindowIndex,
    stepWindow,
    tickAtFraction,
    type WakeWindowRow,
} from '../utils/wakeWindows';
import {
    modeText,
    BELT_SLACK_EXPLANATION,
    onShareText,
    rowSummary,
    wakeUpsRowText,
    watchNotes,
    windowDetails,
    type WatchNoteKind,
} from '../utils/wakeWindowCopy';
import { WakeRowMoves } from './WakeRowMoves';
import type { TimelineRange } from '../utils/timelineInspection';

// Colours of the chart, measured on the outlined Paper (#232323, no elevation overlay): see the 2.6 spec
/** A wake window (Wong sky blue), 6.81:1 */
export const WAKE_BAR_COLOR = '#56B4E9';
/** The outline of one clock period, 4.67:1 */
export const WAKE_TRACK_COLOR = '#8c8c8c';
/**
 * In forced colours the browser would paint over the bars' backgrounds and they would vanish, so the chart keeps its
 * own painting (`forced-color-adjust: none`) in the system's colours: bars, stripes and tracks in CanvasText, the
 * selection in Highlight
 */
export const FORCED_COLORS = '@media (forced-colors: active)';
export const SLACK_BACKGROUND_FORCED = 'repeating-linear-gradient(45deg, CanvasText 0 3px, transparent 3px 6px)';

const TRACK_HEIGHT = 32;
const BAR_HEIGHT = 16;
/** A selected bar is 6px taller */
const SELECTED_BAR_HEIGHT = BAR_HEIGHT + 6;
/** A 1-tick window is still drawn this wide; its true length is in the text */
const MIN_BAR_PX = 4;
/** A tap this close to a window selects it */
const TAP_TOLERANCE_PX = 12;
/** From this width of the chart the label, the track and the numbers sit side by side */
const WIDE_PX = 760;
const LABEL_COLUMN_PX = 206;
const NUMBERS_COLUMN_PX = 120;
const COLUMN_GAP_PX = 14;

const percent = (ticks: number, period: number) => `${(ticks / period) * 100}%`;

const trackSx = {
    position: 'relative',
    height: TRACK_HEIGHT,
    bgcolor: BELT_CHART.background,
    border: `1px solid ${WAKE_TRACK_COLOR}`,
    boxSizing: 'border-box',
    cursor: 'pointer',
    forcedColorAdjust: 'none',
    [FORCED_COLORS]: { bgcolor: 'Canvas', borderColor: 'CanvasText' },
} as const;
const gridLineSx = {
    position: 'absolute', top: 0, bottom: 0, width: '1px', bgcolor: BELT_CHART.grid, [FORCED_COLORS]: { bgcolor: 'GrayText' },
} as const;
const barSx = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    outlineOffset: '2px',
    '&[data-selected]': { outline: (theme: Theme) => `2px solid ${themeTokens(theme).control.focus}`, zIndex: 1 },
    [FORCED_COLORS]: { '&[data-selected]': { outlineColor: 'Highlight' } },
} as const;
const solidSx = {
    minWidth: '1px', boxSizing: 'border-box', bgcolor: 'var(--wake-color)', [FORCED_COLORS]: { bgcolor: 'CanvasText' },
} as const;
const slackSx = {
    minWidth: '1px',
    boxSizing: 'border-box',
    background: 'repeating-linear-gradient(135deg, var(--wake-color) 0 3px, #000000 3px 6px)',
    border: '1px solid var(--wake-color)',
    [FORCED_COLORS]: { background: SLACK_BACKGROUND_FORCED, borderColor: 'CanvasText' },
} as const;

interface TrackProps {
    range: TimelineRange;
    tick?: number;
    row: WakeWindowRow;
    periodTicks: number;
    marks: number[];
    selectedIndex: number | null;
    /** Ticks in one pixel of the track: windows narrower than that are merged in the drawing */
    ticksPerPx: number;
    onTap: (event: MouseEvent<HTMLElement>) => void;
}

function Track({ row, range, tick, marks, selectedIndex, ticksPerPx, onTap }: TrackProps) {
    const span = range.end - range.start;
    const words = modeText(row);
    if (words !== null) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ minHeight: TRACK_HEIGHT, display: 'flex', alignItems: 'center' }}>
                {words}
            </Typography>
        );
    }
    return (
        <Box data-wake-track onClick={onTap} sx={trackSx}>
            {marks.filter(mark => mark > 0).map(mark => (
                <Box key={mark} aria-hidden style={{ left: percent(mark, span) }} sx={gridLineSx} />
            ))}
            {barsToDraw(row.windows, ticksPerPx, selectedIndex).map(bar => {
                const start = Math.max(range.start, bar.start), end = Math.min(range.end, bar.end + 1);
                if (end <= start) return null;
                const selected = !bar.merged && bar.windowIndex === selectedIndex;
                return (
                    <Box
                        key={`${bar.windowIndex}-${bar.start}`}
                        aria-hidden
                        data-wake-bar
                        data-window-index={bar.windowIndex}
                        data-selected={selected ? 'true' : undefined}
                        style={{
                            left: `min(${percent(start - range.start, span)}, calc(100% - ${MIN_BAR_PX}px))`,
                            width: `max(${MIN_BAR_PX}px, ${percent(end - start, span)})`,
                            height: selected ? SELECTED_BAR_HEIGHT : BAR_HEIGHT,
                        }}
                        sx={barSx}
                    >
                        {bar.spans.filter(part => part.end + 1 > start && part.start < end).map(span => (
                            <Box
                                key={span.start}
                                data-wake-slack={span.slack ? 'true' : undefined}
                                style={{ flex: `${Math.min(end, span.end + 1) - Math.max(start, span.start)} 1 0` }}
                                sx={span.slack ? slackSx : solidSx}
                            />
                        ))}
                    </Box>
                );
            })}
            {tick !== undefined && tick >= range.start && tick <= range.end && <Box aria-hidden sx={{ pointerEvents: 'none', position: 'absolute', top: 0, bottom: 0, left: percent(tick - range.start, span), borderLeft: '1px solid #ffa600', [FORCED_COLORS]: { borderColor: 'Highlight' } }} />}
        </Box>
    );
}

/** An icon for each kind of note, so a note never rests on colour alone; the words carry the meaning */
const NOTE_ICONS: Record<WatchNoteKind, ComponentType<{ fontSize?: 'inherit'; 'aria-hidden'?: boolean }>> = {
    // a switch that is on, not an (i): that is the help control's look
    'mostly-on': ToggleOnOutlined,
    slack: MoreTime,
    short: TimerOutlined,
    wraps: Loop,
    'most-woken': TrendingUp,
    // asleep: on, and nothing wakes it
    'never-woken': BedtimeOutlined,
};

function WatchNotes(props: { row: WakeWindowRow; periodTicks: number; mostWakeUpsId: string | null; indent: string | number }) {
    const notes = watchNotes(props.row, { periodTicks: props.periodTicks, mostWakeUpsId: props.mostWakeUpsId }).filter(note => note.id !== 'slack');
    if (notes.length === 0) {
        return null;
    }
    return (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 1, ml: props.indent, p: 0 }} data-wake-notes={props.row.id}>
            {notes.map(note => {
                const Icon = NOTE_ICONS[note.id];
                return (
                    <Typography
                        key={note.id}
                        component="li"
                        variant="body2"
                        color="text.secondary"
                        sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', '& svg': { mt: '3px', flexShrink: 0 } }}
                    >
                        <Icon fontSize="inherit" aria-hidden />
                        <span>{note.text}</span>
                    </Typography>
                );
            })}
        </Box>
    );
}

type Selection = { rowId: string; windowIndex: number };

interface RowProps {
    range: TimelineRange;
    tick?: number;
    row: WakeWindowRow;
    rowIndex: number;
    periodTicks: number;
    marks: number[];
    ticksPerPx: number;
    /** The selected window, when it is in this row */
    selectedIndex: number | null;
    /** The row the chart's one tab stop is on */
    isActive: boolean;
    wide: boolean;
    mostWakeUpsId: string | null;
    onSelect: (selection: Selection | null) => void;
    /** Moves the tab stop and focus `delta` rows on */
    onMoveRow: (rowIndex: number, delta: number) => void;
    /** Makes this row the tab stop, and focuses it when asked */
    onActivate: (rowId: string, focus: boolean) => void;
    registerElement: (rowId: string, element: HTMLElement | null) => void;
}

const gridColumnsOf = (wide: boolean) => (wide ? `${LABEL_COLUMN_PX}px minmax(0, 1fr) ${NUMBERS_COLUMN_PX}px` : 'minmax(0, 1fr) auto');

/** One inserter or drill: its name, track and numbers, the details of its selected window, its notes */
const WakeWindowsRow = memo(function WakeWindowsRow(props: RowProps) {
    const { row, periodTicks, selectedIndex, onSelect } = props;
    const slackTicks = row.windows.reduce((max, window) => Math.max(max, window.slackTicks), 0);
    const { itemLabel } = useGameNames();
    const indent = props.wide ? `${LABEL_COLUMN_PX + COLUMN_GAP_PX}px` : 0;

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) {
            return;
        }
        const step = (key: 'next' | 'previous' | 'first' | 'last') => {
            const next = stepWindow(selectedIndex, row.windows.length, key);
            if (next !== null) {
                onSelect({ rowId: row.id, windowIndex: next });
            }
        };
        switch (event.key) {
            case 'ArrowRight':
                step('next');
                break;
            case 'ArrowLeft':
                step('previous');
                break;
            case 'Home':
                step('first');
                break;
            case 'End':
                step('last');
                break;
            case 'ArrowDown':
                props.onMoveRow(props.rowIndex, 1);
                break;
            case 'ArrowUp':
                props.onMoveRow(props.rowIndex, -1);
                break;
            default:
                return;
        }
        event.preventDefault();
    };

    const onTap = (event: MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const span = props.range.end - props.range.start;
        const tick = props.range.start + tickAtFraction((event.clientX - rect.left) / rect.width, span);
        const index = nearestWindowIndex(row.windows, tick, (TAP_TOLERANCE_PX / rect.width) * span);
        onSelect(index === null ? null : { rowId: row.id, windowIndex: index });
        props.onActivate(row.id, true);
    };

    const gridColumns = gridColumnsOf(props.wide);
    return (
        <>
            <Box
                ref={(element: HTMLElement | null) => props.registerElement(row.id, element)}
                role="group"
                aria-label={rowSummary(row, periodTicks, { mostWakeUpsId: props.mostWakeUpsId, itemLabel })}
                tabIndex={props.isActive ? 0 : -1}
                onKeyDown={onKeyDown}
                onFocus={event => {
                    if (event.target === event.currentTarget) {
                        props.onActivate(row.id, false);
                    }
                }}
                data-wake-row={row.id}
                sx={{
                    '--wake-color': BELT_CHART.entity[row.kind],
                    display: 'grid',
                    gridTemplateColumns: gridColumns,
                    gridTemplateAreas: props.wide ? '"label track numbers"' : '"label numbers" "track track"',
                    columnGap: `${COLUMN_GAP_PX}px`,
                    rowGap: 0.5,
                    alignItems: 'center',
                    py: 0.75,
                    borderTop: 1,
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'action.hover' },
                    outline: 'none',
                    '&:focus-visible': { outline: (theme: Theme) => `2px solid ${themeTokens(theme).control.focus}`, outlineOffset: '2px' },
                }}
            >
                <Box sx={{ gridArea: 'label', minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>{row.label}</Typography>
                        {slackTicks > 0 && <Typography component="span" variant="caption" color="text.secondary" title={BELT_SLACK_EXPLANATION}
                            aria-label={`${slackTicks} ticks of belt slack`} data-wake-slack>{`+${slackTicks} ${slackTicks === 1 ? 'tick' : 'ticks'}`}</Typography>}
                    </Box>
                    {(row.items.length > 0 || row.route) && (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
                            <WakeRowMoves row={row} />
                        </Typography>
                    )}
                </Box>
                <Box sx={{ gridArea: 'track', minWidth: 0 }}>
                    <Track
                        range={props.range}
                        tick={props.tick}
                        row={row}
                        periodTicks={periodTicks}
                        marks={props.marks}
                        selectedIndex={selectedIndex}
                        ticksPerPx={props.ticksPerPx}
                        onTap={onTap}
                    />
                </Box>
                <Box sx={{ gridArea: 'numbers', textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{onShareText(row.onShare)} on</Typography>
                    <Typography variant="caption" color="text.secondary" data-wake-ups={row.wakeUpsPerMinute ?? ''}>
                        {wakeUpsRowText(row)}
                    </Typography>
                </Box>
            </Box>
            {selectedIndex !== null && selectedIndex < row.windows.length && (
                <Box data-wake-details sx={{ ml: indent, mb: 1, pl: 1.5, py: 0.5, borderLeft: 2, borderColor: 'divider' }}>
                    <Typography variant="body2">{windowDetails(row, selectedIndex, periodTicks)}</Typography>
                </Box>
            )}
            <WatchNotes row={row} periodTicks={periodTicks} mostWakeUpsId={props.mostWakeUpsId} indent={indent} />
        </>
    );
});

interface WakeWindowsChartProps {
    range?: TimelineRange;
    tick?: number;
    rows: WakeWindowRow[];
    periodTicks: number;
    selected: Selection | null;
    /** A window of a row, or null to clear the selection; keep it stable, the rows are memoised */
    onSelect: (selection: Selection | null) => void;
    mostWakeUpsId: string | null;
    /** Id of the heading that names the chart */
    labelledBy: string;
    /** Id of the keyboard hint */
    describedBy: string;
}

/**
 * The wake windows of every row on one axis of one clock period. The chart is one tab stop: the rows are a roving
 * tabindex, Up and Down move between them, Left, Right, Home and End step through a row's windows, Escape clears.
 */
export function WakeWindowsChart(props: WakeWindowsChartProps) {
    const { rows, periodTicks, selected, onSelect } = props;
    const range = props.range ?? { start: 0, end: periodTicks };
    const span = range.end - range.start;
    const rootRef = useRef<HTMLDivElement>(null);
    const width = useElementWidth(rootRef);
    const [activeRowId, setActiveRowId] = useState<string | null>(null);
    const rowElements = useRef(new Map<string, HTMLElement>());

    const wide = width >= WIDE_PX;
    const trackWidth = wide ? width - LABEL_COLUMN_PX - NUMBERS_COLUMN_PX - 2 * COLUMN_GAP_PX : width;
    const maxMarks = trackWidth >= 640 ? 10 : trackWidth >= 360 ? 6 : 4;
    const marks = useMemo(() => axisTicks(span, maxMarks), [span, maxMarks]);
    // nothing is merged before the chart has been measured
    const ticksPerPx = trackWidth > 0 ? span / trackWidth : 0;
    const activeId = rows.some(row => row.id === activeRowId) ? activeRowId : rows[0]?.id ?? null;

    const registerElement = useCallback((rowId: string, element: HTMLElement | null) => {
        if (element) {
            rowElements.current.set(rowId, element);
        } else {
            rowElements.current.delete(rowId);
        }
    }, []);
    const onActivate = useCallback((rowId: string, focus: boolean) => {
        setActiveRowId(rowId);
        if (focus) {
            rowElements.current.get(rowId)?.focus({ preventScroll: true });
        }
    }, []);
    const onMoveRow = useCallback((rowIndex: number, delta: number) => {
        const target = rows[Math.min(rows.length - 1, Math.max(0, rowIndex + delta))];
        if (target && target.id !== rows[rowIndex]?.id) {
            onSelect(null);
            setActiveRowId(target.id);
            rowElements.current.get(target.id)?.focus();
        }
    }, [rows, onSelect]);

    return (
        <Box
            ref={rootRef}
            role="group"
            aria-labelledby={props.labelledBy}
            aria-describedby={props.describedBy}
            // Escape clears the selected window from anywhere in the chart, whichever row has the focus
            onKeyDown={event => {
                if (event.key === 'Escape' && selected !== null) {
                    onSelect(null);
                    event.preventDefault();
                    event.stopPropagation();
                }
            }}
            data-wake-chart
        >
            <Box sx={{ display: 'grid', gridTemplateColumns: gridColumnsOf(wide), columnGap: `${COLUMN_GAP_PX}px` }}>
                <Box sx={{ gridColumn: wide ? '2' : '1 / -1' }}>
                    <TimelineAxis duration={span} marks={marks} startTick={range.start} />
                </Box>
            </Box>
            {rows.map((row, rowIndex) => (
                <WakeWindowsRow
                        key={row.id}
                        row={row}
                        range={range}
                        tick={props.tick}
                        rowIndex={rowIndex}
                        periodTicks={periodTicks}
                        marks={marks}
                        ticksPerPx={ticksPerPx}
                        selectedIndex={selected?.rowId === row.id ? selected.windowIndex : null}
                        isActive={row.id === activeId}
                        wide={wide}
                        mostWakeUpsId={props.mostWakeUpsId}
                        onSelect={onSelect}
                        onMoveRow={onMoveRow}
                        onActivate={onActivate}
                        registerElement={registerElement}
                    />
            ))}
        </Box>
    );
}
