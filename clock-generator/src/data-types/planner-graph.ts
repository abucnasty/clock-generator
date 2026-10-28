/**
 * The planner graph of a build (plannerGraphOf, crafting/graph/build-graph.ts): its planner facts
 * (data-types/planner-facts.ts) as nodes with item ports, edges between them, the loops condensed into composite nodes,
 * one topological order, the shared nodes and the terminal edges into one SINK (P3 design, section 1). Plain, JSON-safe
 * data; this module imports only types, so a page can take them from the light entry.
 *
 * Keys:
 * - a node is keyed as its facts node, "machine:3", "chest:4", "drill:1", "belt:2/lane:1", and the SINK "sink";
 * - a container and a lane carry items through one port per item, "chest:4#iron-ore", "belt:2/lane:1#iron-ore", and a
 *   silo takes what its fixed recipe uses into a port of its input slots, "chest:7#input:rocket-fuel";
 * - a machine and a drill are not split: their recipe ties their items together.
 * The vertices of the graph are the machines, the drills, the ports and the SINK. An edge runs from the vertices it takes
 * from to the vertex it drops into.
 *
 * Only the figures the feasibility pass reads are kept (an inserter edge's hand, floor cycle and ceiling); the planned
 * figures are the facts'.
 */
import type { FactsRatio, InserterLandsIn, PlacementLandsIn, PlannerTarget } from "./planner-facts";

export type GraphNodeKind = "machine" | "drill" | "lane" | "container" | "sink";

/** A node, with its item ports in key order; a machine, a drill and the SINK have none */
export interface GraphNode {
    readonly key: string;
    readonly kind: GraphNodeKind;
    readonly ports: readonly string[];
}

/** What an edge is: an inserter's item, a placer's result, or a loader's item (not built yet: a loader is refused by class) */
export type GraphEdgeVia = "inserter" | "placement" | "loader";

/**
 * Why an edge is terminal, by trait (P3 1.4):
 * - "storage": into a container that never refuses (`storage.never_refuses`): its share of the target, or of a by-product
 *   the recipe sets;
 * - "output-lane": onto a lane port no edge takes from: its share, at most the lane's ceiling;
 * - "export-lane": onto either side of a belt that consumers outside the build empty of the item
 *   (`lane.export_per_second` of a lane of the belt that carries it): that demand, per belt and item;
 * - "destroyed": into a machine that destroys the target item (`target.counts` "destroyed"), from a container or a lane
 *   the build puts nothing into: the target.
 */
export type TerminalKind = "storage" | "output-lane" | "export-lane" | "destroyed";

/**
 * An edge of one item, keyed as its facts edge ("inserter:5/iron-plate", "placement:drill:1/iron-ore"). A terminal edge
 * keeps the vertex it drops into in `to` and goes on into the SINK: the SINK's in-edges are the terminal edges. Onto a
 * lane or into a destroying machine, its arc runs into that vertex and on from it into the SINK; into storage, straight
 * into the SINK (arcsOf, crafting/graph/build-graph.ts).
 */
export interface GraphEdge {
    readonly key: string;
    readonly via: GraphEdgeVia;
    /** The inserter or the placer */
    readonly entity: string;
    /** The inserter's capacity group: the edges of one inserter swing for one item at a time; null for a placement */
    readonly group: string | null;
    readonly item: string;
    /** The vertex it takes from: a machine, a drill, or a container's or a lane's port of the item */
    readonly from: string;
    /** Every vertex it takes from: `from`, and for a belt every lane port of the item (the facts' `from_lanes`) */
    readonly from_ports: readonly string[];
    /** The vertex it drops into; the node, not a port, where that node takes none of the item (`lands_in` null) */
    readonly to: string;
    /** Where the item lands in the sink; null where it takes none: the edge carries nothing and makes no arc */
    readonly lands_in: InserterLandsIn | PlacementLandsIn | null;
    /** The hand the simulator moves of the item; null for a placement */
    readonly hand: number | null;
    /** The fewest ticks a swing of the item takes; null for a placement and where no sound bound is known */
    readonly floor_cycle: number | null;
    /** The most of the item it moves a second, hand x 60 / floor cycle, exact; null where there is no bound of its own */
    readonly ceiling: FactsRatio | null;
    /** Why it goes into the SINK; null for an edge inside the build */
    readonly terminal: TerminalKind | null;
}

/**
 * A loop: a strongly connected component of the vertices with more than one vertex, or one with an arc to itself,
 * condensed into one composite node ("loop:1", numbered in the order of their first vertex)
 */
export interface GraphComponent {
    readonly key: string;
    /** Its vertices, in registry order */
    readonly members: readonly string[];
    /** The looping ingredients of its machines (`loop.looping_ingredients`): a loop with any must be seeded */
    readonly looping_items: readonly string[];
    /** The edges between its members */
    readonly inside: readonly string[];
    /** The edges that drop into a member from outside it */
    readonly in: readonly string[];
    /** The edges that take from a member and drop outside it or into the SINK */
    readonly out: readonly string[];
}

/** A vertex and an item with two or more edges of it on one side, those edges in edge order */
export interface SharedVertex {
    readonly at: string;
    readonly item: string;
    readonly edges: readonly string[];
}

export interface GraphShared {
    /** A machine, a drill or a container port with two or more out-edges of one item: its takers compete */
    readonly out: readonly SharedVertex[];
    /** A vertex with two or more in-edges of one item: its feeders compete for its room */
    readonly in: readonly SharedVertex[];
    /** A lane port with two or more takers: pickups compete on one lane */
    readonly lanes: readonly SharedVertex[];
}

export interface PlannerGraph {
    readonly schema: 1;
    readonly target: Pick<PlannerTarget, "item" | "counts" | "per_copy">;
    /** The facts' nodes in registry order, then the SINK */
    readonly nodes: readonly GraphNode[];
    /** In the facts' order: inserter edges by inserter, then placement edges */
    readonly edges: readonly GraphEdge[];
    /** The loops, in the order of their first vertex */
    readonly components: readonly GraphComponent[];
    /**
     * The condensed graph in one topological order: a vertex outside every loop by its key, a loop by its component's
     * key, the SINK last; ties broken by registry order (a loop by its first vertex). A flow order: every vertex after
     * those it is fed from, but for a storage port, which only the SINK follows (arcsOf)
     */
    readonly order: readonly string[];
    readonly shared: GraphShared;
    /** The terminal edges, in edge order: the SINK's in-edges */
    readonly terminal: readonly string[];
}
