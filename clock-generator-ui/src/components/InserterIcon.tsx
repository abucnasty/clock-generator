import { Box, Tooltip } from '@mui/material';
import type { InserterFormData } from '../hooks/useConfigForm';
import { inserterTimingLabels } from '../utils/inserterMetadata';
import { FactorioIcon } from './FactorioIcon';

const QUALITIES = new Set(['normal', 'uncommon', 'rare', 'epic', 'legendary']);

export function InserterIcon({ value, size = 24 }: { value: InserterFormData; size?: number }) {
    const prototype = value.prototype ?? 'stack-inserter';
    const quality = value.quality ?? 'legendary';
    const labels = inserterTimingLabels(value);
    return <Tooltip title={`${labels.type} · ${labels.quality}`}>
        <Box component="span" role="img" aria-label={`${labels.type}, ${labels.quality}`}
            sx={{ position: 'relative', display: 'inline-flex', width: size + 2, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <FactorioIcon name={prototype} size={size} alt="" />
            {QUALITIES.has(quality) && <Box component="img" src={`/images/inserter-preview/badge-${quality}.png`} alt=""
                sx={{ position: 'absolute', bottom: -1, left: -1, width: Math.round(size * 0.42), height: Math.round(size * 0.42), imageRendering: 'pixelated', filter: 'drop-shadow(0 1px 1px #000)' }} />}
        </Box>
    </Tooltip>;
}
