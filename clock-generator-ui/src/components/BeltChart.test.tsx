import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider, useTheme } from '@mui/material/styles';
import { createAppTheme } from '../theme/theme';
import { BeltChartFrame, BeltChartSurface } from './BeltChart';

function ThemeProbe({ name }: { name: string }) {
    const theme = useTheme();
    return <span data-probe={name} data-mode={theme.palette.mode} data-paper={theme.palette.background.paper} />;
}

it.each(['light', 'dark'] as const)('keeps %s app surfaces around an isolated black plot', mode => {
    const appTheme = createAppTheme(mode);
    const html = renderToStaticMarkup(<ThemeProvider theme={appTheme}>
        <BeltChartFrame title="Timeline" subtitle="One copy">
            <ThemeProbe name="controls" />
            <BeltChartSurface><ThemeProbe name="plot" /></BeltChartSurface>
            <ThemeProbe name="legend" />
        </BeltChartFrame>
    </ThemeProvider>);
    expect(html).toContain(`data-probe="controls" data-mode="${mode}" data-paper="${appTheme.palette.background.paper}"`);
    expect(html).toContain(`data-probe="legend" data-mode="${mode}" data-paper="${appTheme.palette.background.paper}"`);
    expect(html).toContain('data-probe="plot" data-mode="dark" data-paper="#000000"');
    expect(html).toContain('data-chart-plot=""');
});
