import type { PlannerGraph } from "../../data-types/planner-graph";

/**
 * The snapshot of a sample's planner graph (P3 1.7), one file a sample: the graph as it is, with the sample's key after
 * the schema. It holds only the figures the feasibility pass reads (an edge's hand, floor cycle and ceiling as an exact
 * ratio), never a planned one, so a trait change that moves a bound shows in its diff.
 */
export function graphSnapshotOf(graph: PlannerGraph, sample: string): string {
    const { schema, ...rest } = graph;
    return `${JSON.stringify({ schema, sample, ...rest }, null, 2)}\n`;
}
