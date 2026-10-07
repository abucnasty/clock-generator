import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Box, Chip, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import type { InserterNodeData } from '../utils/buildFlowGraph';

export type InserterFlowNodeType = Node<InserterNodeData, 'inserterNode'>;

export function InserterFlowNode({ data }: NodeProps<InserterFlowNodeType>) {
    return (
        <>
            {data.vertical
                ? <Handle type="target" id="in" position={data.vertical === 'down' ? Position.Top : Position.Bottom} />
                : <Handle type="target" position={Position.Left} />}
            <Box
                sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: '#1e1e1e',
                    border: '2px solid #666',
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: 'pointer',
                    width: 136,
                    boxSizing: 'border-box',
                    '&:hover': { bgcolor: '#2a2a2a', borderColor: '#999' },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FactorioIcon name="stack-inserter" size={24} />
                    <Box>
                        <Typography
                            variant="caption"
                            sx={{ fontWeight: 700, fontSize: '0.68rem', display: 'block', lineHeight: 1.2, color: '#ccc' }}
                        >
                            Inserter #{data.inserterId}
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ fontSize: '0.6rem', color: 'text.secondary', lineHeight: 1.2, display: 'block' }}
                        >
                            Stack: {data.stackSize}
                        </Typography>
                    </Box>
                </Box>
                {data.filterIcons && data.filterIcons.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        {data.filterIcons.map(icon => (
                            <FactorioIcon key={icon} name={icon} size={14} />
                        ))}
                    </Box>
                )}
                {data.overrideMode && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 0.25 }}>
                        <Chip
                            label={data.overrideMode}
                            size="small"
                            sx={{
                                height: 14,
                                fontSize: '0.55rem',
                                fontWeight: 700,
                                bgcolor: '#fca300',
                                color: '#000',
                                '& .MuiChip-label': { px: 0.75 },
                            }}
                        />
                    </Box>
                )}
            </Box>
            {data.vertical
                ? <Handle type="source" id="out" position={data.vertical === 'down' ? Position.Bottom : Position.Top} />
                : <Handle type="source" position={Position.Right} />}
        </>
    );
}
