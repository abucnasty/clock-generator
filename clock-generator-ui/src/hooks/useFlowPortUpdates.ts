import { useEffect, useRef } from 'react';
import { useUpdateNodeInternals, type Node } from '@xyflow/react';
import type { FlowPort } from '../utils/flowRouting';

/** What decides a node's handles (FlowNodeHandles): its route ports and the sides its default handles take */
function portSignature(node: Node): string {
    const ports = (node.data.routePorts as FlowPort[] | undefined) ?? [];
    return [String(node.data.vertical), String(node.data.half), String(node.data.verticalHandles),
        ...ports.map(port => `${port.id}@${port.fraction}`)].join('|');
}

/**
 * The nodes whose handles changed since `previous`, and the signatures to keep. A node seen for the first time is not
 * listed: React Flow measures a new node, handles included, when it mounts.
 */
export function changedPortNodes(previous: ReadonlyMap<string, string>, nodes: readonly Node[]): { changed: string[]; next: Map<string, string> } {
    const next = new Map<string, string>();
    const changed: string[] = [];
    for (const node of nodes) {
        const signature = portSignature(node);
        next.set(node.id, signature);
        const before = previous.get(node.id);
        if (before !== undefined && before !== signature) changed.push(node.id);
    }
    return { changed, next };
}

/**
 * Tells React Flow, in one update, which nodes' handles moved. A handle that moves leaves the node's size as it was, so
 * React Flow's own resize observer does not see it. One call for all of them: an update per node is a full render of
 * the diagram per node, all in one frame (the diagram of a build with 29 nodes blocked the page for half a second).
 */
export function useFlowPortUpdates(nodes: readonly Node[]) {
    const updateNodeInternals = useUpdateNodeInternals();
    const signatures = useRef<ReadonlyMap<string, string>>(new Map());
    useEffect(() => {
        const { changed, next } = changedPortNodes(signatures.current, nodes);
        signatures.current = next;
        if (changed.length > 0) updateNodeInternals(changed);
    }, [nodes, updateNodeInternals]);
}
