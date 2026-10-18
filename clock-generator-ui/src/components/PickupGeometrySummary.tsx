import { Box, Button, Typography } from '@mui/material';
import { pickupGeometryOf, type PickupBuild } from '../utils/pickupGeometry';

/** Describe the exact current, prospective or saved build supplied by the caller. Missing geometry never blocks a run. */
export function PickupGeometrySummary({ build, onEdit, busy = false }: {
    build: PickupBuild;
    onEdit?: (id: number) => void;
    busy?: boolean;
}) {
    const geometry = pickupGeometryOf(build);
    if (!geometry.total) return null;
    return <Box data-pickup-summary="" sx={{ my: 1, overflowWrap: 'anywhere' }}>
        <Typography variant="body2">
            {geometry.standing ? 'Backed-up input belts · Pickups use backed-up timing.'
                : `Moving input belts · Pickup type known for ${geometry.known === geometry.total ? `all ${geometry.total}` : `${geometry.known} of ${geometry.total}`} belt-fed ${geometry.total === 1 ? 'inserter' : 'inserters'}.`}
        </Typography>
        {!geometry.standing && geometry.missing.length > 0 && <>
            <Typography variant="body2" color="text.secondary">
                Pickup type is missing for {geometry.missing.length} {geometry.missing.length === 1 ? 'inserter' : 'inserters'}.
                {' '}Their moving-belt timing uses the older full-belt assumption. Re-export with the current Sidecar or set their pickup types.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {geometry.missing.map(id => onEdit
                    ? <Button key={id} size="small" aria-disabled={busy || undefined} onClick={() => { if (!busy) onEdit(id); }}>Set pickup for Inserter {id}</Button>
                    : <Typography key={id} variant="body2" color="text.secondary">Inserter {id}{id === geometry.missing.at(-1) ? '' : ','}</Typography>)}
            </Box>
        </>}
    </Box>;
}
