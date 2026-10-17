import { Button, FormControl, FormControlLabel, FormLabel, Popover, Radio, RadioGroup, Switch, Typography, Box } from '@mui/material';
import { useId, useState, type ReactElement } from 'react';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';

/** One browser-wide preference entry in the header; density and the resolved theme apply without replacing the page tree. */
export function DisplayPreferencesButton(): ReactElement {
    const { density, setDensity, scheme, setScheme } = useDisplayPreferences();
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
                <Typography variant="body2" color="text.secondary">Use less space for Configure and Results. Your build and clock stay the same.</Typography>
                <FormControl sx={{ mt: 2 }}>
                    <FormLabel id={`${id}-scheme`}>Color scheme</FormLabel>
                    <RadioGroup aria-labelledby={`${id}-scheme`} value={scheme} onChange={(_, value) => {
                        if (value === 'system' || value === 'light' || value === 'dark') setScheme(value);
                    }}>
                        <FormControlLabel value="system" control={<Radio size="small" />} label="System" />
                        <FormControlLabel value="light" control={<Radio size="small" />} label="Light" />
                        <FormControlLabel value="dark" control={<Radio size="small" />} label="Dark" />
                    </RadioGroup>
                </FormControl>
                <Typography variant="body2" color="text.secondary">System follows your device. Display choices apply to all your builds.</Typography>
            </Box>
        </Popover>
    </>;
}
