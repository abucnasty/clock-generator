import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { routeFlowEdges, type FlowMeasurements } from '../utils/flowRouting';

/** Only geometry reroutes connections: hover, playback ticks and quantity changes reuse their paths. */
export function useFlowRoutes(nodes: Node[], edges: Edge[], measurements: FlowMeasurements) {
    return useMemo(() => routeFlowEdges(nodes, edges, measurements), [nodes, edges, measurements]);
}
