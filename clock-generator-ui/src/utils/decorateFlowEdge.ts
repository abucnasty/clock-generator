import type { Edge } from '@xyflow/react';
import { flowRouteStyle } from '../theme/flowDiagram';
import type { ThemeTokens } from '../theme/tokens';
import type { FlowRoute } from './flowRouting';

/** Add interaction emphasis without losing transfer facts or inventing an arrow for a physical reference. */
export function decorateFlowEdge(edge: Edge, tokens: ThemeTokens, highlighted: boolean, selected: boolean, flowRoute?: FlowRoute): Edge {
    const emphasis = flowRouteStyle(tokens, highlighted ? 'selected' : 'neutral');
    const style = { ...edge.style, ...emphasis, strokeDasharray: edge.style?.strokeDasharray ?? emphasis.strokeDasharray };
    return {
        ...edge,
        type: 'transfer',
        data: { ...edge.data, flowRoute },
        selected,
        markerEnd: edge.markerEnd && typeof edge.markerEnd === 'object'
            ? { ...edge.markerEnd, color: style.stroke } : edge.markerEnd,
        style,
    };
}
