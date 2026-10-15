import { Box, Typography } from '@mui/material';
import { InfoOutlined, Loop, MoreTime, TimerOutlined, TrendingUp } from '@mui/icons-material';
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
    axisMarkText,
    modeText,
    onForText,
    periodEndText,
    rowSummary,
    wakeUpsRowText,
    watchNotes,
    windowDetails,
    type WatchNoteKind,
} from '../utils/wakeWindowCopy';
import { WakeRowMoves } from './WakeRowMoves';

// Colours of the chart, measured on the outlined Paper (#232323, no elevation overlay): see the 2.6 spec
/** A wake window (Wong sky blue), 6.81:1 */
export const WAKE_BAR_COLOR = '#56B4E9';
/** The outline of one clock period, 4.67:1 */
export const WAKE_TRACK_COLOR = '#8c8c8c';
/** The outline of the selected window: the theme's primary, 7.77:1 */
export const WAKE_SELECTED_COLOR = '#fca300';
/** Grid lines behind the rows; decorative, they repeat the axis marks */
const GRID_COLOR = 'rgba(255, 255, 255, 0.12)';
/** Belt slack: the bar's colour as 45° stripes, 3px on and 3px off */
export const SLACK_BACKGROUND = `repeating-linear-gradient(45deg, ${WAKE_BAR_COLOR} 0 3px, transparent 3px 6px)`;
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
const WIDE_PX = 900;
const LABEL_COLUMN_PX = 220;
const NUMBERS_COLUMN_PX = 150;
const COLUMN_GAP_PX = 14;

/** Width of an element, kept up to date */
function useWidth(): [(element: HTMLElement | null) => (() => void) | undefined, number] {
    const [width, setWidth] = useState(0);
    const ref = useCallback((element: HTMLElement | null) => {
        if (!element) {
            return undefined;
        }
        setWidth(element.getBoundingClientRect().width);
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, width];
}

const percent = (ticks: number, period: number) => `${(ticks / period) * 100}%`;

function Axis({ periodTicks, marks }: { periodTicks: number; marks: number[] }) {
    return (
        <Box aria-hidden sx={{ pb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ textAlign: 'right' }} data-wake-axis-end>
                {periodEndText(periodTicks)}
            </Typography>
            <Box sx={{ position: 'relative', height: 36 }}>
                {marks.map(mark => {
                    const fraction = mark / periodTicks;
                    const text = axisMarkText(mark);
                    // the first label starts at its mark, the ones near the end finish at theirs, the rest are centred on it
                    const shift = fraction === 0 ? '0' : fraction > 0.85 ? '-100%' : '-50%';
                    return (
                        <Box
                            key={mark}
                            data-wake-axis-mark
                            style={{ left: percent(mark, periodTicks), transform: `translateX(${shift})` }}
                            sx={{
                                position: 'absolute',
                                top: 0,
                                borderLeft: fraction === 0 ? '1px solid' : 'none',
                                borderColor: 'text.secondary',
                                pl: fraction === 0 ? 0.5 : 0,
                                whiteSpace: 'nowrap',
                            }}
                        >
                            <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.3 }}>
                                {text.ticks}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.3 }}>
                                {text.seconds}
                            </Typography>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

const trackSx = {
    position: 'relative',
    height: TRACK_HEIGHT,
    border: `1px solid ${WAKE_TRACK_COLOR}`,
    boxSizing: 'border-box',
    cursor: 'pointer',
    forcedColorAdjust: 'none',
    [FORCED_COLORS]: { borderColor: 'CanvasText' },
} as const;
const gridLineSx = {
    position: 'absolute', top: 0, bottom: 0, width: '1px', bgcolor: GRID_COLOR, [FORCED_COLORS]: { bgcolor: 'GrayText' },
} as const;
const barSx = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    outlineOffset: '2px',
    '&[data-selected]': { outline: `2px solid ${WAKE_SELECTED_COLOR}`, zIndex: 1 },
    [FORCED_COLORS]: { '&[data-selected]': { outlineColor: 'Highlight' } },
} as const;
const solidSx = {
    minWidth: '1px', boxSizing: 'border-box', bgcolor: WAKE_BAR_COLOR, [FORCED_COLORS]: { bgcolor: 'CanvasText' },
} as const;
const slackSx = {
    minWidth: '1px',
    boxSizing: 'border-box',
    background: SLACK_BACKGROUND,
    border: `1px solid ${WAKE_BAR_COLOR}`,
    [FORCED_COLORS]: { background: SLACK_BACKGROUND_FORCED, borderColor: 'CanvasText' },
} as const;

interface TrackProps {
    row: WakeWindowRow;
    periodTicks: number;
    marks: number[];
    selectedIndex: number | null;
    /** Ticks in one pixel of the track: windows narrower than that are merged in the drawing */
    ticksPerPx: number;
    onTap: (event: MouseEvent<HTMLElement>) => void;
}

function Track({ row, periodTicks, marks, selectedIndex, ticksPerPx, onTap }: TrackProps) {
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
                <Box key={mark} aria-hidden style={{ left: percent(mark, periodTicks) }} sx={gridLineSx} />
            ))}
            {barsToDraw(row.windows, ticksPerPx, selectedIndex).map(bar => {
                const selected = !bar.merged && bar.windowIndex === selectedIndex;
                return (
                    <Box
                        key={`${bar.windowIndex}-${bar.start}`}
                        aria-hidden
                        data-wake-bar
                        data-window-index={bar.windowIndex}
                        data-selected={selected ? 'true' : undefined}
                        style={{
                            left: `min(${percent(bar.start, periodTicks)}, calc(100% - ${MIN_BAR_PX}px))`,
                            width: `max(${MIN_BAR_PX}px, ${percent(bar.end - bar.start + 1, periodTicks)})`,
                            height: selected ? SELECTED_BAR_HEIGHT : BAR_HEIGHT,
                        }}
                        sx={barSx}
                    >
                        {bar.spans.map(span => (
                            <Box
                                key={span.start}
                                data-wake-slack={span.slack ? 'true' : undefined}
                                style={{ flex: `${span.end - span.start + 1} 1 0` }}
                                sx={span.slack ? slackSx : solidSx}
                            />
                        ))}
                    </Box>
                );
            })}
        </Box>
    );
}

/** An icon for each kind of note, so a note never rests on colour alone; the words carry the meaning */
const NOTE_ICONS: Record<WatchNoteKind, ComponentType<{ fontSize?: 'inherit'; 'aria-hidden'?: boolean }>> = {
    'mostly-on': InfoOutlined,
    slack: MoreTime,
    short: TimerOutlined,
    wraps: Loop,
    'most-woken': TrendingUp,
};

function WatchNotes(props: { row: WakeWindowRow; periodTicks: number; mostWakeUpsId: string | null; indent: string | number }) {
    const notes = watchNotes(props.row, { periodTicks: props.periodTicks, mostWakeUpsId: props.mostWakeUpsId });
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
        const tick = tickAtFraction((event.clientX - rect.left) / rect.width, periodTicks);
        const index = nearestWindowIndex(row.windows, tick, (TAP_TOLERANCE_PX / rect.width) * periodTicks);
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
                    display: 'grid',
                    gridTemplateColumns: gridColumns,
                    gridTemplateAreas: props.wide ? '"label track numbers"' : '"label numbers" "track track"',
                    columnGap: `${COLUMN_GAP_PX}px`,
                    rowGap: 0.5,
                    alignItems: 'center',
                    py: 0.75,
                    borderTop: 1,
                    borderColor: 'divider',
                    outline: 'none',
                    '&:focus-visible': { outline: `2px solid ${WAKE_SELECTED_COLOR}`, outlineOffset: '2px' },
                }}
            >
                <Box sx={{ gridArea: 'label', minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.label}</Typography>
                    {(row.items.length > 0 || row.route) && (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
                            <WakeRowMoves row={row} />
                        </Typography>
                    )}
                </Box>
                <Box sx={{ gridArea: 'track', minWidth: 0 }}>
                    <Track
                        row={row}
                        periodTicks={periodTicks}
                        marks={props.marks}
                        selectedIndex={selectedIndex}
                        ticksPerPx={props.ticksPerPx}
                        onTap={onTap}
                    />
                </Box>
                <Box sx={{ gridArea: 'numbers', textAlign: 'right' }}>
                    <Typography variant="body2">{onForText(row.onShare)}</Typography>
                    <Typography variant="body2" color="text.secondary" data-wake-ups={row.wakeUpsPerMinute ?? ''}>
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

export interface WakeWindowsChartProps {
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
    const [rootRef, width] = useWidth();
    const [activeRowId, setActiveRowId] = useState<string | null>(null);
    const rowElements = useRef(new Map<string, HTMLElement>());

    const wide = width >= WIDE_PX;
    const trackWidth = wide ? width - LABEL_COLUMN_PX - NUMBERS_COLUMN_PX - 2 * COLUMN_GAP_PX : width;
    const maxMarks = trackWidth >= 640 ? 10 : trackWidth >= 360 ? 6 : 4;
    const marks = useMemo(() => axisTicks(periodTicks, maxMarks), [periodTicks, maxMarks]);
    // nothing is merged before the chart has been measured
    const ticksPerPx = trackWidth > 0 ? periodTicks / trackWidth : 0;
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
                }
            }}
            data-wake-chart
        >
            <Box sx={{ display: 'grid', gridTemplateColumns: gridColumnsOf(wide), columnGap: `${COLUMN_GAP_PX}px` }}>
                <Box sx={{ gridColumn: wide ? '2' : '1 / -1' }}>
                    <Axis periodTicks={periodTicks} marks={marks} />
                </Box>
            </Box>
            {rows.map((row, rowIndex) => (
                <WakeWindowsRow
                        key={row.id}
                        row={row}
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
