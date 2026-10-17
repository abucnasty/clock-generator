import { useTheme } from '@mui/material/styles';
import { themeTokens } from '../theme/runtimeTokens';
import type { NodeProps, Node } from '@xyflow/react';
import { Box, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import { FlowNodeHandles } from './FlowNodeHandles';
import { GameName } from './GameName';
import { DRILL_NODE_WIDTH, type DrillNodeData } from '../utils/buildFlowGraph';
import { entityLabel } from '../utils/entityLabel';
import { FLOW_NODE_BOX_CLASS, FLOW_NODE_FONT_SIZE } from './flowNodeStyle';

type DrillFlowNodeType = Node<DrillNodeData, 'drillNode'>;

export function DrillFlowNode({ data }: NodeProps<DrillFlowNodeType>) {
    const tokens = themeTokens(useTheme());
    return (
        <>
            <Box
                className={FLOW_NODE_BOX_CLASS}
                sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: tokens.surface.page,
                    border: `2px solid ${tokens.role.orange.main}`,
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: 'pointer',
                    width: DRILL_NODE_WIDTH,
                    boxSizing: 'border-box',
                    '&:hover': { bgcolor: tokens.surface.page, borderColor: tokens.role.orange.main },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <FactorioIcon name={data.drillType} size={24} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                            variant="caption"
                            className="flow-node-title"
                            sx={{ fontWeight: 700, fontSize: FLOW_NODE_FONT_SIZE, display: 'block', lineHeight: 1.2, color: tokens.role.orange.main }}
                        >
                            {entityLabel('drill', data.drillId)}
                        </Typography>
                        {data.minedItem ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <FactorioIcon name={data.minedItem} size={14} alt="" />
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontSize: FLOW_NODE_FONT_SIZE,
                                        color: 'text.secondary',
                                        lineHeight: 1.2,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    <GameName id={data.minedItem} />
                                </Typography>
                            </Box>
                        ) : (
                            <Typography
                                variant="caption"
                                sx={{ fontSize: FLOW_NODE_FONT_SIZE, color: 'text.secondary', lineHeight: 1.2, display: 'block' }}
                            >
                                no resource
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Box>
            <FlowNodeHandles data={data} />
        </>
    );
}
