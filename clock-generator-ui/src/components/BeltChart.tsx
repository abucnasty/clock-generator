import { Box, ThemeProvider, Typography, createTheme, type SxProps, type Theme } from '@mui/material';
import { useId, type ReactNode } from 'react';
import { createAppTheme } from '../theme/theme';
import { BELT_CHART, patternBackground, type ChartPattern } from '../theme/beltCharts';
import { axisTicks } from '../utils/wakeWindows';
import { axisMarkText } from '../utils/wakeWindowCopy';

const base = createAppTheme('dark');
const chartTheme = createTheme(base, {
    palette: { background: { paper: BELT_CHART.background, default: BELT_CHART.background }, text: { secondary: BELT_CHART.muted }, divider: BELT_CHART.grid },
    factorio: { ...base.factorio, surface: { ...base.factorio.surface, panel: BELT_CHART.background, titleBar: BELT_CHART.background, row: BELT_CHART.row, inset: BELT_CHART.background } },
});

/** Scope the fixed chart palette to plotted data; surrounding UI inherits the application theme. */
export function BeltChartSurface({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
    return <ThemeProvider theme={chartTheme}><Box data-chart-plot="" sx={[
        { bgcolor: BELT_CHART.background, color: BELT_CHART.text, minWidth: 0,
            '@media (forced-colors: active)': { bgcolor: 'Canvas', color: 'CanvasText' } },
        ...(Array.isArray(sx) ? sx : [sx]),
    ]}>{children}</Box></ThemeProvider>;
}

export function BeltChartFrame({ title, subtitle, id, level = 'h3', children, ...data }: {
    title: string; subtitle: ReactNode; id?: string; level?: 'h2' | 'h3'; children: ReactNode;
    [attribute: `data-${string}`]: string | undefined;
}) {
    const madeId = useId();
    const titleId = `${id ?? madeId}-title`;
    return <Box component="section" aria-labelledby={titleId} data-belt-chart="" {...data}
        sx={{ bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider', p: { xs: 1.5, sm: 2.5 }, minWidth: 0,
            fontVariantNumeric: 'tabular-nums', '& .MuiTypography-root': { fontFamily: 'inherit' },
            '@media (forced-colors: active)': { bgcolor: 'Canvas', color: 'CanvasText', borderColor: 'CanvasText' } }}>
        <Box component="header" sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <Typography id={titleId} component={level} sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{title}</Typography>
            <Typography variant="caption" component="div" color="text.secondary">{subtitle}</Typography>
        </Box>
        {children}
    </Box>;
}

export function TimelineAxis({ duration, marks = axisTicks(duration, 7), startTick = 0 }: { duration: number; marks?: number[]; startTick?: number }) {
    return <Box aria-hidden sx={{ height: 42, position: 'relative', borderBottom: 1, borderColor: 'divider' }}>
        {marks.map(tick => {
            const fraction = duration > 0 ? tick / duration : 0;
            const text = axisMarkText(tick + startTick);
            return <Box key={tick} sx={{ position: 'absolute', left: `${fraction * 100}%`, transform: fraction === 0 ? undefined : fraction > 0.85 ? 'translateX(-100%)' : 'translateX(-50%)', whiteSpace: 'nowrap' }}>
                <Typography variant="caption" component="div" sx={{ color: 'text.primary', lineHeight: 1.5 }}>{text.ticks}</Typography>
                <Typography variant="caption" component="div" color="text.secondary" sx={{ fontSize: 11 }}>{text.seconds}</Typography>
            </Box>;
        })}
    </Box>;
}

export function ChartSwatch({ color, pattern = 'solid', sx }: { color: string; pattern?: ChartPattern; sx?: SxProps<Theme> }) {
    return <Box component="span" aria-hidden sx={[{ display: 'inline-block', width: 22, height: 12, flexShrink: 0, background: patternBackground({ color, pattern }), border: '1px solid', borderColor: 'text.secondary', borderRadius: 0 }, ...(Array.isArray(sx) ? sx : [sx])]} />;
}
