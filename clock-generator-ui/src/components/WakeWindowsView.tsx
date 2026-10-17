import type { Theme } from '@mui/material/styles';
import { themeTokens } from '../theme/runtimeTokens';
import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TimelineRange } from '../utils/timelineInspection';
import { useAnnounce } from '../hooks/useMessages';
import type { ClockAlternativeView } from '../worker/types';
import { buildWakeWindowRows, mostWokenRowId, sumWakeUps, wakeUpsCounted } from '../utils/wakeWindows';
import {
    KEYBOARD_HINT,
    BELT_SLACK_EXPLANATION,
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
    SLACK_BACKGROUND_FORCED,
    WakeWindowsChart,
} from './WakeWindowsChart';
import { WakeWindowsTable } from './WakeWindowsTable';
import { BeltChartFrame, ChartSwatch } from './BeltChart';
import { BELT_CHART } from '../theme/beltCharts';
import type { Config } from 'clock-generator/browser';
import { configToFormData } from '../utils/configForm/configMapping';
import { entityOptionsOf } from '../utils/inserterOptions';
import { useGameNames } from '../hooks/useGameNames';

interface WakeWindowsViewProps {
    cycleView?: boolean;
    config?: Config | null;
    inspection?: { range: TimelineRange; tick: number; onInspect(entityId: string, tick: number): void };
    asTable: boolean;
    onAsTableChange(asTable: boolean): void;
    /** The selected clock; nothing is shown without one */
    alternative: ClockAlternativeView | null;
    /** A card inside Results by default */
    headingLevel?: 'h2' | 'h3';
}

/** The shape each mark of the chart has, so the legend tells them apart without colour */
function LegendSwatch({ kind }: { kind: 'window' | 'slack' | 'selected' | 'track' }) {
    // in forced colours, the system colours the chart uses (see FORCED_COLORS)
    const base = { width: 28, height: 12, boxSizing: 'border-box', flexShrink: 0, forcedColorAdjust: 'none' } as const;
    const solid = { bgcolor: BELT_CHART.entity.inserter, border: '1px solid', borderColor: 'text.secondary', [FORCED_COLORS]: { bgcolor: 'CanvasText' } } as const;
    switch (kind) {
        case 'window':
            return <Box aria-hidden sx={{ ...base, ...solid }} />;
        case 'slack':
            return (
                <Box
                    aria-hidden
                    sx={{
                        ...base,
                        background: `repeating-linear-gradient(45deg, ${BELT_CHART.entity.inserter} 0 3px, #000000 3px 6px)`,
                        border: '1px solid', borderColor: 'text.secondary',
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
                        outline: (theme: Theme) => `2px solid ${themeTokens(theme).control.focus}`,
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
            return <Box aria-hidden sx={{ ...base, border: (theme: Theme) => `1px solid ${themeTokens(theme).control.border}`, [FORCED_COLORS]: { borderColor: 'CanvasText' } }} />;
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
function WakeWindowsViewComponent({ alternative, config, cycleView = false, headingLevel = 'h3', asTable, onAsTableChange: setAsTable, inspection }: WakeWindowsViewProps) {
    const inspectionRef = useRef(inspection);
    useEffect(() => { inspectionRef.current = inspection; }, [inspection]);
    // keyed on the clock object, not its id: a new generation repeats the ids, and its selection must start empty
    const [selection, setSelection] = useState<{ alternative: ClockAlternativeView; rowId: string; windowIndex: number } | null>(null);
    const viewId = useId();
    const headingId = `${viewId}-title`;
    const hintId = useId();
    const { itemLabel, recipeLabel } = useGameNames();
    const options = useMemo(() => {
        if (!config) return [];
        const form = configToFormData(config);
        return entityOptionsOf(form.machines, form.belts, form.chests, { item: itemLabel, recipe: recipeLabel });
    }, [config, itemLabel, recipeLabel]);
    const rows = useMemo(() => (alternative ? buildWakeWindowRows(alternative, options) : []), [alternative, options]);
    const announce = useAnnounce();
    // stable for the clock, so the chart's memoised rows only render again when their own selection changes
    const onSelect = useCallback((next: { rowId: string; windowIndex: number } | null) => {
        setSelection(next === null || alternative === null ? null : { alternative, ...next });
        // the selected window is read out in the page's one announcements region
        const row = next === null ? undefined : rows.find(it => it.id === next.rowId);
        if (next !== null && row && alternative !== null && next.windowIndex < row.windows.length) {
            const window = row.windows[next.windowIndex];
            const inspection = inspectionRef.current;
            const visible = inspection && cycleView ? window.segments.find(segment => segment.end >= inspection.range.start && segment.start <= inspection.range.end) : undefined;
            // A wrapping or long window can start in a different cycle; inspect its visible part.
            inspection?.onInspect(row.id, visible ? Math.max(visible.start, inspection.range.start) : window.start);
            announce(selectionAnnouncement(row, next.windowIndex, alternative.simulationDurationTicks));
        }
    }, [alternative, rows, announce, cycleView]);

    if (alternative === null) {
        return null;
    }

    const periodTicks = alternative.simulationDurationTicks;
    // a selection belongs to the clock it was made on, so another clock starts with none
    const selectedRow = selection !== null && selection.alternative === alternative
        ? rows.find(row => row.id === selection.rowId && selection.windowIndex < row.windows.length)
        : undefined;
    const selected = selectedRow && selection ? { rowId: selection.rowId, windowIndex: selection.windowIndex } : null;
    const counted = wakeUpsCounted(alternative);
    const mostWakeUpsId = mostWokenRowId(rows);
    const summary = summaryText({
        periodTicks,
        inserters: rows.filter(row => row.kind === 'inserter').length,
        drills: rows.filter(row => row.kind === 'drill').length,
        wakeUps: counted ? alternative.asBuilt?.wake_ups?.wake_ups_per_minute ?? sumWakeUps(rows) : null,
    });

    return (
        <BeltChartFrame id={viewId} title={cycleView ? 'Wake windows in this crafting cycle' : VIEW_HEADING} level={headingLevel} subtitle={summary} data-wake-view="">
            {!counted && (
                <Typography variant="body2" color="text.secondary" data-wake-not-counted>
                    {`${NOT_COUNTED_NOTE}. ${NOT_COUNTED_REASON}`}
                </Typography>
            )}

            {!cycleView && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1, mt: 1.5 }}>
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
            </Box>}

            <Box sx={{ mt: 1, mb: 1 }}>
                {!asTable && (
                    <Box
                        component="ul"
                        aria-label={LEGEND_LABEL}
                        sx={{
                            listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5,
                        }}
                        data-wake-legend
                    >
                        {rows.some(row => row.kind === 'drill') && <Typography component="li" variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><ChartSwatch color={BELT_CHART.entity.drill} />Drill wake window</Typography>}
                        {LEGEND.map(item => (
                            <Typography
                                key={item.kind}
                                component="li"
                                variant="body2"
                                color="text.secondary"
                                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                            >
                                <LegendSwatch kind={item.kind} />
                                {cycleView && item.kind === 'track' ? 'One crafting cycle' : item.text}
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
                            Select a window for details. Use ↑ ↓ to change rows and ← → to step through windows.
                        </Typography>
                        {rows.some(row => row.windows.some(window => window.slackTicks > 0)) && <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                            {BELT_SLACK_EXPLANATION}
                        </Typography>}
                        <WakeWindowsChart
                            range={inspection?.range}
                            tick={inspection?.tick}
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
            <Box component="details" sx={{ mt: 1.5 }}>
                <Typography component="summary" variant="body2" color="text.secondary" sx={{ cursor: 'pointer' }}>Reading this chart</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{cycleView ? 'The selected crafting cycle is one segment of the clock period. Wake windows are clipped to this segment; row percentages and wake-ups/min describe the whole clock period.' : VIEW_INTRO}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{KEYBOARD_HINT}</Typography>
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


            </Box>
        </BeltChartFrame>
    );
}

export function WakeWindowsView(props: WakeWindowsViewProps) {
    return <WakeWindowsViewComponent {...props} />;
}
