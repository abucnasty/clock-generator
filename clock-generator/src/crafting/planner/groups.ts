/**
 * The groups of a build: the connected parts of its condensed planner graph once the SINK and the sources of no known
 * bound are taken out. Such a source brings what the build takes from outside: a container or a lane port nothing drops
 * on, and a port of a container of constant supply (an infinity chest that gives the item). Two groups share no node,
 * so each can be planned alone; a loop is one composite node and lies in one group whole.
 */
import type { PlannerFacts } from "../../data-types/planner-facts";
import type { PlannerGraph } from "../../data-types/planner-graph";
import type { UnboundedSource } from "../../data-types/build-plan";
import { arcsOf, SINK } from "../graph/build-graph";
import type { Arc } from "../graph/components";

/** A group before its periods and duty are planned */
export interface GroupShape {
    readonly key: string;
    /** Its entries of the graph's order */
    readonly members: readonly string[];
    /** Its vertices: the members, a loop by its own vertices */
    readonly vertices: readonly string[];
    /** The carrying edges into or out of its vertices, in edge order */
    readonly edges: readonly string[];
}

export interface Groups {
    readonly unbounded_sources: readonly UnboundedSource[];
    readonly groups: readonly GroupShape[];
}

/** The node key of a vertex: a port belongs to the node before its `#` */
const nodeOf = (vertex: string): string => vertex.split("#")[0];

/**
 * The container and lane ports something takes from that a group may not hold: those of a container of constant supply
 * that gives the item, unless it lies in a loop (a loop is one node and stays whole), and those nothing drops on
 */
function unboundedSourcesOf(facts: PlannerFacts, graph: PlannerGraph, arcs: readonly Arc[]): UnboundedSource[] {
    const node = new Map(facts.nodes.map(it => [it.key, it]));
    const taken = new Set(arcs.map(arc => arc.from));
    const filled = new Set(arcs.map(arc => arc.to));
    const in_loop = new Set(graph.components.flatMap(component => component.members));
    return graph.nodes.flatMap(graph_node => graph_node.kind !== "container" && graph_node.kind !== "lane" ? []
        : graph_node.ports.filter(port => taken.has(port)).flatMap((port): UnboundedSource[] => {
            const facts_node = node.get(nodeOf(port));
            const item = port.slice(port.indexOf("#") + 1);
            if (facts_node?.kind === "container" && facts_node.storage.constant_supply && facts_node.storage.gives.includes(item)
                && !in_loop.has(port)) {
                return [{ vertex: port, kind: "infinity-supply" }];
            }
            return filled.has(port) ? [] : [{ vertex: port, kind: "nothing-drops-on" }];
        }));
}

/**
 * The groups of a build, numbered in the order of their first entry in the graph's order
 */
export function groupsOf(facts: PlannerFacts, graph: PlannerGraph): Groups {
    const carrying = graph.edges.filter(edge => edge.lands_in !== null);
    const arcs = carrying.flatMap(arcsOf);
    const unbounded_sources = unboundedSourcesOf(facts, graph, arcs);
    const removed = new Set([SINK, ...unbounded_sources.map(source => source.vertex)]);

    // union-find over the vertices that stay, joined by every arc between two of them
    const parent = new Map<string, string>();
    const find = (vertex: string): string => {
        let root = vertex;
        while (parent.get(root) !== root) root = parent.get(root)!;
        return root;
    };
    // a vertex no arc touches is in no group: a machine with no inserter, or a container port only stored into (its arcs
    // go straight into the SINK)
    const touched = new Set(arcs.flatMap(arc => [arc.from, arc.to]).filter(vertex => !removed.has(vertex)));
    touched.forEach(vertex => parent.set(vertex, vertex));
    for (const arc of arcs) {
        if (!touched.has(arc.from) || !touched.has(arc.to)) continue;
        const [a, b] = [find(arc.from), find(arc.to)];
        if (a !== b) parent.set(b, a);
    }

    // the graph's order: a loop by its key, its vertices in it
    const loop = new Map(graph.components.map(component => [component.key, component.members]));
    const by_root = new Map<string, { members: string[]; vertices: string[] }>();
    for (const entry of graph.order) {
        const entry_vertices = (loop.get(entry) ?? [entry]).filter(vertex => touched.has(vertex));
        if (entry_vertices.length === 0) continue;
        const root = find(entry_vertices[0]);
        if (!by_root.has(root)) by_root.set(root, { members: [], vertices: [] });
        const group = by_root.get(root)!;
        group.members.push(entry);
        group.vertices.push(...entry_vertices);
    }
    const groups = [...by_root.values()].map((group, at): GroupShape => {
        const inside = new Set(group.vertices);
        return {
            key: `group:${at + 1}`,
            members: group.members,
            vertices: group.vertices,
            edges: carrying.filter(edge => inside.has(edge.to) || edge.from_ports.some(port => inside.has(port))).map(edge => edge.key),
        };
    });
    return { unbounded_sources, groups };
}
