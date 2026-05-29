import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Box, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import type { DrillNodeData } from '../utils/buildFlowGraph';

export type DrillFlowNodeType = Node<DrillNodeData, 'drillNode'>;

export function DrillFlowNode({ data }: NodeProps<DrillFlowNodeType>) {
    return (
        <>
            <Box
                sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: '#1e1e1e',
                    border: '2px solid #a0522d',
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: 'pointer',
                    width: 136,
                    boxSizing: 'border-box',
                    '&:hover': { bgcolor: '#2a2a2a', borderColor: '#c47a45' },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <FactorioIcon name={data.drillType} size={24} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                            variant="caption"
                            sx={{ fontWeight: 700, fontSize: '0.68rem', display: 'block', lineHeight: 1.2, color: '#c47a45' }}
                        >
                            Drill #{data.drillId}
                        </Typography>
                        {data.minedItem ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <FactorioIcon name={data.minedItem} size={14} />
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontSize: '0.6rem',
                                        color: 'text.secondary',
                                        lineHeight: 1.2,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {data.minedItem}
                                </Typography>
                            </Box>
                        ) : (
                            <Typography
                                variant="caption"
                                sx={{ fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1.2, display: 'block' }}
                            >
                                no resource
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Box>
            <Handle type="source" position={Position.Right} />
        </>
    );
}
