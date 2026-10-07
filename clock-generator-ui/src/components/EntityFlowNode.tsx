import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Box, Chip, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import type { EntityNodeData, MachineNodeParams } from '../utils/buildFlowGraph';
import { useMachineFacts } from '../hooks/useMachineFacts';

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

function MachineDetailsSection({ params }: { params: MachineNodeParams }) {
    const { facts } = useMachineFacts(params);
    if (!facts) return null;
    return (
        <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid #444', width: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <FactorioIcon name={facts.output_item} size={14} />
                <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#fca300', lineHeight: 1 }}>
                    {facts.output_rate_per_second.toFixed(2)}/s out
                </Typography>
            </Box>
            {facts.inputs.map(inp => (
                <Box key={inp.item_name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                    <FactorioIcon name={inp.item_name} size={14} />
                    <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1 }}>
                        {inp.consumption_rate_per_second.toFixed(2)}/s in
                    </Typography>
                </Box>
            ))}
            <Typography variant="caption" sx={{ fontSize: '0.55rem', color: '#666', lineHeight: 1, display: 'block', mt: 0.5 }}>
                {facts.ticks_per_craft.toFixed(1)}t craft · ×{facts.overload_multiplier} overload
            </Typography>
        </Box>
    );
}

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
                    flexDirection: 'column',
                    cursor: 'pointer',
                    width: 176,
                    boxSizing: 'border-box',
                    '&:hover': { bgcolor: '#2d2d2d' },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                {data.detailed && data.machineParams && data.machineParams.recipe && (
                    <MachineDetailsSection params={data.machineParams} />
                )}
            </Box>
            <Handle type="source" position={Position.Right} />
            {data.verticalHandles && (
                <>
                    <Handle type="target" id="top-in" position={Position.Top} style={{ left: '35%' }} />
                    <Handle type="source" id="top-out" position={Position.Top} style={{ left: '65%' }} />
                    <Handle type="source" id="bottom-out" position={Position.Bottom} style={{ left: '35%' }} />
                    <Handle type="target" id="bottom-in" position={Position.Bottom} style={{ left: '65%' }} />
                </>
            )}
        </>
    );
}

