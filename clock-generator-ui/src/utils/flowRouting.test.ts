import { expect, it } from 'vitest';
import { Position, type Node, type Edge } from '@xyflow/react';
import type { Config } from 'clock-generator/browser';
import agriculture from '../../../clock-generator/resources/config-samples/science/agriculture-science/agriculture-science.json?raw';
import bacteria from '../../../clock-generator/resources/config-samples/gleba/iron-bacteria-cultivation/iron-bacteria-cultivation.json?raw';
import circuit from '../../../clock-generator/resources/config-samples/intermediates/advanced-circuit/advanced-circuit.json?raw';
import { configToFormData } from './configForm/configMapping';
import { buildFlowGraph } from './buildFlowGraph';
import { assignFlowPorts, attachFlowRoute, flowNodeRect, flowRoutePath, routeFlowEdges, type FlowPort, type FlowRect } from './flowRouting';

const node = (id: string, x: number, y: number): Node => ({ id, position: { x, y }, initialWidth: 100, initialHeight: 80, data: {} });
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target });
const overlap = (a: FlowRect, b: FlowRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

it('separates incoming and outgoing ports on the same side of a machine loop', () => {
    const graph = assignFlowPorts([node('machine', 100, 0), node('left', 0, 150), node('right', 200, 150)], [
        { ...edge('out', 'machine', 'left'), sourceHandle: 'bottom-out' },
        { ...edge('in', 'right', 'machine'), targetHandle: 'bottom-in' },
    ]);
    const ports = graph.nodes[0].data.routePorts as FlowPort[];
    expect(ports.map(port => port.position)).toEqual([Position.Bottom, Position.Bottom]);
    expect(ports[0].fraction).toBeLessThan(ports[1].fraction);
    expect(graph.edges[0].sourceHandle).toBe(ports[0].id);
    expect(graph.edges[1].targetHandle).toBe(ports[1].id);
});

it('routes around an intervening node and keeps parallel routes distinct', () => {
    const graph = assignFlowPorts([node('source', 0, 100), node('obstacle', 200, 80), node('target', 400, 100)], [
        edge('a', 'source', 'target'), edge('b', 'source', 'target'),
    ]);
    const routes = routeFlowEdges(graph.nodes, graph.edges);
    expect(routes.size).toBe(2);
    expect(routes.get('a')!.points).not.toEqual(routes.get('b')!.points);
    for (const route of routes.values()) {
        const obstacle = flowNodeRect(graph.nodes[1]);
        for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1], b = route.points[i];
            expect(a.x === b.x || a.y === b.y).toBe(true);
            expect(a.x === b.x ? a.x <= obstacle.x || a.x >= obstacle.x + obstacle.width || Math.max(a.y, b.y) <= obstacle.y || Math.min(a.y, b.y) >= obstacle.y + obstacle.height
                : a.y <= obstacle.y || a.y >= obstacle.y + obstacle.height || Math.max(a.x, b.x) <= obstacle.x || Math.min(a.x, b.x) >= obstacle.x + obstacle.width).toBe(true);
        }
    }
    expect(routeFlowEdges(graph.nodes, graph.edges)).toEqual(routes);
});

it.each([false, true])('attaches measured handles orthogonally for horizontal=%s', horizontal => {
    const points = horizontal ? [{ x: 100, y: 100 }, { x: 200, y: 100 }] : [{ x: 100, y: 100 }, { x: 100, y: 200 }];
    const source = { x: 100.5, y: 100.125 }, target = horizontal ? { x: 199.5, y: 100.75 } : { x: 100.75, y: 199.5 };
    const attached = attachFlowRoute(points, source, target);
    expect(attached[0]).toEqual(source);
    expect(attached.at(-1)).toEqual(target);
    for (let i = 1; i < attached.length; i++) expect(attached[i].x === attached[i - 1].x || attached[i].y === attached[i - 1].y).toBe(true);
    expect(flowRoutePath(attached)).not.toMatch(/NaN|Infinity/);
});

it.each([agriculture, bacteria, circuit])('routes real sample builds with clear, stable quantity label positions', json => {
    const config = configToFormData(JSON.parse(json) as Config);
    for (const height of [0, 168]) {
        const { nodes, edges } = buildFlowGraph(config.machines, config.inserters, config.belts, config.chests,
            config.drills?.configs ?? [], undefined, true, undefined, height);
        const routes = routeFlowEdges(nodes, edges);
        expect(routes.size).toBe(edges.length);
        const labels: FlowRect[] = [];
        for (const [id, route] of routes) {
            const connection = edges.find(edge => edge.id === id)!;
            const ins = nodes.find(node => [connection.source, connection.target].includes(node.id) && node.type === 'inserterNode');
            const items = ins?.data.filterIcons as string[] | undefined;
            const labelHeight = 24 * Math.max(1, Math.min(3, items?.length ?? 1));
            const label = { x: route.label.x - 43, y: route.label.y - labelHeight / 2, width: 86, height: labelHeight };
            expect(nodes.some(node => overlap(label, flowNodeRect(node))), id).toBe(false);
            expect(labels.some(previous => overlap(label, previous)), id).toBe(false);
            labels.push(label);
        }
        // Changing a readout or the selected entity cannot alter the route geometry.
        const changed = nodes.map(node => ({ ...node, selected: true, data: { ...node.data, snapshot: { hand: 16 } } }));
        expect(routeFlowEdges(changed, edges)).toEqual(routes);
    }
});
