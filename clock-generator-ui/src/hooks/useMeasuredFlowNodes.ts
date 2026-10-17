import { useCallback, useMemo, useState } from 'react';
import type { Node, NodeChange } from '@xyflow/react';

export function retainFlowMeasurements<T extends Node>(nodes: T[], measurements: Record<string, { width: number; height: number }>): T[] {
    return nodes.map(node => measurements[node.id] ? { ...node, measured: measurements[node.id] } : node);
}

/** React Flow 12 resets measurements when controlled node objects are replaced without `measured`.
 * Keep reported dimensions across hover/frame updates so nodes and handles never disappear to remeasure.
 * Only dimensions are retained: selection, layout and replay data remain controlled by the caller. */
export function useMeasuredFlowNodes<T extends Node>(nodes: T[]) {
    const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
    const onNodesChange = useCallback((changes: NodeChange<T>[]) => {
        const dimensions = changes.filter(change => change.type === 'dimensions' && change.dimensions);
        if (!dimensions.length) return;
        setMeasurements(previous => {
            let next = previous;
            for (const change of dimensions) {
                if (change.type !== 'dimensions' || !change.dimensions) continue;
                const measured = change.dimensions;
                if (previous[change.id]?.width === measured.width && previous[change.id]?.height === measured.height) continue;
                if (next === previous) next = { ...previous };
                next[change.id] = measured;
            }
            return next;
        });
    }, []);
    const measuredNodes = useMemo(() => retainFlowMeasurements(nodes, measurements), [nodes, measurements]);
    return { nodes: measuredNodes, onNodesChange, measurements };
}
