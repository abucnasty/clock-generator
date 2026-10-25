import { Position, type Edge, type Node } from '@xyflow/react';
import { outputLabelLayout, type FlowOutputItem } from './flowLabelLayout';

export interface FlowPoint { x: number; y: number }
export interface FlowPort { id: string; type: 'source' | 'target'; position: Position; fraction: number }
export interface FlowRoute { points: FlowPoint[]; label: FlowPoint; labelAnchor?: FlowPoint; labelBounds?: FlowRect }
export interface FlowRect extends FlowPoint { width: number; height: number }
export type FlowMeasurements = Record<string, { width: number; height: number }>;
const CLEARANCE = 12, STUB = 18, LANE = 10;
const horizontal = (side: Position) => side === Position.Left || side === Position.Right;

export function flowNodeRect(node: Node, measurements: FlowMeasurements = {}): FlowRect {
    const size = measurements[node.id] ?? node.measured;
    return { ...node.position, width: size?.width ?? node.initialWidth ?? 200, height: size?.height ?? node.initialHeight ?? 70 };
}

function portSide(node: Node, handle: string | null | undefined, type: FlowPort['type']): Position {
    if (handle?.startsWith('top-')) return Position.Top;
    if (handle?.startsWith('bottom-')) return Position.Bottom;
    if (node.data.vertical) return (node.data.vertical === 'down') === (type === 'source') ? Position.Bottom : Position.Top;
    return type === 'source' ? Position.Right : Position.Left;
}

/** Fan-in and fan-out get separate, ordered ports instead of sharing a single ambiguous junction. */
export function assignFlowPorts(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const groups = new Map<string, { edge: Edge; node: Node; other: Node; type: FlowPort['type']; position: Position }[]>();
    for (const edge of edges) for (const type of ['source', 'target'] as const) {
        const node = byId.get(edge[type]), other = byId.get(edge[type === 'source' ? 'target' : 'source']);
        if (!node || !other) continue;
        const position = portSide(node, edge[type === 'source' ? 'sourceHandle' : 'targetHandle'], type);
        const key = `${node.id}:${position}`;
        groups.set(key, [...(groups.get(key) ?? []), { edge, node, other, type, position }]);
    }
    const ports = new Map<string, FlowPort[]>(), handles = new Map<string, { sourceHandle?: string; targetHandle?: string }>();
    for (const group of groups.values()) {
        const coordinate = (node: Node) => { const r = flowNodeRect(node); return horizontal(group[0].position) ? r.y + r.height / 2 : r.x + r.width / 2; };
        group.sort((a, b) => coordinate(a.other) - coordinate(b.other) || a.edge.id.localeCompare(b.edge.id));
        group.forEach(({ edge, node, type, position }, index) => {
            const id = `${position}-${type}-${edge.id}`;
            const port = { id, type, position, fraction: 0.15 + 0.7 * (index + 1) / (group.length + 1) };
            ports.set(node.id, [...(ports.get(node.id) ?? []), port]);
            handles.set(edge.id, { ...handles.get(edge.id), [type === 'source' ? 'sourceHandle' : 'targetHandle']: id });
        });
    }
    return { nodes: nodes.map(node => ({ ...node, data: { ...node.data, routePorts: ports.get(node.id) ?? [] } })),
        edges: edges.map(edge => ({ ...edge, ...handles.get(edge.id) })) };
}

function endpoint(node: Node, rect: FlowRect, handle: string | null | undefined, type: FlowPort['type']) {
    const port = (node.data.routePorts as FlowPort[] | undefined)?.find(port => port.id === handle);
    const side = port?.position ?? portSide(node, handle, type), fraction = port?.fraction ?? 0.5;
    const point = horizontal(side) ? { x: rect.x + (side === Position.Right ? rect.width : 0), y: rect.y + rect.height * fraction }
        : { x: rect.x + rect.width * fraction, y: rect.y + (side === Position.Bottom ? rect.height : 0) };
    const stub = { x: point.x + (side === Position.Right ? STUB : side === Position.Left ? -STUB : 0),
        y: point.y + (side === Position.Bottom ? STUB : side === Position.Top ? -STUB : 0) };
    return { point, stub, side };
}

const overlaps = (a: FlowRect, b: FlowRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const segmentRect = (a: FlowPoint, b: FlowPoint, rect: FlowRect) => a.x === b.x
    ? a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height
    : a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;

function simplify(points: FlowPoint[]): FlowPoint[] {
    const result: FlowPoint[] = [];
    for (const point of points) {
        // Removing a collinear reversal also removes overlapping endpoint stubs in narrow gaps.
        while (result.length >= 2) {
            const a = result.at(-2)!, b = result.at(-1)!;
            if (!((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) break;
            result.pop();
        }
        const last = result.at(-1);
        if (!last || last.x !== point.x || last.y !== point.y) result.push(point);
    }
    return result;
}

interface SearchEntry { state: number; cost: number; score: number }
class Queue {
    private items: SearchEntry[] = [];
    push(item: SearchEntry) {
        let i = this.items.length; this.items.push(item);
        while (i > 0) { const p = (i - 1) >> 1; if (this.items[p].score <= item.score) break; this.items[i] = this.items[p]; i = p; }
        this.items[i] = item;
    }
    pop() {
        const first = this.items[0], last = this.items.pop();
        if (!this.items.length || !last) return first;
        let i = 0;
        while (i * 2 + 1 < this.items.length) {
            let child = i * 2 + 1;
            if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child++;
            if (last.score <= this.items[child].score) break;
            this.items[i] = this.items[child]; i = child;
        }
        this.items[i] = last;
        return first;
    }
}

/** Rectilinear routing with obstacle clearance and a cost for shared lanes, crossings, and extra bends. */
export function routeFlowEdges(nodes: Node[], edges: Edge[], measurements: FlowMeasurements = {}): Map<string, FlowRoute> {
    const result = new Map<string, FlowRoute>();
    if (!nodes.length || !edges.length) return result;
    const byId = new Map(nodes.map(node => [node.id, node]));
    const rects = new Map(nodes.map(node => [node.id, flowNodeRect(node, measurements)]));
    const obstacles = [...rects.values()].map(r => ({ x: r.x - CLEARANCE, y: r.y - CLEARANCE, width: r.width + 2 * CLEARANCE, height: r.height + 2 * CLEARANCE }));
    const ends = edges.flatMap(edge => {
        const source = byId.get(edge.source), target = byId.get(edge.target);
        return source && target ? [{ edge, source: endpoint(source, rects.get(source.id)!, edge.sourceHandle, 'source'),
            target: endpoint(target, rects.get(target.id)!, edge.targetHandle, 'target') }] : [];
    });
    const coordinates = (axis: 'x' | 'y') => {
        const size = axis === 'x' ? 'width' : 'height';
        const bounds = obstacles.flatMap(r => [r[axis], r[axis] + r[size]]);
        const values = [...bounds, ...ends.flatMap(e => [e.source.stub[axis], e.target.stub[axis]])];
        for (const bound of bounds) values.push(bound - LANE, bound + LANE);
        const sorted = [...new Set(bounds)].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] >= 2 * LANE) {
            const middle = (sorted[i] + sorted[i - 1]) / 2;
            values.push(middle, middle - LANE / 2, middle + LANE / 2);
        }
        values.push(Math.min(...bounds) - 40, Math.max(...bounds) + 40);
        return [...new Set(values)].sort((a, b) => a - b);
    };
    const xs = coordinates('x'), ys = coordinates('y'), width = xs.length, count = width * ys.length;
    const xIndex = new Map(xs.map((x, i) => [x, i])), yIndex = new Map(ys.map((y, i) => [y, i]));
    const pointAt = (index: number) => ({ x: xs[index % width], y: ys[Math.floor(index / width)] });
    const pointIndex = (point: FlowPoint) => yIndex.get(point.y)! * width + xIndex.get(point.x)!;
    // per grid step (keyOf): 0 not checked yet, 1 clear of every obstacle, 2 blocked; and how many routes use it
    const clear = new Uint8Array(count * 2), occupied = new Uint16Array(count * 2);
    const vertices = new Uint16Array(count * 2);
    const keyOf = (from: number, to: number, direction: number) => Math.min(from, to) * 2 + direction;
    const blocked = (from: FlowPoint, to: FlowPoint) => obstacles.some(rect => segmentRect(from, to, rect));
    // the search's arrays, shared by the edges: a state's cost and parent count only when `reached` holds this edge's
    // number, so no edge clears them
    const costs = new Float64Array(count * 2), parents = new Int32Array(count * 2), reached = new Uint32Array(count * 2);
    let search = 0;
    ends.sort((a, b) => Math.abs(a.source.stub.x - a.target.stub.x) + Math.abs(a.source.stub.y - a.target.stub.y) -
        Math.abs(b.source.stub.x - b.target.stub.x) - Math.abs(b.source.stub.y - b.target.stub.y) || a.edge.id.localeCompare(b.edge.id));
    for (const { edge, source, target } of ends) {
        const start = pointIndex(source.stub), finish = pointIndex(target.stub);
        const round = ++search;
        const costOf = (state: number) => reached[state] === round ? costs[state] : Infinity;
        const queue = new Queue();
        const targetX = target.stub.x, targetY = target.stub.y;
        const heuristic = (i: number) => Math.abs(xs[i % width] - targetX) + Math.abs(ys[Math.floor(i / width)] - targetY);
        const initial = start * 2 + (horizontal(source.side) ? 0 : 1);
        costs[initial] = 0; parents[initial] = -1; reached[initial] = round;
        queue.push({ state: initial, cost: 0, score: heuristic(start) });
        let last = -1;
        for (let entry = queue.pop(); entry; entry = queue.pop()) {
            const { state, cost } = entry, index = Math.floor(state / 2), previousDirection = state % 2;
            if (cost !== costOf(state)) continue;
            if (index === finish) { last = state; break; }
            const col = index % width, row = Math.floor(index / width);
            const fromX = xs[col], fromY = ys[row];
            for (let n = 0; n < 4; n++) {
                const next = n === 0 ? (col > 0 ? index - 1 : -1) : n === 1 ? (col + 1 < width ? index + 1 : -1)
                    : n === 2 ? (row > 0 ? index - width : -1) : (row + 1 < ys.length ? index + width : -1);
                if (next < 0) continue;
                const direction = n < 2 ? 0 : 1, key = keyOf(index, next, direction);
                const toX = xs[next % width], toY = ys[Math.floor(next / width)];
                if (clear[key] === 0) clear[key] = blocked({ x: fromX, y: fromY }, { x: toX, y: toY }) ? 2 : 1;
                if (clear[key] === 2) continue;
                const distance = Math.abs(fromX - toX) + Math.abs(fromY - toY);
                const nextCost = cost + distance * (1 + occupied[key] * 12) + (previousDirection === direction ? 0 : 18) +
                    (vertices[next * 2 + 1 - direction] > 0 ? 30 : 0);
                const nextState = next * 2 + direction;
                if (nextCost >= costOf(nextState)) continue;
                costs[nextState] = nextCost; parents[nextState] = state; reached[nextState] = round;
                queue.push({ state: nextState, cost: nextCost, score: nextCost + heuristic(next) });
            }
        }
        if (last < 0) continue; // The renderer retains its normal edge until valid node measurements arrive.
        const indices: number[] = [];
        for (let state = last; state >= 0; state = parents[state]) indices.push(Math.floor(state / 2));
        indices.reverse();
        for (let i = 1; i < indices.length; i++) {
            const from = indices[i - 1], to = indices[i], direction = Math.abs(from - to) === 1 ? 0 : 1;
            const key = keyOf(from, to, direction);
            occupied[key]++;
            vertices[from * 2 + direction]++; vertices[to * 2 + direction]++;
        }
        const points = simplify([source.point, ...indices.map(pointAt), target.point]);
        result.set(edge.id, { points, label: points[Math.floor(points.length / 2)] });
    }
    // Place labels after routing so a badge does not cover a node, another badge, or an unrelated line.
    const labels: FlowRect[] = [];
    const allSegments = [...result].flatMap(([id, route]) => route.points.slice(1).map((p, i) => ({ id, a: route.points[i], b: p })));
    for (const [id, route] of result) {
        const candidates = route.points.slice(1).flatMap((b, i) => [0.5, 0.25, 0.75].map(t => ({ x: route.points[i].x + (b.x - route.points[i].x) * t, y: route.points[i].y + (b.y - route.points[i].y) * t })));
        const edge = edges.find(edge => edge.id === id)!;
        const inserter = [byId.get(edge.source), byId.get(edge.target)].find(node => node?.type === 'inserterNode');
        const items = inserter?.data.filterIcons as string[] | undefined;
        const outputItems = edge.data?.outputItems as FlowOutputItem[] | undefined;
        const card = outputItems?.length ? outputLabelLayout(outputItems) : null;
        const height = card?.height ?? 24 * Math.max(1, Math.min(3, items?.length ?? 1));
        const labelWidth = card?.width ?? 86;
        let placed = false;
        placement: for (const distance of [0, 28, 56, 84, 112, 168, 224]) {
            for (const anchor of candidates) for (const [dx, dy] of distance ? [[distance, 0], [-distance, 0], [0, distance], [0, -distance]] : [[0, 0]]) {
                const label = { x: anchor.x + dx, y: anchor.y + dy };
                const box = { x: label.x - labelWidth / 2, y: label.y - height / 2, width: labelWidth, height };
                if ([...rects.values(), ...labels].some(rect => overlaps(box, rect)) || allSegments.some(segment => segment.id !== id && segmentRect(segment.a, segment.b, box))) continue;
                route.label = label; if (distance) route.labelAnchor = anchor;
                if (card || edge.data?.labelText) route.labelBounds = box;
                labels.push(box); placed = true; break placement;
            }
        }
        if (!placed) {
            const anchor = route.points[Math.floor(route.points.length / 2)];
            const x = Math.min(...obstacles.map(rect => rect.x)) - (card ? labelWidth / 2 + 24 : 120);
            let y = anchor.y;
            while (labels.some(rect => overlaps({ x: x - labelWidth / 2, y: y - height / 2, width: labelWidth, height }, rect))) y += height + 12;
            route.label = { x, y }; route.labelAnchor = anchor;
            const box = { x: x - labelWidth / 2, y: y - height / 2, width: labelWidth, height };
            if (card || edge.data?.labelText) route.labelBounds = box;
            labels.push(box);
        }
    }
    return result;
}

/** Fit visible result cards along with the nodes, including labels routed outside the node envelope. */
export function flowGraphBounds(nodes: Node[], routes: ReadonlyMap<string, FlowRoute>, measurements: FlowMeasurements = {}): FlowRect | null {
    const rects = [...nodes.map(node => flowNodeRect(node, measurements)), ...[...routes.values()].flatMap(route => route.labelBounds ? [route.labelBounds] : [])];
    if (!rects.length) return null;
    const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
    return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}

/** Match measured handle centres without introducing diagonal endpoint segments. */
export function attachFlowRoute(points: FlowPoint[], source: FlowPoint, target: FlowPoint): FlowPoint[] {
    if (points.length < 2) return [source, target];
    const sourceHorizontal = points[0].y === points[1].y;
    if (points.length === 2) {
        const middle = sourceHorizontal ? (source.x + target.x) / 2 : (source.y + target.y) / 2;
        return simplify(sourceHorizontal ? [source, { x: middle, y: source.y }, { x: middle, y: target.y }, target]
            : [source, { x: source.x, y: middle }, { x: target.x, y: middle }, target]);
    }
    const attached = points.map(point => ({ ...point }));
    attached[0] = source;
    attached[1][sourceHorizontal ? 'y' : 'x'] = source[sourceHorizontal ? 'y' : 'x'];
    const last = attached.length - 1;
    const targetHorizontal = points[last].y === points[last - 1].y;
    attached[last] = target;
    attached[last - 1][targetHorizontal ? 'y' : 'x'] = target[targetHorizontal ? 'y' : 'x'];
    return simplify(attached);
}

/** Soft corners preserve rectilinear clearance; the path stays within the routing corridor. */
export function flowRoutePath(points: FlowPoint[], radius = 5): string {
    if (points.length < 2) return '';
    const fmt = (n: number) => Math.round(n * 1000) / 1000;
    let path = `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1], b = points[i], c = points[i + 1];
        const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y);
        const r = Math.min(radius, before / 2, after / 2);
        if (!r) continue;
        path += `L${fmt(b.x + (a.x - b.x) * r / before)} ${fmt(b.y + (a.y - b.y) * r / before)}Q${fmt(b.x)} ${fmt(b.y)} ${fmt(b.x + (c.x - b.x) * r / after)} ${fmt(b.y + (c.y - b.y) * r / after)}`;
    }
    const last = points.at(-1)!;
    return `${path}L${fmt(last.x)} ${fmt(last.y)}`;
}
