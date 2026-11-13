import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, alpha, useTheme } from '@mui/material';
import { useRef, type ReactNode } from 'react';
import type { OscillationFacts } from 'clock-generator/browser';
import { useElementWidth } from '../hooks/useElementWidth';
import { formatNumberText } from '../utils/numberText';
import { OUTPUT_CHART_COPY, offByText, outputChartOf, type OutputBar } from '../utils/outputChart';
import { Disclosure } from './Disclosure';

/** The width the chart is drawn at before the page has measured its place (and in a test, which has no layout) */
const UNMEASURED_WIDTH = 760;
/** The height of the tallest bar */
const PLOT_HEIGHT = 110;
/** Room above the tallest bar for its items, and below the bars for the window cycles */
const TOP = 18, BOTTOM = 18;
/** Room right of the bars for the expected output's label */
const LABEL_WIDTH = 78;

function Text({ x, y, fill, anchor = 'middle', children }: { x: number; y: number; fill: string; anchor?: 'start' | 'middle' | 'end'; children: ReactNode }) {
    return <text x={x} y={y} fontSize={11} fill={fill} textAnchor={anchor}>{children}</text>;
}

/** The bars, the expected output as a dashed line with its label, and the window cycles under the first, the last and every bar off it */
function Bars({ bars, expected, width, label }: { bars: OutputBar[]; expected: number; width: number; label: string }) {
    const theme = useTheme();
    const colours = { text: theme.palette.text.primary, muted: theme.palette.text.secondary, bar: alpha(theme.palette.text.primary, 0.35),
        off: theme.palette.error.light, expected: theme.palette.success.light };
    const right = width - LABEL_WIDTH;
    const pitch = right / bars.length;
    const gap = pitch > 6 ? 2 : pitch > 3 ? 1 : 0;
    const top = Math.max(expected, ...bars.map(bar => bar.items));
    const yOf = (items: number) => TOP + PLOT_HEIGHT - items / top * PLOT_HEIGHT;
    const parts: ReactNode[] = [];
    // the window cycles named under the bars: the first, the last and those off, where they do not run into the one before
    let lastEnd = -Infinity;
    bars.forEach((bar, index) => {
        const x = index * pitch, w = Math.max(0.5, pitch - gap), y = yOf(bar.items);
        parts.push(<rect key={`b-${bar.place}`} x={x} y={y} width={w} height={TOP + PLOT_HEIGHT - y} fill={bar.off ? colours.off : colours.bar}
            data-bar={bar.windowCycles} data-off={bar.off ? '' : undefined} />);
        if (bar.off) parts.push(<Text key={`v-${bar.place}`} x={x + w / 2} y={y - 4} fill={colours.text}>{formatNumberText(bar.items)}</Text>);
        const named = bar.off || index === 0 || index === bars.length - 1;
        const half = bar.windowCycles.length * 3.3;
        if (named && x + w / 2 - half > lastEnd + 3) {
            parts.push(<Text key={`n-${bar.place}`} x={x + w / 2} y={TOP + PLOT_HEIGHT + 13} fill={colours.muted}>{bar.windowCycles}</Text>);
            lastEnd = x + w / 2 + half;
        }
    });
    const line = yOf(expected);
    parts.push(<line key="expected" x1={0} y1={line} x2={right} y2={line} stroke={colours.expected} strokeWidth={1.5} strokeDasharray="6 5" />);
    parts.push(<Text key="expected-label" x={right + 6} y={line + 4} fill={colours.expected} anchor="start">{OUTPUT_CHART_COPY.expected(expected)}</Text>);
    const height = TOP + PLOT_HEIGHT + BOTTOM;
    return <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={label} style={{ display: 'block' }} data-output-chart="">{parts}</svg>;
}

/** The numbers of the chart, window cycle by window cycle, behind "Read this as text" */
function BarsTable({ bars, expected }: { bars: readonly OutputBar[]; expected: number }) {
    return <Table size="small" aria-label={OUTPUT_CHART_COPY.items} data-output-table="">
        <TableHead><TableRow>
            <TableCell>{OUTPUT_CHART_COPY.windowCycle}</TableCell>
            <TableCell align="right">{OUTPUT_CHART_COPY.items}</TableCell>
            <TableCell align="right">{OUTPUT_CHART_COPY.offBy}</TableCell>
        </TableRow></TableHead>
        <TableBody>
            {bars.map(bar => <TableRow key={bar.place}>
                <TableCell>{bar.windowCycles}</TableCell>
                <TableCell align="right" sx={{ fontWeight: bar.off ? 700 : 400 }}>{formatNumberText(bar.items)}</TableCell>
                <TableCell align="right">{offByText(bar, expected)}</TableCell>
            </TableRow>)}
        </TableBody>
    </Table>;
}

/**
 * The output of each window cycle of the run the engine judged, for a clock whose status is Oscillates: a bar for each, those
 * off the expected output in red with their items above them, and the expected output as a labelled line. The numbers stand
 * behind "Read this as text". Where the engine kept only the highest and the lowest window cycle, they are said in words.
 */
export function OutputChart({ facts, copies }: { facts: OscillationFacts; copies: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const measured = useElementWidth(ref);
    const width = measured > 0 ? measured : UNMEASURED_WIDTH;
    const chart = outputChartOf(facts);
    const oneCopy = copies > 1 ? OUTPUT_CHART_COPY.oneCopy : '';
    return <Box ref={ref} component="figure" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }} data-oscillation="">
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{OUTPUT_CHART_COPY.title(facts.proven, facts.window_cycles_per_bin)}</Typography>
        {chart.kind === 'bars' ? <>
            <Bars bars={chart.bars} expected={chart.expected} width={width} label={OUTPUT_CHART_COPY.label(chart.bars.length, chart.expected, chart.bars.filter(bar => bar.off))} />
            <Typography component="figcaption" variant="caption" color="text.secondary">{OUTPUT_CHART_COPY.caption(chart.tolerance)}{oneCopy}</Typography>
            <Disclosure summary={OUTPUT_CHART_COPY.readAsText} sx={{ borderTop: 1, borderColor: 'divider', pt: 0.5 }} data-read-as-text="">
                <BarsTable bars={chart.bars} expected={chart.expected} />
            </Disclosure>
        </> : <Typography component="figcaption" variant="body2">{OUTPUT_CHART_COPY.cut(chart.windowCycles, chart.highest, chart.lowest)}{oneCopy}</Typography>}
    </Box>;
}
