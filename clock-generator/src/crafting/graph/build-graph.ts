import type { PlannerEdge, PlannerFacts, PlannerNode, PlannerTarget } from "../../data-types/planner-facts";
import type {
    GraphComponent,
    GraphEdge,
    GraphNode,
    PlannerGraph,
    SharedVertex,
    TerminalKind,
} from "../../data-types/planner-graph";
import { Arc, condense } from "./components";

/** The node every terminal edge goes on into: the build's outside */
export const SINK = "sink";

/** The port of a container or a lane for an item */
const portOf = (node: string, item: string): string => `${node}#${item}`;

/** The port of a silo's input slots for an item */
const inputPortOf = (node: string, item: string): string => `${node}#input:${item}`;

/** The item a lane carries, where it lists one: "" (listed, carries nothing) and null (unlisted second side) are none */
function laneItemOf(node: PlannerNode): string | null {
    return node.kind === "lane" && node.lane.item !== null && node.lane.item !== "" ? node.lane.item : null;
}

/** The vertex of a node for an item: the node itself for a machine or a drill, else its port of the item */
function vertexOf(node: PlannerNode, item: string, lands_in: string | null = null): string {
    if (node.kind === "machine" || node.kind === "drill") return node.key;
    return lands_in === "input-slots" ? inputPortOf(node.key, item) : portOf(node.key, item);
}

/** An edge's ends as vertices, before it is judged terminal */
function endsOf(edge: PlannerEdge, nodes: ReadonlyMap<string, PlannerNode>): Pick<GraphEdge, "from" | "from_ports" | "to"> {
    const from = vertexOf(nodes.get(edge.from)!, edge.item);
    const lanes = edge.via === "inserter" ? edge.from_lanes : [];
    const sink = nodes.get(edge.to)!;
    return {
        from,
        from_ports: lanes.length > 0 ? lanes.map(lane => portOf(lane, edge.item)) : [from],
        to: edge.lands_in === null ? sink.key : vertexOf(sink, edge.item, edge.lands_in),
    };
}

/**
 * Why an edge is terminal, by the traits of its ends (P3 1.4), or null. `taken` holds every port some edge takes from;
 * `filled` every entity some edge drops into.
 */
function terminalOf(
    edge: PlannerEdge,
    to: string,
    nodes: ReadonlyMap<string, PlannerNode>,
    target: Pick<PlannerTarget, "item" | "counts">,
    taken: ReadonlySet<string>,
    filled: ReadonlySet<string>,
): TerminalKind | null {
    if (edge.lands_in === null) return null;
    const sink = nodes.get(edge.to)!;
    if (sink.kind === "container" && sink.storage.never_refuses) return "storage";
    if (sink.kind === "lane") {
        // export demand is per belt and item: a drop on either side of a belt that exports the item fills it
        const exporting = [...nodes.values()].some(node => node.kind === "lane" && node.entity === sink.entity
            && node.lane.item === edge.item && node.lane.export_per_second !== null && node.lane.export_per_second > 0);
        if (exporting) return "export-lane";
        if (!taken.has(to)) return "output-lane";
    }
    // a destroyed target: brought into a machine that uses it, from a container or a belt the build puts nothing into
    const source = nodes.get(edge.from)!;
    if (target.counts === "destroyed" && edge.via === "inserter" && edge.item === target.item && sink.kind === "machine"
        && sink.production.inputs.some(input => input.item === edge.item)
        && (source.kind === "container" || source.kind === "lane") && !filled.has(source.entity)) {
        return "destroyed";
    }
    return null;
}

/**
 * The arcs of an edge that carries an item. An inside edge runs from each vertex it takes from into the vertex it drops
 * into. A terminal edge onto a lane or into a machine that destroys the target does too, and that vertex goes on into
 * the SINK: what the build puts there leaves it, after the flow that fills it. A terminal edge into storage runs straight
 * into the SINK, not into the container's port: an infinity chest that also gives the item would close a false loop.
 */
export function arcsOf(edge: Pick<GraphEdge, "from_ports" | "to" | "terminal">): Arc[] {
    if (edge.terminal === "storage") return edge.from_ports.map(from => ({ from, to: SINK }));
    const arcs = edge.from_ports.map(from => ({ from, to: edge.to }));
    return edge.terminal === null ? arcs : [...arcs, { from: edge.to, to: SINK }];
}

/** Entries of two or more edges per vertex and item, in registry order of the vertex, then by item */
function sharedOf(entries: readonly { at: string; item: string; edge: string }[], rank: ReadonlyMap<string, number>): SharedVertex[] {
    const groups = new Map<string, SharedVertex & { edges: string[] }>();
    for (const { at, item, edge } of entries) {
        const key = `${at}\n${item}`;
        if (!groups.has(key)) groups.set(key, { at, item, edges: [] });
        const group = groups.get(key)!;
        if (!group.edges.includes(edge)) group.edges.push(edge);
    }
    return [...groups.values()].filter(group => group.edges.length > 1)
        .sort((a, b) => rank.get(a.at)! - rank.get(b.at)! || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
}

/**
 * The planner graph of a build from its planner facts (P3 section 1): nodes with item ports, an edge per inserter item
 * and per placed result, the loops condensed into composite nodes, one topological order, the shared nodes, and the
 * terminal edges into the SINK. Facts in, graph out: it reads nothing else, no config and no entity.
 *
 * An edge whose sink takes none of its item (`lands_in` null) carries nothing: it makes no arc, no port, no shared node
 * and is never terminal. An edge from a belt takes from every lane of the belt that carries its item (`from_lanes`).
 */
export function plannerGraphOf(facts: PlannerFacts, target: PlannerTarget = facts.target): PlannerGraph {
    const nodes = new Map(facts.nodes.map(node => [node.key, node]));
    const ends = facts.edges.map(edge => endsOf(edge, nodes));
    const carrying = facts.edges.flatMap((edge, at) => edge.lands_in === null ? [] : [{ edge, ...ends[at] }]);

    const taken = new Set(carrying.flatMap(edge => edge.from_ports));
    const filled = new Set(carrying.map(edge => nodes.get(edge.edge.to)!.entity));
    const edges: GraphEdge[] = facts.edges.map((edge, at) => ({
        key: edge.key,
        via: edge.via,
        entity: edge.entity,
        group: edge.via === "inserter" ? edge.group : null,
        item: edge.item,
        ...ends[at],
        lands_in: edge.lands_in,
        hand: edge.via === "inserter" ? edge.hand.by_item : null,
        floor_cycle: edge.via === "inserter" ? edge.floor.cycle : null,
        ceiling: edge.ceiling,
        terminal: terminalOf(edge, ends[at].to, nodes, target, taken, filled),
    }));
    const terminal_of = new Map(edges.map(edge => [edge.key, edge.terminal]));

    // the ports of each container and lane: what its edges carry through it, and a lane's own item
    const ports = new Map<string, Set<string>>(facts.nodes.map(node => [node.key, new Set()]));
    for (const node of facts.nodes) {
        const item = laneItemOf(node);
        if (item !== null) ports.get(node.key)!.add(portOf(node.key, item));
    }
    for (const edge of carrying) {
        for (const port of [...edge.from_ports, edge.to]) {
            const node = port.split("#")[0];
            if (port !== node) ports.get(node)!.add(port);
        }
    }
    const graph_nodes: GraphNode[] = [
        ...facts.nodes.map(node => ({ key: node.key, kind: node.kind, ports: [...ports.get(node.key)!].sort() })),
        { key: SINK, kind: "sink", ports: [] },
    ];

    // the vertices in registry order, and the arcs of the edges that carry an item
    const vertices = graph_nodes.flatMap(node => node.kind === "machine" || node.kind === "drill" || node.kind === "sink" ? [node.key] : node.ports);
    const rank = new Map(vertices.map((vertex, at) => [vertex, at]));
    const arcs = edges.filter(edge => edge.lands_in !== null).flatMap(arcsOf);
    const condensed = condense(vertices, arcs);

    const components: GraphComponent[] = condensed.loops.map((at, number) => {
        const members = condensed.components[at];
        const inside = new Set(members);
        const looping_items = [...new Set(members.flatMap(member => {
            const node = nodes.get(member);
            return node?.kind === "machine" ? node.loop.looping_ingredients : [];
        }))];
        const keysOf = (keep: (edge: typeof carrying[number], terminal: boolean) => boolean) =>
            carrying.filter(edge => keep(edge, terminal_of.get(edge.edge.key) !== null)).map(edge => edge.edge.key);
        return {
            key: `loop:${number + 1}`,
            members,
            looping_items,
            inside: keysOf((edge, terminal) => !terminal && inside.has(edge.to) && edge.from_ports.every(port => inside.has(port))),
            in: keysOf(edge => inside.has(edge.to) && edge.from_ports.some(port => !inside.has(port))),
            out: keysOf((edge, terminal) => edge.from_ports.some(port => inside.has(port)) && (terminal || !inside.has(edge.to))),
        };
    });
    const loop_key = new Map(condensed.loops.map((at, number) => [at, components[number].key]));
    const order = condensed.order.map(at => loop_key.get(at) ?? condensed.components[at][0]);

    const kind_of = new Map(graph_nodes.map(node => [node.key, node.kind]));
    const takes = carrying.flatMap(edge => edge.from_ports.map(at => ({ at, item: edge.edge.item, edge: edge.edge.key })));
    const isLanePort = (vertex: string) => kind_of.get(vertex.split("#")[0]) === "lane";

    return {
        schema: 1,
        target: { item: target.item, counts: target.counts, per_copy: target.per_copy },
        nodes: graph_nodes,
        edges,
        components,
        order,
        shared: {
            out: sharedOf(takes.filter(take => !isLanePort(take.at)), rank),
            in: sharedOf(carrying.map(edge => ({ at: edge.to, item: edge.edge.item, edge: edge.edge.key })), rank),
            lanes: sharedOf(takes.filter(take => isLanePort(take.at)), rank),
        },
        terminal: edges.filter(edge => edge.terminal !== null).map(edge => edge.key),
    };
}
