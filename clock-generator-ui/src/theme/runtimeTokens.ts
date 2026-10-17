import type { Theme } from '@mui/material/styles';
import { tokensFor, type ThemeTokens } from './tokens';

/** Renderers used outside the app provider still follow their actual MUI palette mode. */
export function themeTokens(theme: Theme): ThemeTokens {
    return theme.factorio ?? tokensFor(theme.palette.mode);
}
