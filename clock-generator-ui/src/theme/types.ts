import type { ThemeTokens } from './tokens';

declare module '@mui/material/styles' {
    interface Theme { factorio: ThemeTokens }
    interface ThemeOptions { factorio?: ThemeTokens }
}
