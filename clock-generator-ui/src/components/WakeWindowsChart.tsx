import { Box, Typography } from '@mui/material';
import { InfoOutlined, Loop, MoreTime, TimerOutlined, TrendingUp } from '@mui/icons-material';
import { Fragment, useCallback, useRef, useState, type ComponentType, type KeyboardEvent, type MouseEvent } from 'react';
import {
    axisTicks,
    drawnSpans,
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
/** Room kept below a focused row for the page's sticky footer */
const FOOTER_CLEARANCE_PX = 72;
const NUMBERS_COLUMN_PX = 150;

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

function Axis({ periodTicks, maxMarks }: { periodTicks: number; maxMarks: number }) {
    const marks = axisTicks(periodTicks, maxMarks);
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
                            sx={{
                                position: 'absolute',
                                left: percent(mark, periodTicks),
                                top: 0,
                                transform: `translateX(${shift})`,
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

interface TrackProps {
    row: WakeWindowRow;
    periodTicks: number;
    marks: number[];
    selectedIndex: number | null;
    onTap: (event: MouseEvent<HTMLElement>) => void;
}

function Track({ row, periodTicks, marks, selectedIndex, onTap }: TrackProps) {
    const words = modeText(row);
    if (words !== null) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ minHeight: TRACK_HEIGHT, display: 'flex', alignItems: 'center' }}>
                {words}
            </Typography>
        );
    }
    return (
        <Box
            data-wake-track
            onClick={onTap}
            sx={{
                position: 'relative',
                height: TRACK_HEIGHT,
                border: `1px solid ${WAKE_TRACK_COLOR}`,
                boxSizing: 'border-box',
                cursor: 'pointer',
                // in forced colours the bars' backgrounds would be painted over and vanish; keep the chart's own colours
                forcedColorAdjust: 'none',
            }}
        >
            {marks.filter(mark => mark > 0).map(mark => (
                <Box
                    key={mark}
                    aria-hidden
                    sx={{ position: 'absolute', top: 0, bottom: 0, left: percent(mark, periodTicks), width: '1px', bgcolor: GRID_COLOR }}
                />
            ))}
            {row.windows.map((window, index) => {
                const selected = index === selectedIndex;
                const spans = drawnSpans(window);
                return window.segments.map((segment, segmentIndex) => {
                    const length = segment.end - segment.start + 1;
                    const parts = spans.filter(span => span.start >= segment.start && span.end <= segment.end);
                    return (
                        <Box
                            key={`${index}-${segmentIndex}`}
                            aria-hidden
                            data-wake-bar
                            data-window-index={index}
                            data-selected={selected ? 'true' : undefined}
                            sx={{
                                position: 'absolute',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                left: `min(${percent(segment.start, periodTicks)}, calc(100% - ${MIN_BAR_PX}px))`,
                                width: `max(${MIN_BAR_PX}px, ${percent(length, periodTicks)})`,
                                height: selected ? SELECTED_BAR_HEIGHT : BAR_HEIGHT,
                                display: 'flex',
                                outline: selected ? `2px solid ${WAKE_SELECTED_COLOR}` : 'none',
                                outlineOffset: '2px',
                                zIndex: selected ? 1 : 0,
                            }}
                        >
                            {parts.map(part => (
                                <Box
                                    key={part.start}
                                    data-wake-slack={part.slack ? 'true' : undefined}
                                    sx={{
                                        flex: `${part.end - part.start + 1} 1 0`,
                                        minWidth: '1px',
                                        boxSizing: 'border-box',
                                        ...(part.slack
                                            ? { background: SLACK_BACKGROUND, border: `1px solid ${WAKE_BAR_COLOR}` }
                                            : { bgcolor: WAKE_BAR_COLOR }),
                                    }}
                                />
                            ))}
                        </Box>
                    );
                });
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

export interface WakeWindowsChartProps {
    rows: WakeWindowRow[];
    periodTicks: number;
    selected: { rowId: string; windowIndex: number } | null;
    /** A window of a row, or null to clear the selection */
    onSelect: (selection: { rowId: string; windowIndex: number } | null) => void;
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
    const trackWidth = wide ? width - LABEL_COLUMN_PX - NUMBERS_COLUMN_PX - 2 * 14 : width;
    const maxMarks = trackWidth >= 640 ? 10 : trackWidth >= 360 ? 6 : 4;
    const marks = axisTicks(periodTicks, maxMarks);
    const activeId = rows.some(row => row.id === activeRowId) ? activeRowId : rows[0]?.id ?? null;

    const focusRow = (rowId: string) => {
        setActiveRowId(rowId);
        rowElements.current.get(rowId)?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, rowIndex: number) => {
        if (event.target !== event.currentTarget) {
            return;
        }
        const row = rows[rowIndex];
        const current = selected?.rowId === row.id ? selected.windowIndex : null;
        const step = (key: 'next' | 'previous' | 'first' | 'last') => {
            const next = stepWindow(current, row.windows.length, key);
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
            case 'ArrowUp': {
                const target = rows[Math.min(rows.length - 1, Math.max(0, rowIndex + (event.key === 'ArrowDown' ? 1 : -1)))];
                if (target.id !== row.id) {
                    onSelect(null);
                    focusRow(target.id);
                }
                break;
            }
            case 'Escape':
                if (selected === null) {
                    return;
                }
                onSelect(null);
                break;
            default:
                return;
        }
        event.preventDefault();
    };

    const onTap = (event: MouseEvent<HTMLElement>, row: WakeWindowRow) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const tick = tickAtFraction((event.clientX - rect.left) / rect.width, periodTicks);
        const index = nearestWindowIndex(row.windows, tick, (TAP_TOLERANCE_PX / rect.width) * periodTicks);
        onSelect(index === null ? null : { rowId: row.id, windowIndex: index });
        setActiveRowId(row.id);
        rowElements.current.get(row.id)?.focus({ preventScroll: true });
    };

    const gridColumns = wide ? `${LABEL_COLUMN_PX}px minmax(0, 1fr) ${NUMBERS_COLUMN_PX}px` : 'minmax(0, 1fr) auto';
    const indent = wide ? `${LABEL_COLUMN_PX + 14}px` : 0;

    return (
        <Box ref={rootRef} role="group" aria-labelledby={props.labelledBy} aria-describedby={props.describedBy} data-wake-chart>
            <Box sx={{ display: 'grid', gridTemplateColumns: gridColumns, columnGap: 2 }}>
                <Box sx={{ gridColumn: wide ? '2' : '1 / -1' }}>
                    <Axis periodTicks={periodTicks} maxMarks={maxMarks} />
                </Box>
            </Box>
            {rows.map((row, rowIndex) => {
                const selectedIndex = selected?.rowId === row.id ? selected.windowIndex : null;
                return (
                    <Fragment key={row.id}>
                        <Box
                            ref={(element: HTMLElement | null) => {
                                if (element) {
                                    rowElements.current.set(row.id, element);
                                } else {
                                    rowElements.current.delete(row.id);
                                }
                            }}
                            role="group"
                            aria-label={rowSummary(row, periodTicks)}
                            tabIndex={row.id === activeId ? 0 : -1}
                            onKeyDown={event => onKeyDown(event, rowIndex)}
                            onFocus={event => {
                                if (event.target === event.currentTarget) {
                                    setActiveRowId(row.id);
                                }
                            }}
                            data-wake-row={row.id}
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: gridColumns,
                                gridTemplateAreas: wide ? '"label track numbers"' : '"label numbers" "track track"',
                                columnGap: 2,
                                rowGap: 0.5,
                                alignItems: 'center',
                                py: 0.75,
                                borderTop: 1,
                                borderColor: 'divider',
                                outline: 'none',
                                // the page's sticky footer would cover a row focused at the bottom of the window
                                scrollMarginBottom: FOOTER_CLEARANCE_PX,
                                '&:focus-visible': { outline: `2px solid ${WAKE_SELECTED_COLOR}`, outlineOffset: '2px' },
                            }}
                        >
                            <Box sx={{ gridArea: 'label', minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.label}</Typography>
                                {row.detail && (
                                    <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
                                        {row.detail}
                                    </Typography>
                                )}
                            </Box>
                            <Box sx={{ gridArea: 'track', minWidth: 0 }}>
                                <Track
                                    row={row}
                                    periodTicks={periodTicks}
                                    marks={marks}
                                    selectedIndex={selectedIndex}
                                    onTap={event => onTap(event, row)}
                                />
                            </Box>
                            <Box sx={{ gridArea: 'numbers', textAlign: 'right' }}>
                                <Typography variant="body2">{onForText(row.onShare)}</Typography>
                                <Typography variant="body2" color="text.secondary" data-wake-ups={row.wakeUpsPerMinute ?? ''}>
                                    {wakeUpsRowText(row)}
                                </Typography>
                            </Box>
                        </Box>
                        {selectedIndex !== null && (
                            <Box
                                data-wake-details
                                sx={{ ml: indent, mb: 1, pl: 1.5, py: 0.5, borderLeft: 2, borderColor: 'divider' }}
                            >
                                <Typography variant="body2">{windowDetails(row, selectedIndex, periodTicks)}</Typography>
                            </Box>
                        )}
                        <WatchNotes row={row} periodTicks={periodTicks} mostWakeUpsId={props.mostWakeUpsId} indent={indent} />
                    </Fragment>
                );
            })}
        </Box>
    );
}
