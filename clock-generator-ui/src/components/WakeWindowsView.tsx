import { Box, FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import { useCallback, useId, useMemo, useState } from 'react';
import type { ClockAlternativeView } from '../worker/types';
import { buildWakeWindowRows, mostWokenRowId, sumWakeUps, wakeUpsCounted } from '../utils/wakeWindows';
import {
    KEYBOARD_HINT,
    LEGEND_LABEL,
    LEGEND_SELECTED,
    LEGEND_SLACK,
    LEGEND_TRACK,
    LEGEND_WINDOW,
    NOT_COUNTED_NOTE,
    NOT_COUNTED_REASON,
    SHOW_AS_TABLE,
    TERMS,
    VIEW_HEADING,
    VIEW_INTRO,
    selectionAnnouncement,
    summaryText,
} from '../utils/wakeWindowCopy';
import {
    FORCED_COLORS,
    SLACK_BACKGROUND,
    SLACK_BACKGROUND_FORCED,
    WAKE_BAR_COLOR,
    WAKE_SELECTED_COLOR,
    WAKE_TRACK_COLOR,
    WakeWindowsChart,
} from './WakeWindowsChart';
import { WakeWindowsTable } from './WakeWindowsTable';

interface WakeWindowsViewProps {
    /** The selected clock; nothing is shown without one */
    alternative: ClockAlternativeView | null;
    /** A card inside Results by default */
    headingLevel?: 'h2' | 'h3';
}

const visuallyHidden = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    p: 0,
    m: '-1px',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
} as const;

/** The shape each mark of the chart has, so the legend tells them apart without colour */
function LegendSwatch({ kind }: { kind: 'window' | 'slack' | 'selected' | 'track' }) {
    // in forced colours, the system colours the chart uses (see FORCED_COLORS)
    const base = { width: 28, height: 12, boxSizing: 'border-box', flexShrink: 0, forcedColorAdjust: 'none' } as const;
    const solid = { bgcolor: WAKE_BAR_COLOR, [FORCED_COLORS]: { bgcolor: 'CanvasText' } } as const;
    switch (kind) {
        case 'window':
            return <Box aria-hidden sx={{ ...base, ...solid }} />;
        case 'slack':
            return (
                <Box
                    aria-hidden
                    sx={{
                        ...base,
                        background: SLACK_BACKGROUND,
                        border: `1px solid ${WAKE_BAR_COLOR}`,
                        [FORCED_COLORS]: { background: SLACK_BACKGROUND_FORCED, borderColor: 'CanvasText' },
                    }}
                />
            );
        case 'selected':
            return (
                <Box
                    aria-hidden
                    sx={{
                        p: '2px',
                        outline: `2px solid ${WAKE_SELECTED_COLOR}`,
                        outlineOffset: 0,
                        display: 'flex',
                        forcedColorAdjust: 'none',
                        [FORCED_COLORS]: { outlineColor: 'Highlight' },
                    }}
                >
                    <Box sx={{ ...base, ...solid, width: 24, height: 14 }} />
                </Box>
            );
        case 'track':
            return <Box aria-hidden sx={{ ...base, border: `1px solid ${WAKE_TRACK_COLOR}`, [FORCED_COLORS]: { borderColor: 'CanvasText' } }} />;
    }
}

const LEGEND: { kind: 'window' | 'slack' | 'selected' | 'track'; text: string }[] = [
    { kind: 'window', text: LEGEND_WINDOW },
    { kind: 'slack', text: LEGEND_SLACK },
    { kind: 'selected', text: LEGEND_SELECTED },
    { kind: 'track', text: LEGEND_TRACK },
];

/**
 * When the selected clock switches each inserter and drill on, over one clock period: a chart (or two tables) of
 * every wake window, with the wake-ups the engine counted for each inserter. Assumes no layout around it.
 */
export function WakeWindowsView({ alternative, headingLevel = 'h3' }: WakeWindowsViewProps) {
    const [asTable, setAsTable] = useState(false);
    // keyed on the clock object, not its id: a new generation repeats the ids, and its selection must start empty
    const [selection, setSelection] = useState<{ alternative: ClockAlternativeView; rowId: string; windowIndex: number } | null>(null);
    const headingId = useId();
    const hintId = useId();
    const rows = useMemo(() => (alternative ? buildWakeWindowRows(alternative) : []), [alternative]);
    // stable for the clock, so the chart's memoised rows only render again when their own selection changes
    const onSelect = useCallback((next: { rowId: string; windowIndex: number } | null) => {
        setSelection(next === null || alternative === null ? null : { alternative, ...next });
    }, [alternative]);

    if (alternative === null) {
        return null;
    }

    const periodTicks = alternative.simulationDurationTicks;
    // a selection belongs to the clock it was made on, so another clock starts with none
    const selectedRow = selection !== null && selection.alternative === alternative
        ? rows.find(row => row.id === selection.rowId && selection.windowIndex < row.windows.length)
        : undefined;
    const selected = selectedRow && selection ? { rowId: selection.rowId, windowIndex: selection.windowIndex } : null;
    const announcement = selected && selectedRow ? selectionAnnouncement(selectedRow, selected.windowIndex, periodTicks) : '';
    const counted = wakeUpsCounted(alternative);
    const mostWakeUpsId = mostWokenRowId(rows);
    const summary = summaryText({
        periodTicks,
        inserters: rows.filter(row => row.kind === 'inserter').length,
        drills: rows.filter(row => row.kind === 'drill').length,
        wakeUps: counted ? alternative.asBuilt?.wake_ups?.wake_ups_per_minute ?? sumWakeUps(rows) : null,
    });

    return (
        <Paper variant="outlined" sx={{ p: 2 }} data-wake-view>
            <Typography id={headingId} component={headingLevel} variant="h6">{VIEW_HEADING}</Typography>
            <Typography variant="body2" color="text.secondary">{VIEW_INTRO}</Typography>
            <Typography variant="body2" sx={{ mt: 1 }} data-wake-summary>{summary}</Typography>
            {!counted && (
                <Typography variant="body2" color="text.secondary" data-wake-not-counted>
                    {`${NOT_COUNTED_NOTE}. ${NOT_COUNTED_REASON}`}
                </Typography>
            )}

            <Box
                component="dl"
                sx={{ m: 0, mt: 1, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.25 }}
            >
                {TERMS.map(({ term, definition }) => (
                    <Box key={term} sx={{ display: 'contents' }}>
                        <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>{term}</Typography>
                        <Typography component="dd" variant="body2" color="text.secondary" sx={{ m: 0 }}>{definition}</Typography>
                    </Box>
                ))}
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1, mt: 1.5 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={asTable}
                            onChange={(_, checked) => {
                                setAsTable(checked);
                                setSelection(null);
                            }}
                        />
                    }
                    label={SHOW_AS_TABLE}
                    sx={{ mr: 0, minHeight: 32 }}
                />
                {!asTable && (
                    <Box
                        component="ul"
                        aria-label={LEGEND_LABEL}
                        sx={{
                            listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5,
                        }}
                        data-wake-legend
                    >
                        {LEGEND.map(item => (
                            <Typography
                                key={item.kind}
                                component="li"
                                variant="body2"
                                color="text.secondary"
                                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                            >
                                <LegendSwatch kind={item.kind} />
                                {item.text}
                            </Typography>
                        ))}
                    </Box>
                )}
            </Box>

            <Box sx={{ mt: 2 }}>
                {asTable ? (
                    <WakeWindowsTable rows={rows} periodTicks={periodTicks} mostWakeUpsId={mostWakeUpsId} />
                ) : (
                    <>
                        <Typography id={hintId} variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                            {KEYBOARD_HINT}
                        </Typography>
                        <WakeWindowsChart
                            rows={rows}
                            periodTicks={periodTicks}
                            selected={selected}
                            onSelect={onSelect}
                            mostWakeUpsId={mostWakeUpsId}
                            labelledBy={headingId}
                            describedBy={hintId}
                        />
                    </>
                )}
            </Box>

            {/* the one place the selected window is spoken; polite, and not a second role="status" */}
            <Box aria-live="polite" aria-atomic="true" sx={visuallyHidden} data-wake-live>{announcement}</Box>
        </Paper>
    );
}
