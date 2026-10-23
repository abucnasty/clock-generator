import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { routeFlowEdges, type FlowMeasurements, type FlowRoute } from '../utils/flowRouting';

const NO_ROUTES: ReadonlyMap<string, FlowRoute> = new Map();

/**
 * Only geometry reroutes connections: hover, playback ticks and quantity changes reuse their paths. Nothing is routed
 * before React Flow has measured a node: it draws no edge until then, and the measured sizes come in the next render.
 */
export function useFlowRoutes(nodes: Node[], edges: Edge[], measurements: FlowMeasurements): ReadonlyMap<string, FlowRoute> {
    return useMemo(() => (Object.keys(measurements).length === 0 ? NO_ROUTES : routeFlowEdges(nodes, edges, measurements)),
        [nodes, edges, measurements]);
}
