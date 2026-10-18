import { MenuItem, TextField } from '@mui/material';
import type { InserterFormData } from '../utils/configForm/formData';
import { pickupTypeOf, withPickupType, type PickupType } from '../utils/pickupGeometry';

export function PickupTypeSelect({ source, onChange, entityLabel, compact = false }: {
    source: InserterFormData['source'];
    onChange: (source: InserterFormData['source']) => void;
    entityLabel: string;
    compact?: boolean;
}) {
    if (source.type !== 'belt') return null;
    return <TextField select size="small" label="Picks up from" data-pickup-type=""
        value={pickupTypeOf(source)} fullWidth={!compact} sx={compact ? { width: 185, flexShrink: 0 } : undefined}
        helperText={compact ? undefined : source.pickup_merge ? 'Two-stream turbo side feed captured. Changing to Underground belt clears this supply model.'
            : 'Straight belt is the default. Choose Underground belt for an entrance or exit. Sidecar captures supported pickups automatically.'}
        slotProps={{ select: { SelectDisplayProps: { 'aria-label': `Picks up from, ${entityLabel}`, 'aria-labelledby': undefined } } }}
        onChange={event => onChange(withPickupType(source, event.target.value as PickupType))}>
        <MenuItem value="straight">Straight belt</MenuItem>
        <MenuItem value="underground">Underground belt</MenuItem>
    </TextField>;
}
