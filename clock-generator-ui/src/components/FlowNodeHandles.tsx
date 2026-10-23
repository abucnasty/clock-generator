import { Handle, Position, type Node } from '@xyflow/react';
import type { FlowPort } from '../utils/flowRouting';

/**
 * Existing connections get their own port; unused sides still accept new editor connections. The diagram tells React
 * Flow when they move (useFlowPortUpdates), for all nodes in one update.
 */
export function FlowNodeHandles({ data }: { data: Node['data'] }) {
    const ports = (data.routePorts as FlowPort[] | undefined) ?? [];
    const entity = 'entityType' in data, drill = 'drillId' in data;
    const defaults: (Omit<FlowPort, 'id'> & { id?: string })[] = [];
    if ((!entity || data.half !== 'in') && !drill) defaults.push({ type: 'target', id: data.vertical ? 'in' : undefined,
        position: data.vertical ? data.vertical === 'down' ? Position.Top : Position.Bottom : Position.Left, fraction: 0.5 });
    if (!entity || data.half !== 'out') defaults.push({ type: 'source', id: data.vertical ? 'out' : undefined,
        position: data.vertical ? data.vertical === 'down' ? Position.Bottom : Position.Top : Position.Right, fraction: 0.5 });
    if (data.verticalHandles) defaults.push(
        { type: 'target', id: 'top-in', position: Position.Top, fraction: 0.35 },
        { type: 'source', id: 'top-out', position: Position.Top, fraction: 0.65 },
        { type: 'source', id: 'bottom-out', position: Position.Bottom, fraction: 0.35 },
        { type: 'target', id: 'bottom-in', position: Position.Bottom, fraction: 0.65 });
    return [...ports, ...defaults.filter(port => !ports.some(other => other.type === port.type && other.position === port.position))].map(port =>
        <Handle key={port.id ?? `${port.position}-${port.type}`} id={port.id} type={port.type} position={port.position}
            style={port.position === Position.Left || port.position === Position.Right ? { top: `${port.fraction * 100}%` } : { left: `${port.fraction * 100}%` }} />);
}
