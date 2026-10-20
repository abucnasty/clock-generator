import type { InserterFormData } from '../utils/configForm/formData';
import { Box, Typography } from '@mui/material';
import { effectiveInserterStackSize, inserterMetadataText } from '../utils/inserterMetadata';
import { usesAutomaticFilters, usesBlacklist } from '../utils/inserterFilters';
import { useGameNames } from '../hooks/useGameNames';

interface AssumedInserter {
    id?: number;
    prototype?: string;
    quality?: InserterFormData['quality'];
    stack_size?: number;
    filters?: string[];
    filter_mode?: string;
    overrides?: { enable_control?: { mode: string } };
}

/** Read-only presentation of the saved or prospective inserters, never a form normalization. */
export function InserterAssumptions({ inserters, detailed = false }: { inserters: readonly AssumedInserter[]; detailed?: boolean }) {
    const { itemLabel } = useGameNames();
    if (inserters.length === 0) return <Typography variant="body2">No inserters in this composition.</Typography>;
    const missingType = inserters.filter(row => row.prototype === undefined).length;
    const missingQuality = inserters.filter(row => row.quality === undefined).length;
    const automatic = inserters.filter(row => row.stack_size === undefined).length;
    const unavailable = inserters.filter(row => !Number.isFinite(effectiveInserterStackSize(row))).length;
    return <Box sx={{ overflowWrap: 'anywhere' }}>
        <Typography variant="body2" data-metadata-assumptions>
            {inserters.length} inserters: {missingType ? `${missingType} missing type use Stack inserter timing` : 'all types explicit'};{' '}
            {missingQuality ? `${missingQuality} missing quality use Legendary timing` : 'all qualities explicit'}.{' '}
            Capacity: {automatic} Automatic ({unavailable ? `${unavailable} unavailable; supported types assume full research` : 'all capacity research'}), {inserters.length - automatic} Explicit.
        </Typography>
        {detailed && <Box component="ul" sx={{ pl: 2.5, my: 1 }}>
            {inserters.map((row, index) => {
                const capacity = effectiveInserterStackSize(row);
                return <Typography component="li" variant="body2" key={row.id ?? index} sx={{ mb: 0.5 }}>
                    Inserter {row.id ?? index + 1}: {inserterMetadataText(row)} ({row.prototype === undefined ? 'type assumed' : 'type explicit'}; {row.quality === undefined ? 'quality assumed' : 'quality explicit'}).{' '}
                    Capacity {row.stack_size === undefined ? 'Automatic' : 'Explicit'}: {Number.isFinite(capacity) ? `${capacity} items${row.stack_size === undefined ? ', all capacity research' : ''}` : 'unavailable'}.{' '}
                    Filters: {usesAutomaticFilters(row.filters) ? 'Automatic, follow the route' : `${usesBlacklist(row) ? 'Blacklist, not supported' : 'Explicit'}: ${row.filters!.map(itemLabel).join(', ')}`}.{' '}
                    Enable rule: {row.overrides?.enable_control === undefined ? 'Automatic (omitted)' : row.overrides.enable_control.mode === 'AUTO' ? 'Automatic (explicit Auto)' : `Explicit ${row.overrides.enable_control.mode}`}.
                </Typography>;
            })}
        </Box>}
    </Box>;
}
