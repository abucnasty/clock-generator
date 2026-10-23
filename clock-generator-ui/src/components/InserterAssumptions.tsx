import { Box, Typography } from '@mui/material';
import { effectiveInserterStackSize } from '../utils/inserterMetadata';
import { assumptionsText } from '../utils/modelAssumptions';
import type { inserterDetailLines } from '../utils/pasteText';
import { InserterDetails } from './InserterDetails';

type AssumedInserter = Parameters<typeof inserterDetailLines>[0][number];

/** Read-only presentation of the saved or prospective inserters, never a form normalization. */
export function InserterAssumptions({ inserters, detailed = false }: { inserters: readonly AssumedInserter[]; detailed?: boolean }) {
    if (inserters.length === 0) return <Typography variant="body2">No inserters in this composition.</Typography>;
    const missingType = inserters.filter(row => row.prototype === undefined).length;
    const missingQuality = inserters.filter(row => row.quality === undefined).length;
    const automatic = inserters.filter(row => row.stack_size === undefined).length;
    const unavailable = inserters.filter(row => !Number.isFinite(effectiveInserterStackSize(row))).length;
    return <Box sx={{ overflowWrap: 'anywhere' }}>
        <Typography variant="body2" data-metadata-assumptions>
            {assumptionsText({ count: inserters.length, missingType, missingQuality, automatic, unavailable })}
        </Typography>
        {detailed && <Box sx={{ display: 'grid', gap: 0.5, my: 1 }}><InserterDetails inserters={inserters} /></Box>}
    </Box>;
}
