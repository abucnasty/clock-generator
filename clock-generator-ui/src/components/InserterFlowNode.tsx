import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Box, Chip, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import { INSERTER_NODE_CHIP_WIDTH, INSERTER_NODE_WIDTH, type InserterNodeData } from '../utils/buildFlowGraph';
import { entityLabel } from '../utils/entityLabel';
import { FLOW_NODE_BOX_CLASS, FLOW_NODE_FONT_SIZE } from './flowNodeStyle';

type InserterFlowNodeType = Node<InserterNodeData, 'inserterNode'>;

export function InserterFlowNode({ data }: NodeProps<InserterFlowNodeType>) {
    return (
        <>
            <Box
                className={FLOW_NODE_BOX_CLASS}
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
                    width: data.enableChip ? INSERTER_NODE_CHIP_WIDTH : INSERTER_NODE_WIDTH,
                    boxSizing: 'border-box',
                    '&:hover': { bgcolor: '#2a2a2a', borderColor: '#999' },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FactorioIcon name="stack-inserter" size={24} />
                    <Box>
                        <Typography
                            variant="caption"
                            sx={{ fontWeight: 700, fontSize: FLOW_NODE_FONT_SIZE, display: 'block', lineHeight: 1.2, color: '#ccc' }}
                        >
                            {entityLabel('inserter', data.inserterId)}
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ fontSize: FLOW_NODE_FONT_SIZE, color: 'text.secondary', lineHeight: 1.2, display: 'block' }}
                        >
                            Stack: {Number.isFinite(data.stackSize) ? data.stackSize : 'Automatic'}
                        </Typography>
                    </Box>
                </Box>
                {data.filterIcons && data.filterIcons.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        {data.filterIcons.map(icon => (
                            <FactorioIcon key={icon} name={icon} size={14} titled />
                        ))}
                    </Box>
                )}
                {data.enableChip && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 0.25, maxWidth: '100%' }}>
                        {/* the List row's chip text; a long rule wraps onto a second line rather than widen the node */}
                        <Chip
                            label={data.enableChip}
                            title={data.enableSummary}
                            size="small"
                            sx={{
                                height: 'auto',
                                minHeight: 20,
                                maxWidth: '100%',
                                fontSize: FLOW_NODE_FONT_SIZE,
                                fontWeight: 700,
                                bgcolor: '#fca300',
                                color: '#000',
                                '& .MuiChip-label': { px: 0.75, py: 0.25, whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 },
                            }}
                        />
                    </Box>
                )}
            </Box>
            {data.vertical
                ? <Handle type="target" id="in" position={data.vertical === 'down' ? Position.Top : Position.Bottom} />
                : <Handle type="target" position={Position.Left} />}
            {data.vertical
                ? <Handle type="source" id="out" position={data.vertical === 'down' ? Position.Bottom : Position.Top} />
                : <Handle type="source" position={Position.Right} />}
        </>
    );
}
