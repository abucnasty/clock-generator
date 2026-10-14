import type { Theme, ThemeOptions } from '@mui/material/styles';

/**
 * The theme's accessibility rules, added to the base theme in `App.tsx`: a visible 2px focus ring in the brand colour
 * on every control reached with the keyboard (WCAG 2.4.7). The ring is drawn 2px outside the control, so it sits on the
 * dark surface around it and never on a filled button's own colour. Keeping the sticky header off the focused control
 * (2.4.11) is `useStickyHeaderHeight`'s job, which sets the page's `scroll-padding-top`.
 */
export function a11yThemeComponents(theme: Theme): ThemeOptions['components'] {
    const ring = { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 };
    // inside the item, so a scroll container or a full-width row does not clip the ring
    const insetRing = { '&.Mui-focusVisible': { outlineOffset: -2 } };
    return {
        MuiCssBaseline: {
            styleOverrides: {
                // what MUI does not draw itself: role="button" boxes such as the filter slots, the drag handle
                ':focus-visible': ring,
            },
        },
        MuiButtonBase: {
            styleOverrides: {
                // ButtonBase sets `outline: 0`, so it needs its own rule; this reaches Button, IconButton,
                // ToggleButton, a clickable Chip, Radio, Checkbox and Switch
                root: { '&.Mui-focusVisible': ring },
            },
        },
        MuiTab: { styleOverrides: { root: insetRing } },
        MuiAccordionSummary: { styleOverrides: { root: insetRing } },
        MuiMenuItem: { styleOverrides: { root: insetRing } },
        MuiAlert: {
            styleOverrides: {
                root: {
                    variants: [{
                        // the orange is too close to a filled alert's colour (1.55:1 on the yellow warning); a control
                        // in one takes the alert's own text colour, which is chosen to read on the fill. One class more
                        // than the rules above, so it wins whichever is inserted first
                        props: { variant: 'filled' },
                        style: {
                            '& .MuiButtonBase-root.Mui-focusVisible, & :focus-visible': { outlineColor: 'currentColor' },
                        },
                    }],
                },
            },
        },
    };
}
