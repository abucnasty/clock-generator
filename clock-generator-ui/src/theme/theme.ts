import './types';
import { createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import { a11yThemeComponents } from '../utils/a11yTheme';
import { tokensFor, type ResolvedColorScheme, type ThemeTokens } from './tokens';

/** A role of `tokens.ts` as an MUI palette colour, including the resolved text on its filled shades */
const paletteColor = ({ main, light, dark, on }: ThemeTokens['role'][keyof ThemeTokens['role']]) => ({ main, light, dark, contrastText: on });

/**
 * The Factorio look and the colour roles, on top of MUI's components: flat surfaces (each exactly its token), title bars,
 * square chips, quiet cancel and delete controls, and the control lines at 3:1
 */
function grammarComponents(theme: Theme): ThemeOptions['components'] {
    const { surface: SURFACE, role: ROLE, text: TEXT, control: CONTROL } = theme.factorio;
    const titleBand = { backgroundColor: SURFACE.titleBar };
    const edge = `1px solid ${CONTROL.edge}`;
    return {
        // the dark theme lightens every raised surface with a white gradient; off, so each surface is its token and every
        // contrast measured against the tokens is the one on screen
        MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
        MuiAppBar: {
            styleOverrides: {
                root: {
                    '--AppBar-background': SURFACE.bar,
                    '--AppBar-color': TEXT.primary,
                    backgroundColor: SURFACE.bar,
                    color: TEXT.primary,
                    borderBottom: `1px solid ${SURFACE.inset}`,
                },
            },
        },
        MuiDialog: { styleOverrides: { paper: { border: edge } } },
        MuiDialogTitle: {
            styleOverrides: {
                root: {
                    ...titleBand,
                    fontWeight: 600,
                    paddingTop: theme.spacing(1),
                    paddingBottom: theme.spacing(1),
                    borderBottom: `1px solid ${SURFACE.inset}`,
                },
            },
        },
        // MUI takes the content's top padding away under a title, which now has a band of its own
        MuiDialogContent: { styleOverrides: { root: { '.MuiDialogTitle-root + &': { paddingTop: theme.spacing(2) } } } },
        // menus are popovers too
        MuiPopover: { styleOverrides: { paper: { border: edge } } },
        MuiSnackbarContent: {
            styleOverrides: { root: { backgroundColor: SURFACE.panel, color: TEXT.primary, border: edge } },
        },
        MuiAccordion: {
            styleOverrides: {
                root: {
                    border: edge,
                    '&::before': { display: 'none' },
                },
                // the heading that holds the summary is the band too, so the title bar is the heading's own
                heading: { backgroundColor: SURFACE.titleBar },
            },
        },
        MuiAccordionSummary: {
            styleOverrides: {
                root: {
                    ...titleBand,
                    minHeight: 40,
                    '&.Mui-expanded': { minHeight: 40 },
                },
                content: { '&.Mui-expanded': { margin: '12px 0' } },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: 2,
                    variants: [
                        // a solid line at 3:1, where MUI draws a grey at 2.2:1, or the colour at 70%
                        { props: { variant: 'outlined', color: 'default' }, style: { borderColor: CONTROL.border } },
                        ...(['primary', 'secondary', 'success', 'warning', 'error', 'info'] as const).map(color => ({
                            props: { variant: 'outlined' as const, color },
                            style: { borderColor: theme.palette[color].main },
                        })),
                        // red words in the lighter red (TEXT.error), the line in the red
                        { props: { variant: 'outlined', color: 'error' }, style: { color: TEXT.error } },
                    ],
                },
            },
        },
        MuiToggleButton: {
            styleOverrides: {
                root: {
                    color: TEXT.secondary,
                    '&.Mui-selected, &.Mui-selected:hover': {
                        backgroundColor: ROLE.orange.main,
                        color: ROLE.orange.on,
                    },
                    '&.Mui-selected:hover': { backgroundColor: ROLE.orange.light },
                },
            },
        },
        MuiOutlinedInput: { styleOverrides: { notchedOutline: { borderColor: CONTROL.border } } },
        // a field's problem (1.4) and its label in the lighter red; the field's outline stays the red
        MuiFormHelperText: { styleOverrides: { root: { '&.Mui-error': { color: TEXT.error } } } },
        MuiFormLabel: { styleOverrides: { root: { '&.Mui-error': { color: TEXT.error } } } },
        MuiInputBase: { styleOverrides: { input: { '&::placeholder': { color: TEXT.secondary, opacity: 1 } } } },
        MuiButton: {
            styleOverrides: {
                root: {
                    variants: [
                        {
                            // the cancel look: Cancel, Close, Keep editing, Check only. In a message or alert, the
                            // action keeps the message's own text colour, which is chosen to read on it
                            props: { variant: 'text', color: 'inherit' },
                            style: {
                                color: TEXT.secondary,
                                '&:hover': { color: TEXT.primary },
                                '.MuiAlert-root &': { color: 'inherit' },
                            },
                        },
                        { props: { variant: 'outlined', color: 'inherit' }, style: { borderColor: CONTROL.border } },
                        // danger (Discard, Clear rule): words in the lighter red, 4.5:1 on every surface and when hovered
                        { props: { variant: 'text', color: 'error' }, style: { color: TEXT.error } },
                        { props: { variant: 'outlined', color: 'error' }, style: { color: TEXT.error } },
                    ],
                },
            },
        },
        MuiIconButton: {
            styleOverrides: {
                root: {
                    variants: [{
                        // red is danger, kept for when it is about to happen: every `color="error"` icon button (the
                        // delete icons) is grey at rest and red when hovered or focused
                        props: { color: 'error' },
                        style: {
                            color: TEXT.secondary,
                            '&:hover, &.Mui-focusVisible': { color: ROLE.red.main },
                        },
                    }],
                },
            },
        },
        MuiSwitch: {
            styleOverrides: {
                // an opaque track at 3:1 or more, off and on; a black thumb on the orange
                track: { backgroundColor: CONTROL.trackOff, opacity: 1 },
                thumb: { color: theme.palette.mode === 'light' ? '#ffffff' : TEXT.primary },
                switchBase: {
                    '&.Mui-checked .MuiSwitch-thumb': { color: ROLE.orange.on },
                    '&.Mui-checked + .MuiSwitch-track': { backgroundColor: ROLE.orange.main, opacity: 1 },
                    // a switch that is off-limits still looks it
                    '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.3 },
                    '&.Mui-disabled .MuiSwitch-thumb': { color: theme.palette.grey[600] },
                },
            },
        },
    };
}

function buildTheme(mode: ResolvedColorScheme): Theme {
    const tokens = tokensFor(mode);
    const { surface: SURFACE, role: ROLE, text: TEXT } = tokens;
    const base = createTheme({
        factorio: tokens,
        palette: {
            mode,
            // selection and accent: the selected toggle and tab, the focus ring, text actions such as "+ Add" and Undo
            primary: paletteColor(ROLE.orange),
            // confirm or commit: the one filled button of a state (Generate, Copy blueprint), Save, Import Selected
            secondary: paletteColor(ROLE.green),
            // the same green, for "ok" (the Valid chip, success messages)
            success: paletteColor(ROLE.green),
            // a lemon yellow, told apart from the brand orange at a glance; always with a warning icon and words
            warning: paletteColor(ROLE.yellow),
            // danger; light enough to read at 4.5:1 on a card and on the bar
            error: paletteColor(ROLE.red),
            // info alerts only
            info: paletteColor(ROLE.blue),
            background: {
                default: SURFACE.page,
                paper: SURFACE.panel,
            },
            text: { primary: TEXT.primary, secondary: TEXT.secondary, disabled: TEXT.disabled },
            common: {
                black: '#121212',
            },
        },
        typography: {
            fontFamily: '"Titillium Web", "Helvetica", "Arial", sans-serif',
            fontWeightMedium: 600,
        },
        shape: {
            borderRadius: 0,
        },
        spacing: (factor: number) => factor * 7,
    });

    // three steps, so that each set of components reads the palette above: 1.11's accessibility rules (the focus ring),
    // then the colour roles and shapes; `createTheme` merges them, so a component in both keeps the rules of each
    const withA11y = createTheme(base, { components: a11yThemeComponents(base) });

    /** The site's one theme */
    return createTheme(withA11y, { components: grammarComponents(withA11y) });
}

const themes = new Map<ResolvedColorScheme, Theme>();
/** Stable identity per resolved mode; preference changes never remount the provider's children. */
export function createAppTheme(mode: ResolvedColorScheme): Theme {
    let theme = themes.get(mode);
    if (!theme) { theme = buildTheme(mode); themes.set(mode, theme); }
    return theme;
}

/** Backward-compatible reference for existing dark-theme contract tests. */
export const appTheme = createAppTheme('dark');
