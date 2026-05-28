import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Box, Chip, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import type { EntityNodeData } from '../utils/buildFlowGraph';

const BORDER_COLORS: Record<EntityNodeData['entityType'], string> = {
    machine: '#fca300',
    belt: '#4fc3f7',
    chest: '#81c784',
};

const TYPE_LABELS: Record<EntityNodeData['entityType'], string> = {
    machine: 'M',
    belt: 'B',
    chest: 'C',
};

export type EntityFlowNodeType = Node<EntityNodeData, 'entityNode'>;

export function EntityFlowNode({ data }: NodeProps<EntityFlowNodeType>) {
    const borderColor = BORDER_COLORS[data.entityType];

    return (
        <>
            <Handle type="target" position={Position.Left} />
            <Box
                sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: '#232323',
                    border: `2px solid ${borderColor}`,
                    borderRadius: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    cursor: 'pointer',
                    width: 176,
                    boxSizing: 'border-box',
                    '&:hover': { bgcolor: '#2d2d2d' },
                }}
            >
                <FactorioIcon name={data.iconName} size={32} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                        variant="caption"
                        sx={{
                            fontWeight: 700,
                            lineHeight: 1.2,
                            display: 'block',
                            color: borderColor,
                            fontSize: '0.7rem',
                        }}
                    >
                        {data.label}
                    </Typography>
                    {data.sublabel && (
                        <Typography
                            variant="caption"
                            sx={{
                                color: 'text.secondary',
                                display: 'block',
                                fontSize: '0.6rem',
                                lineHeight: 1.2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {data.sublabel}
                        </Typography>
                    )}
                    {data.filterIcons && data.filterIcons.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.25, mt: 0.25, flexWrap: 'wrap' }}>
                            {data.filterIcons.slice(0, 4).map(icon => (
                                <FactorioIcon key={icon} name={icon} size={14} />
                            ))}
                        </Box>
                    )}
                </Box>
                <Chip
                    label={TYPE_LABELS[data.entityType]}
                    size="small"
                    sx={{
                        height: 16,
                        fontSize: '0.6rem',
                        bgcolor: borderColor,
                        color: '#000',
                        fontWeight: 700,
                        flexShrink: 0,
                        '& .MuiChip-label': { px: 0.5 },
                    }}
                />
            </Box>
            <Handle type="source" position={Position.Right} />
        </>
    );
}
