import { useTheme } from '@mui/material/styles';
import { themeTokens } from '../theme/runtimeTokens';
import { flowNodeTitleColor } from '../theme/flowDiagram';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Box, Chip, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { ENTITY_NODE_WIDTH, type EntityNodeData, type MachineNodeParams } from '../utils/buildFlowGraph';
import { useMachineFacts } from '../hooks/useMachineFacts';
import { formatNumberText, machineNodeCraftLine } from '../utils/numberText';
import { FLOW_NODE_BOX_CLASS, FLOW_NODE_FONT_SIZE } from './flowNodeStyle';

const TYPE_LABELS: Record<EntityNodeData['entityType'], string> = {
    machine: 'M',
    belt: 'B',
    chest: 'C',
};

function MachineDetailsSection({ params }: { params: MachineNodeParams }) {
    const tokens = themeTokens(useTheme());
    const { facts } = useMachineFacts(params);
    if (!facts) return null;
    return (
        <Box className="flow-node-rates" sx={{ mt: 0.75, pt: 0.75, borderTop: `1px solid ${tokens.control.edge}`, width: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <FactorioIcon name={facts.output_item} size={14} titled />
                <Typography variant="caption" sx={{ fontSize: FLOW_NODE_FONT_SIZE, color: tokens.role.orange.main, lineHeight: 1.2 }}>
                    {formatNumberText(facts.output_rate_per_second)}/s out
                </Typography>
            </Box>
            {facts.inputs.map(inp => (
                <Box key={inp.item_name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                    <FactorioIcon name={inp.item_name} size={14} titled />
                    <Typography variant="caption" sx={{ fontSize: FLOW_NODE_FONT_SIZE, color: 'text.secondary', lineHeight: 1.2 }}>
                        {formatNumberText(inp.consumption_rate_per_second)}/s in
                    </Typography>
                </Box>
            ))}
            <Typography
                variant="caption"
                sx={{ fontSize: FLOW_NODE_FONT_SIZE, color: 'text.secondary', lineHeight: 1.2, display: 'block', mt: 0.5, whiteSpace: 'normal' }}
            >
                {machineNodeCraftLine(facts.ticks_per_craft, facts.overload_multiplier)}
            </Typography>
        </Box>
    );
}

type EntityFlowNodeType = Node<EntityNodeData, 'entityNode'>;

export function EntityFlowNode({ data }: NodeProps<EntityFlowNodeType>) {
    const tokens = themeTokens(useTheme());
    const role = data.entityType === 'machine' ? 'orange' : data.entityType === 'belt' ? 'blue' : 'green';
    const borderRole = tokens.role[role];
    const borderColor = borderRole.main;
    // a half takes only its own side's connections: the `in` half feeds, the `out` half receives
    const hasTarget = data.half !== 'in';
    const hasSource = data.half !== 'out';

    return (
        <>
            <Box
                className={FLOW_NODE_BOX_CLASS}
                sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: tokens.surface.page,
                    border: `2px solid ${borderColor}`,
                    borderRadius: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: 'pointer',
                    width: ENTITY_NODE_WIDTH,
                    boxSizing: 'border-box',
                    '&:hover': { bgcolor: tokens.surface.page },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FactorioIcon name={data.iconName} size={32} titled />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                            variant="caption"
                            className="flow-node-title"
                            title={data.halfTitle}
                            sx={{
                                fontWeight: 700,
                                lineHeight: 1.2,
                                display: 'block',
                                color: flowNodeTitleColor(tokens, role),
                                fontSize: FLOW_NODE_FONT_SIZE,
                            }}
                        >
                            {data.label}
                        </Typography>
                        {data.sublabel && (
                            <Typography
                                variant="caption"
                                className="flow-node-detail"
                                title={data.entityType === 'machine' ? undefined : data.sublabel}
                                sx={{
                                    color: 'text.secondary',
                                    display: 'block',
                                    fontSize: FLOW_NODE_FONT_SIZE,
                                    lineHeight: 1.2,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {data.entityType === 'machine' && data.machineParams?.recipe
                                    ? <GameName id={data.machineParams.recipe} kind="recipe" />
                                    : data.sublabel}
                            </Typography>
                        )}
                        {data.filterIcons && data.filterIcons.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.25, mt: 0.25, flexWrap: 'wrap' }}>
                                {data.filterIcons.slice(0, 4).map(icon => (
                                    <FactorioIcon key={icon} name={icon} size={14} titled />
                                ))}
                            </Box>
                        )}
                    </Box>
                    <Chip
                        label={TYPE_LABELS[data.entityType]}
                        size="small"
                        sx={{
                            height: 20,
                            fontSize: FLOW_NODE_FONT_SIZE,
                            bgcolor: borderColor,
                            color: borderRole.on,
                            fontWeight: 700,
                            flexShrink: 0,
                            '& .MuiChip-label': { px: 0.75 },
                        }}
                    />
                </Box>
                {data.detailed && data.machineParams && data.machineParams.recipe && (
                    <MachineDetailsSection params={data.machineParams} />
                )}
            </Box>
            {hasTarget && <Handle type="target" position={Position.Left} />}
            {hasSource && <Handle type="source" position={Position.Right} />}
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

