import { describe, expect, it } from 'vitest';
import { AA, contrastRatio } from './contrast';
import { appTheme } from './theme';
import { ROLE } from './tokens';

const { palette } = appTheme;
const ROLES = ['primary', 'secondary', 'success', 'warning', 'error', 'info'] as const;

describe('appTheme', () => {
    it.each(ROLES)('writes %s buttons and chips in text that reads on every shade of the fill', (role) => {
        const color = palette[role];
        for (const shade of [color.main, color.light, color.dark]) {
            expect(contrastRatio(color.contrastText, shade), `${role} ${shade}`).toBeGreaterThanOrEqual(AA.text);
        }
    });

    // a filled Alert is the role's dark shade, in MUI's own choice of text for the main shade; the info Alert is never
    // filled (4.28:1)
    it.each(ROLES.filter(role => role !== 'info'))('keeps a filled %s Alert\'s text at 4.5:1', (role) => {
        const color = palette[role];
        expect(contrastRatio(palette.getContrastText(color.main), color.dark)).toBeGreaterThanOrEqual(AA.text);
    });

    it('keeps 1.11\'s focus ring and removes no outline', () => {
        const components = JSON.stringify(appTheme.components);
        expect(components).not.toMatch(/"outline":\s*("none"|0)/);
        const buttonBase = appTheme.components?.MuiButtonBase?.styleOverrides?.root as Record<string, { outline: string }>;
        expect(buttonBase['&.Mui-focusVisible'].outline).toBe(`2px solid ${ROLE.orange.main}`);
    });
});

