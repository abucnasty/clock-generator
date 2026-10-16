import { Button, FormControlLabel, Popover, Switch, Typography, Box } from '@mui/material';
import { useId, useState, type ReactElement } from 'react';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';

/** One browser-wide preference entry in the header; theme choices join it when themes are available. */
export function DisplayPreferencesButton(): ReactElement {
    const { density, setDensity } = useDisplayPreferences();
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const id = useId();
    return <>
        <Button color="inherit" size="small" aria-haspopup="dialog" aria-expanded={anchor !== null}
            aria-controls={anchor ? id : undefined} onClick={event => setAnchor(event.currentTarget)}>
            Display
        </Button>
        <Popover id={id} open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            <Box role="dialog" aria-label="Display preferences" sx={{ p: 2, maxWidth: 'min(320px, calc(100vw - 32px))' }}>
                <FormControlLabel label="Compact" control={<Switch checked={density === 'compact'}
                    onChange={(_, compact) => setDensity(compact ? 'compact' : 'explanatory')} />} />
                <Typography variant="body2" color="text.secondary">Use less space for Results. Your build and clock stay the same.</Typography>
            </Box>
        </Popover>
    </>;
}
