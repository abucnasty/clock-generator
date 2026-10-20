import { BELT_PICKUP_LAYOUTS, BELT_PICKUP_LAYOUT_LABELS } from 'clock-generator/light';
import { MenuItem, TextField } from '@mui/material';
import type { InserterFormData } from '../utils/configForm/formData';
import { OUT_OF_SCOPE_PICKUP_SCOPE, OUT_OF_SCOPE_PICKUPS, pickupTypeOf, unsupportedPickupOf, withPickupType, type PickupType } from '../utils/pickupGeometry';

export function PickupTypeSelect({ source, onChange, entityLabel, compact = false }: {
    source: InserterFormData['source'];
    onChange: (source: InserterFormData['source']) => void;
    entityLabel: string;
    compact?: boolean;
}) {
    if (source.type !== 'belt') return null;
    // An out-of-scope pickup stays disabled as unverified, and says why no recapture makes it supported
    const outOfScope = unsupportedPickupOf(source);
    return <TextField select size="small" label="Picks up from" data-pickup-type=""
        value={pickupTypeOf(source)} disabled={pickupTypeOf(source) === 'unverified'} fullWidth={!compact} sx={compact ? { width: 250, flexShrink: 0 } : undefined}
        helperText={outOfScope ? `This imported pickup is not supported. ${OUT_OF_SCOPE_PICKUPS[outOfScope].detail} ${OUT_OF_SCOPE_PICKUP_SCOPE}`
            : pickupTypeOf(source) === 'unverified' ? 'This imported pickup is unverified. A supported Sidecar capture is required; choosing a default cannot classify it.'
            : compact ? undefined
            : 'Straight belt is the default. Choose the underground endpoint and pickup approach. Sidecar captures supported pickups automatically.'}
        slotProps={{ select: { SelectDisplayProps: { 'aria-label': `Picks up from, ${entityLabel}`, 'aria-labelledby': undefined } } }}
        onChange={event => onChange(withPickupType(source, event.target.value as PickupType))}>
        {pickupTypeOf(source) === 'unverified' && <MenuItem value="unverified">{outOfScope ? `Not supported: ${OUT_OF_SCOPE_PICKUPS[outOfScope].label}` : 'Unverified capture'}</MenuItem>}
        {pickupTypeOf(source) === 'underground' && <MenuItem value="underground" disabled>Choose underground layout</MenuItem>}
        {BELT_PICKUP_LAYOUTS.map(layout => <MenuItem key={layout} value={layout}>{BELT_PICKUP_LAYOUT_LABELS[layout]}</MenuItem>)}
    </TextField>;
}
