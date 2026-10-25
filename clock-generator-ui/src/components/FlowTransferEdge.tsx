import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { FlowTransferAmount } from '../utils/flowReplay';
import { formatNumberText } from '../utils/numberText';
import { themeTokens } from '../theme/runtimeTokens';
import { FactorioIcon } from './FactorioIcon';
import { attachFlowRoute, flowRoutePath, type FlowRoute } from '../utils/flowRouting';
import { outputLabelLayout } from '../utils/flowLabelLayout';

type FlowTransferEdgeData = { amounts?: FlowTransferAmount[]; outputItems?: { name: string; label: string }[]; labelText?: string; description?: string; flowRoute?: FlowRoute };

/** Compact item identities keep labels readable without extending over neighbouring nodes. */
export function FlowTransferEdge(props: EdgeProps<Edge<FlowTransferEdgeData>>) {
    const tokens = themeTokens(useTheme());
    const [fallback, fallbackX, fallbackY] = getSmoothStepPath(props);
    const route = props.data?.flowRoute;
    const points = route && attachFlowRoute(route.points, { x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY });
    const path = points ? flowRoutePath(points) : fallback;
    const { x, y } = route?.label ?? { x: fallbackX, y: fallbackY };
    const outputLayout = props.data?.outputItems?.length ? outputLabelLayout(props.data.outputItems) : null;
    return <>
        <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} markerStart={props.markerStart} style={props.style} interactionWidth={props.interactionWidth} />
        {props.data && (props.data.amounts?.length || props.data.outputItems?.length || props.data.labelText) ? <>
        {route?.labelAnchor && <path d={`M${route.labelAnchor.x} ${route.labelAnchor.y}L${x} ${y}`} fill="none" stroke={props.style?.stroke} strokeWidth={1} pointerEvents="none" />}
        <EdgeLabelRenderer>
            <Box className="nodrag nopan" title={props.data.description} role="note" aria-label={props.data.description}
                data-output-label={outputLayout ? '' : undefined}
                sx={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: 'all',
                    display: 'flex', flexDirection: 'column', gap: 0.25, width: 86, boxSizing: 'border-box', p: 0.25, border: 1, borderColor: tokens.control.border,
                    ...(outputLayout ? { display: 'grid', gridTemplateColumns: `repeat(${outputLayout.columns}, minmax(0, 1fr))`,
                        gridTemplateRows: outputLayout.rowHeights.map(height => `${height}px`).join(' '),
                        width: outputLayout.width, height: outputLayout.height, p: `${outputLayout.padding}px`, gap: `${outputLayout.gap}px` } : {}),
                    bgcolor: tokens.surface.panel, color: tokens.text.primary, borderRadius: 0.5 }}>
                {props.data.amounts?.map(value => <Box key={value.item ?? 'unknown'} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    {value.item && <FactorioIcon name={value.item} size={14} alt="" />}
                    <Typography variant="caption" sx={{ fontSize: 12, lineHeight: 1.2 }}>{formatNumberText(value.amount, { maxDecimals: 2 })}{value.item ? '' : ' items'}</Typography>
                </Box>)}
                {props.data.outputItems?.map(item => <Box key={item.name} sx={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <FactorioIcon name={item.name} size={18} alt="" />
                    <Typography variant="caption" sx={{ fontSize: 12, lineHeight: '16px', minWidth: 0, overflowWrap: 'anywhere' }}>{item.label}</Typography>
                </Box>)}
                {props.data.labelText && <Typography variant="caption" sx={{ fontSize: 12, lineHeight: 1.2 }}>{props.data.labelText}</Typography>}
            </Box>
        </EdgeLabelRenderer></> : null}
    </>;
}
