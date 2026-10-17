import { Box, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { SerializableEntityStateTransitions } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { BELT_CHART, chartGridSx } from '../theme/beltCharts';
import { FactorioIcon } from './FactorioIcon';

type HistoryEntity = Pick<SerializableEntityStateTransitions, 'label' | 'entity_type'> & {
    source?: { label: string };
    sink?: { label: string };
};
const ICONS = { machine: 'assembling-machine-3', inserter: 'stack-inserter', drill: 'electric-mining-drill' };

/** Shared chrome for the original state and planning-transfer histories; each owns its marks and statistics. */
export function HistoricalTimelineRow({ variant, entity, items, count, details, duration, height, children }: {
    entity: HistoryEntity; items: string[]; count: ReactNode; details: ReactNode; duration: number; height: number;
    variant: 'state' | 'transfer'; children: ReactNode;
}) {
    const { nameIdsIn } = useGameNames();
    const accent = variant === 'state' ? BELT_CHART.entity[entity.entity_type] : undefined;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', height, mb: 0.5 }}>
            <Box sx={{ width: 220, flexShrink: 0, pr: 1, ...(accent && { pl: 1, borderLeft: 2, borderColor: accent }) }}>
                <Tooltip title={<Box>
                    <Typography variant="body2">{nameIdsIn(entity.label)}</Typography>
                    {entity.source && <Typography variant="caption" display="block">From: {nameIdsIn(entity.source.label)}</Typography>}
                    {entity.sink && <Typography variant="caption" display="block">To: {nameIdsIn(entity.sink.label)}</Typography>}
                    {details}
                </Box>} arrow placement="left">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <FactorioIcon name={ICONS[entity.entity_type]} size={18} {...(accent && { alt: '' })} />
                        <Typography variant="body2" noWrap sx={{ fontSize: '0.75rem', color: 'text.primary' }}>
                            {nameIdsIn(entity.label)}
                        </Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', bgcolor: 'action.selected',
                            px: 0.5, borderRadius: 0, ...(!accent && { fontWeight: 'medium' }) }}>
                            {count}
                        </Typography>
                        {(variant === 'transfer' || items.length > 0) && <Box sx={{ display: 'flex', gap: 0.25, ml: 0.5 }}>
                            {items.map(item => <FactorioIcon key={item} name={item} size={14} />)}
                        </Box>}
                    </Box>
                </Tooltip>
            </Box>
            <Box sx={{ flex: 1, height, position: 'relative', ...chartGridSx(duration), borderRadius: 0 }}>
                {children}
            </Box>
        </Box>
    );
}
