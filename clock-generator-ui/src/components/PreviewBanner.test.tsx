// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../theme/theme';
import { PreviewBanner } from './PreviewBanner';

afterEach(() => vi.unstubAllGlobals());

/** `#rrggbb` or `rgb(r, g, b)` as three numbers, so the theme's hex and the page's computed colour compare */
function rgb(color: string): number[] {
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
    if (hex) return hex.slice(1).map(part => parseInt(part, 16));
    const functional = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(color.trim());
    if (functional) return functional.slice(1).map(Number);
    throw new Error(`not a colour: ${color}`);
}

describe('PreviewBanner', () => {
    it('shows the commit of the preview', () => {
        vi.stubGlobal('__PREVIEW_COMMIT__', 'abc1234');
        render(<PreviewBanner />);
        expect(screen.getByText('preview abc1234')).toBeTruthy();
    });

    it('shows nothing when the build has no commit', () => {
        vi.stubGlobal('__PREVIEW_COMMIT__', '');
        const { container } = render(<PreviewBanner />);
        expect(container.textContent).toBe('');
        expect(screen.queryByText(/preview/)).toBeNull();
    });

    it('shows nothing, and does not throw, when the define is missing', () => {
        vi.stubGlobal('__PREVIEW_COMMIT__', undefined);
        const { container } = render(<PreviewBanner />);
        expect(container.textContent).toBe('');
    });

    it.each(['light', 'dark'] as const)('takes its colours from the warning role of the %s theme', mode => {
        vi.stubGlobal('__PREVIEW_COMMIT__', 'abc1234');
        const theme = createAppTheme(mode);
        render(<ThemeProvider theme={theme}><PreviewBanner /></ThemeProvider>);
        const style = getComputedStyle(screen.getByText('preview abc1234'));
        expect(rgb(style.backgroundColor)).toEqual(rgb(theme.palette.warning.main));
        expect(rgb(style.color)).toEqual(rgb(theme.palette.warning.contrastText));
    });
});
