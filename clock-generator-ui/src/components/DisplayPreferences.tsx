import { BrightnessAutoOutlined, DarkModeOutlined, LightModeOutlined, ViewAgendaOutlined, ViewCompactOutlined } from '@mui/icons-material';
import { Box, IconButton, Tooltip } from '@mui/material';
import type { ReactElement } from 'react';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';

/** Direct, browser-wide appearance controls in the toolbar. */
export function DisplayPreferencesButton(): ReactElement {
    const { density, setDensity, scheme, setScheme } = useDisplayPreferences();
    const compact = density === 'compact';
    const densityLabel = compact ? 'Compact' : 'Expanded';
    const nextDensityLabel = compact ? 'Expanded' : 'Compact';
    const nextScheme = scheme === 'light' ? 'dark' : scheme === 'dark' ? 'system' : 'light';
    const themeLabel = scheme === 'system' ? 'Auto' : scheme === 'dark' ? 'Dark' : 'Light';
    const nextLabel = nextScheme === 'system' ? 'Auto' : nextScheme === 'dark' ? 'Dark' : 'Light';
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <Tooltip title={`Theme: ${themeLabel}. Switch to ${nextLabel}${nextScheme === 'system' ? ' (follows your device)' : ''}`}>
            <IconButton size="small" aria-label={`Theme: ${themeLabel}. Switch to ${nextLabel}`} onClick={() => setScheme(nextScheme)}
                sx={{ color: 'text.secondary', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.75 }}>
                {scheme === 'system' ? <BrightnessAutoOutlined fontSize="small" /> : scheme === 'dark' ? <DarkModeOutlined fontSize="small" /> : <LightModeOutlined fontSize="small" />}
            </IconButton>
        </Tooltip>
        <Tooltip title={`View: ${densityLabel}. Switch to ${nextDensityLabel}`}>
            <IconButton size="small" aria-label={`View: ${densityLabel}. Switch to ${nextDensityLabel}`}
                onClick={() => setDensity(compact ? 'explanatory' : 'compact')}
                sx={{ color: 'text.secondary', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.75 }}>
                {compact ? <ViewCompactOutlined fontSize="small" /> : <ViewAgendaOutlined fontSize="small" />}
            </IconButton>
        </Tooltip>
    </Box>;
}
