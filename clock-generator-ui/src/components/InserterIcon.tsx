import { Box, Tooltip } from '@mui/material';
import type { InserterFormData } from '../hooks/useConfigForm';
import { inserterTimingLabels } from '../utils/inserterMetadata';
import { FactorioIcon } from './FactorioIcon';
import { QualityBadge } from './QualityBadge';

export function InserterIcon({ value, size = 24 }: { value: InserterFormData; size?: number }) {
    const prototype = value.prototype ?? 'stack-inserter';
    const quality = value.quality ?? 'legendary';
    const labels = inserterTimingLabels(value);
    return <Tooltip title={`${labels.type} · ${labels.quality}`}>
        <Box component="span" role="img" aria-label={`${labels.type}, ${labels.quality}`}
            sx={{ position: 'relative', display: 'inline-flex', width: size + 2, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <FactorioIcon name={prototype} size={size} alt="" />
            <QualityBadge quality={quality} size={size} />
        </Box>
    </Tooltip>;
}
