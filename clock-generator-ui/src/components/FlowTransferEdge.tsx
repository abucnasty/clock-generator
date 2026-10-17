import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { FlowTransferAmount } from '../utils/flowReplay';
import { formatNumberText } from '../utils/numberText';
import { themeTokens } from '../theme/runtimeTokens';
import { FactorioIcon } from './FactorioIcon';

export type FlowTransferEdgeData = { amounts: FlowTransferAmount[]; description: string };

/** Compact item identities keep labels readable without extending over neighbouring nodes. */
export function FlowTransferEdge(props: EdgeProps<Edge<FlowTransferEdgeData>>) {
    const tokens = themeTokens(useTheme());
    const [path, x, y] = getSmoothStepPath(props);
    return <>
        <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} markerStart={props.markerStart} style={props.style} interactionWidth={props.interactionWidth} />
        {props.data && props.data.amounts.length > 0 && <EdgeLabelRenderer>
            <Box className="nodrag nopan" title={props.data.description} role="note" aria-label={props.data.description}
                sx={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: 'all',
                    display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 85, p: 0.25, border: 1, borderColor: tokens.control.border,
                    bgcolor: tokens.surface.panel, color: tokens.text.primary, borderRadius: 0.5 }}>
                {props.data.amounts.map(value => <Box key={value.item ?? 'unknown'} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    {value.item && <FactorioIcon name={value.item} size={14} alt="" />}
                    <Typography variant="caption" sx={{ fontSize: 12, lineHeight: 1.2 }}>{formatNumberText(value.amount, { maxDecimals: 2 })}{value.item ? '' : ' items'}</Typography>
                </Box>)}
            </Box>
        </EdgeLabelRenderer>}
    </>;
}
