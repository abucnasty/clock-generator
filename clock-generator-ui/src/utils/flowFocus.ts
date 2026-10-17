import type { Edge, Node } from '@xyflow/react';
import { flowNodeEntity } from './buildFlowGraph';

/** Both drawn halves share an identity; follow through an inserter to show the entire route. */
export function flowFocus(nodes: Node[], edges: Edge[], entityKey: string | null) {
    const same = new Set(nodes.filter(node => flowEntityKey(node) === entityKey).map(node => node.id));
    const inserters = new Set<string>();
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const edge of edges) {
        if (!same.has(edge.source) && !same.has(edge.target)) continue;
        for (const id of [edge.source, edge.target]) {
            const node = byId.get(id);
            if (node && flowNodeEntity(node).type === 'inserter') inserters.add(id);
        }
    }
    const routes = new Set(edges.filter(edge => same.has(edge.source) || same.has(edge.target) || inserters.has(edge.source) || inserters.has(edge.target)).map(edge => edge.id));
    const related = new Set([...same, ...edges.filter(edge => routes.has(edge.id)).flatMap(edge => [edge.source, edge.target])]);
    return { same, routes, related };
}

export function flowEntityKey(node: Node): string {
    const entity = flowNodeEntity(node);
    return `${entity.type}:${entity.id}`;
}
