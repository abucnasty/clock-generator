import { Box, Checkbox, FormControlLabel, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DEFAULT_INSPECTION, SIGNAL_GROUPS, timelineSignalPreset, type TimelineSignalGroup } from '../utils/timelineInspection';

const LABELS: Record<TimelineSignalGroup, string> = {
    state: 'State', inventory: 'Ingredients & inventories', buffers: 'Machine output buffers', transfers: 'Products made & deliveries',
    progress: 'Craft & productivity progress', hand: 'Hand contents', fuel: 'Fuel', production: 'Production totals', throughput: 'Delivery rate',
};

/** States are a choice of signals within Activity, rather than a second destination. */
export function TimelineSignals({ signals, onChange }: { signals: TimelineSignalGroup[]; onChange(signals: TimelineSignalGroup[]): void }) {
    const preset = timelineSignalPreset(signals);
    const description = preset === 'states' ? 'States only' : preset === 'default' ? 'Default' : `${signals.length} selected`;
    return <Box component="details" sx={{ mb: 1 }}>
        <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>Signals · {description}</Typography>
        <ToggleButtonGroup value={preset === 'custom' ? null : preset} exclusive size="small" aria-label="Signal preset" sx={{ mt: 1, mb: 0.5 }}
            onChange={(_, value: 'default' | 'states' | null) => { if (value) onChange(value === 'states' ? ['state'] : [...DEFAULT_INSPECTION.signals]); }}>
            <ToggleButton value="default">Default signals</ToggleButton><ToggleButton value="states">States only</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" component="p">Choose which signals to show for the selected entity.</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>{SIGNAL_GROUPS.map(group => <FormControlLabel key={group} label={LABELS[group]} control={<Checkbox size="small" checked={signals.includes(group)}
            onChange={(_, checked) => onChange(checked ? [...signals, group] : signals.filter(value => value !== group))} />} />)}</Box>
    </Box>;
}
