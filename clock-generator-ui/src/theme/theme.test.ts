import { describe, expect, it } from 'vitest';
import { AA, contrastRatio } from './contrast';
import { appTheme, createAppTheme } from './theme';
import { ROLE, SURFACE, TEXT, tokensFor } from './tokens';

const { palette } = appTheme;
const ROLES = ['primary', 'secondary', 'success', 'warning', 'error', 'info'] as const;

/** The style of the first variant that matches `props` exactly */
function variantStyle(component: 'MuiButton' | 'MuiIconButton', props: Record<string, string>) {
    const root = appTheme.components?.[component]?.styleOverrides?.root as { variants?: { props: Record<string, string>; style: Record<string, unknown> }[] };
    return root.variants?.find(variant => Object.entries(props).every(([key, value]) => variant.props[key] === value))?.style;
}

describe('appTheme', () => {
    it('takes its palette from the tokens', () => {
        expect(palette.primary.main).toBe(ROLE.orange.main);
        expect(palette.secondary.main).toBe(ROLE.green.main);
        expect(palette.success.main).toBe(ROLE.green.main);
        expect(palette.warning.main).toBe(ROLE.yellow.main);
        expect(palette.error.main).toBe(ROLE.red.main);
        expect(palette.info.main).toBe(ROLE.blue.main);
        expect(palette.background.default).toBe(SURFACE.page);
        expect(palette.background.paper).toBe(SURFACE.panel);
        expect(palette.text.primary).toBe(TEXT.primary);
        expect(palette.text.secondary).toBe(TEXT.secondary);
        expect(palette.text.disabled).toBe(TEXT.disabled);
    });

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

    it('keeps the square corners, squares the chips and turns the elevation overlay off', () => {
        expect(appTheme.shape.borderRadius).toBe(0);
        expect((appTheme.components?.MuiChip?.styleOverrides?.root as { borderRadius: number }).borderRadius).toBe(2);
        expect((appTheme.components?.MuiPaper?.styleOverrides?.root as { backgroundImage: string }).backgroundImage).toBe('none');
    });

    it('greys out a text button in the inherited colour (cancel) and a delete icon at rest', () => {
        expect(variantStyle('MuiButton', { variant: 'text', color: 'inherit' })?.color).toBe(TEXT.secondary);
        expect(variantStyle('MuiIconButton', { color: 'error' })?.color).toBe(TEXT.secondary);
    });

    it('writes danger words in the lighter red, which the palette also names error.light', () => {
        expect(palette.error.light).toBe(TEXT.error);
        const helper = appTheme.components?.MuiFormHelperText?.styleOverrides?.root as Record<string, { color: string }>;
        expect(helper['&.Mui-error'].color).toBe(TEXT.error);
        expect(variantStyle('MuiButton', { variant: 'text', color: 'error' })?.color).toBe(TEXT.error);
    });

    it('keeps 1.11\'s focus ring and removes no outline', () => {
        const components = JSON.stringify(appTheme.components);
        expect(components).not.toMatch(/"outline":\s*("none"|0)/);
        const buttonBase = appTheme.components?.MuiButtonBase?.styleOverrides?.root as Record<string, { outline: string }>;
        expect(buttonBase['&.Mui-focusVisible'].outline).toBe(`2px solid ${ROLE.orange.main}`);
    });
});

it('builds stable per-mode themes from the corresponding tokens', () => {
    const light = createAppTheme('light');
    expect(createAppTheme('light')).toBe(light);
    expect(createAppTheme('dark')).toBe(appTheme);
    expect(light.factorio).toEqual(tokensFor('light'));
    expect(light.palette.mode).toBe('light');
    expect(light.palette.background.paper).toBe(light.factorio.surface.panel);
    expect(light.palette.primary.main).toBe(light.factorio.role.orange.main);
    expect(light.palette.secondary.main).toBe(light.factorio.role.green.main);
    expect(light.palette.text.primary).toBe(light.factorio.text.primary);
});
