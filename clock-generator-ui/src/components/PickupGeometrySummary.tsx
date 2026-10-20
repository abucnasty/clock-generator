import { Box, Button, Typography } from '@mui/material';
import { OUT_OF_SCOPE_PICKUP_SCOPE, OUT_OF_SCOPE_PICKUPS, pickupGeometryOf, unsupportedPickupOf, type PickupBuild } from '../utils/pickupGeometry';

/** Current builds default to straight belts; saved runs retain the assumptions they actually used. */
export function PickupGeometrySummary({ build, onEdit, busy = false, savedRun = false }: {
    build: PickupBuild;
    onEdit?: (id: number) => void;
    busy?: boolean;
    savedRun?: boolean;
}) {
    const geometry = pickupGeometryOf(build);
    if (!geometry.total) return null;
    // An out-of-scope pickup is named by what puts it out of scope, never by its entity type alone
    const detailsOf = (ids: readonly number[]) => build.inserters.flatMap((inserter, index) => {
        const capture = inserter.source.pickup_capture;
        const outOfScope = unsupportedPickupOf(inserter.source);
        return capture && ids.includes(inserter.id ?? index + 1)
            ? [`${inserter.id ?? index + 1} (${outOfScope ? OUT_OF_SCOPE_PICKUPS[outOfScope].label
                : capture.status === 'supported' ? 'layout not captured' : capture.entity_type ?? capture.reason})`] : [];
    });
    // Out-of-scope pickups are a subset of the unverified ones; a new capture may still support the rest
    const unverifiedOnly = geometry.unverified.filter(id => !geometry.unsupported.includes(id));
    return <Box data-pickup-summary="" sx={{ my: 1, overflowWrap: 'anywhere' }}>
        <Typography variant="body2">
            {geometry.unverified.length && !unverifiedOnly.length ? `${geometry.unverified.length} belt ${geometry.unverified.length === 1 ? 'pickup is not supported and blocks' : 'pickups are not supported and block'} generation.`
                : geometry.unverified.length ? `${geometry.unverified.length} belt ${geometry.unverified.length === 1 ? 'pickup needs' : 'pickups need'} a supported capture before generation. Recorded unsupported or unclassified pickups are retained when this build is saved.`
                : geometry.backedUp ? 'Backed-up input belts · Saturated supply with captured pickup rules.'
                : savedRun ? `Moving input belts · Pickup type known for ${geometry.known === geometry.total ? `all ${geometry.total}` : `${geometry.known} of ${geometry.total}`} belt-fed ${geometry.total === 1 ? 'inserter' : 'inserters'}.`
                    : 'Moving input belts · Straight belt is the default. Choose the underground endpoint and pickup approach.'}
        </Typography>
        {geometry.unsupported.length > 0 && <Typography variant="body2" color="text.secondary">
            Not supported: Inserter {detailsOf(geometry.unsupported).join(', ')}. {OUT_OF_SCOPE_PICKUP_SCOPE}
        </Typography>}
        {unverifiedOnly.length > 0 && <Typography variant="body2" color="text.secondary">
            Unverified: Inserter {detailsOf(unverifiedOnly).join(', ')}. Update Sidecar and recapture when the geometry is supported.
            {' '}Updating the mod alone does not update this saved capture.
        </Typography>}
        {geometry.missing.length > 0 && (savedRun || build.inserters.some(i => i.source.pickup_length === 0.5 && !i.source.pickup_layout)) && <>
            <Typography variant="body2" color="text.secondary">
                Pickup type is missing for {geometry.missing.length} {geometry.missing.length === 1 ? 'inserter' : 'inserters'}.
                {' '}Choose a pickup layout before generating again. Saved results retain their original timing assumptions.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {geometry.missing.map(id => onEdit
                    ? <Button key={id} size="small" aria-disabled={busy || undefined} onClick={() => { if (!busy) onEdit(id); }}>Set pickup for Inserter {id}</Button>
                    : <Typography key={id} variant="body2" color="text.secondary">Inserter {id}{id === geometry.missing.at(-1) ? '' : ','}</Typography>)}
            </Box>
        </>}
    </Box>;
}
