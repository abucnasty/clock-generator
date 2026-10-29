import type { InserterCoverageIssue } from "../../config/errors";
import type { PlannerFacts } from "../../data-types/planner-facts";
import type { PlannerGraph } from "../../data-types/planner-graph";
import { arcsOf, SINK } from "./build-graph";

/** A machine's input or result that no edge brings in or takes out */
export interface UncoveredPort {
    readonly side: "input" | "output";
    readonly at: string;
    readonly item: string;
}

/**
 * The machine inputs (ingredients and the fuel) and results with a positive yield that no edge carries in or out: the
 * ports the inserter coverage check reports (config/inserter-coverage-validator.ts), in node order. The check looks at
 * every result; a result with no expected yield is left out here. No sample has one without a taker.
 */
export function uncoveredPortsOf(facts: PlannerFacts, graph: PlannerGraph): UncoveredPort[] {
    const carrying = graph.edges.filter(edge => edge.lands_in !== null);
    const uncovered: UncoveredPort[] = [];
    for (const node of facts.nodes) {
        if (node.kind !== "machine") continue;
        const inputs = [...new Set([...node.production.inputs.map(input => input.item), ...node.energy.fuel === null ? [] : [node.energy.fuel.item]])];
        for (const item of inputs) {
            if (!carrying.some(edge => edge.to === node.key && edge.item === item)) uncovered.push({ side: "input", at: node.key, item });
        }
        for (const result of node.yield.results) {
            if (result.expected_per_craft > 0 && !carrying.some(edge => edge.from_ports.includes(node.key) && edge.item === result.item)) {
                uncovered.push({ side: "output", at: node.key, item: result.item });
            }
        }
    }
    return uncovered;
}

/** The coverage check's issues as ports */
export function portsOfCoverageIssues(issues: readonly InserterCoverageIssue[]): UncoveredPort[] {
    return issues.map(issue => ({
        side: issue.kind === "missing_input_inserter" ? "input" : "output",
        at: `machine:${issue.machine_id}`,
        item: issue.item_name,
    }));
}

const NODE_KEY = /^((machine|drill|chest):\d+|belt:\d+\/lane:[12]|sink)$/;
const PORT_KEY = /^(chest:\d+|belt:\d+\/lane:[12])#(input:)?[^#]+$/;
const EDGE_KEY = /^(inserter:\d+|placement:(machine|drill):\d+)\/[^#/]+$/;

const sameAs = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((value, at) => value === b[at]);

/**
 * What breaks the graph's invariants (P3 1.6), one line each; none for a sound graph. `coverage` is the coverage check's
 * issues of the same config, where the caller has them: the graph's uncovered ports must be exactly those (item 3).
 * Item 8 (byte-equal when built twice) and item 9 (its size) are the tests'.
 */
export function graphInvariantIssues(facts: PlannerFacts, graph: PlannerGraph, coverage?: readonly UncoveredPort[]): string[] {
    const issues: string[] = [];
    const node_of = new Map(facts.nodes.map(node => [node.key, node]));
    const vertices = new Set(graph.nodes.flatMap(node => node.kind === "lane" || node.kind === "container" ? node.ports : [node.key]));
    const keys = new Set([...graph.nodes.map(node => node.key), ...vertices]);
    const entityOf = (vertex: string) => vertex === SINK ? SINK : node_of.get(vertex.split("#")[0])?.entity;

    // 1. an edge per inserter and item it carries, and per placed result, and nothing else
    if (!sameAs(graph.edges.map(edge => edge.key), facts.edges.map(edge => edge.key))) issues.push("1: the edges are not the facts' edges");
    for (const group of facts.capacity_groups) {
        const of_group = graph.edges.filter(edge => edge.group === group.group).map(edge => edge.key);
        if (!sameAs(of_group, group.edges.map(edge => edge.edge))) issues.push(`1: ${group.group} has edges ${of_group.join(", ")}`);
    }

    // 2. ends that exist; the edges of one inserter share its group, its source entity and its sink entity
    for (const edge of graph.edges) {
        for (const end of [edge.from, ...edge.from_ports, edge.to]) {
            if (!keys.has(end)) issues.push(`2: ${edge.key} ends at ${end}, which is no node or port`);
        }
        if (!edge.from_ports.includes(edge.from)) issues.push(`2: ${edge.key} takes from ${edge.from}, not among its ports`);
    }
    for (const entity of new Set(graph.edges.map(edge => edge.entity))) {
        const own = graph.edges.filter(edge => edge.entity === entity);
        const ends = new Set(own.map(edge => `${edge.group} ${entityOf(edge.from)} ${entityOf(edge.to)}`));
        if (ends.size > 1) issues.push(`2: the edges of ${entity} differ in group or ends: ${[...ends].join("; ")}`);
    }

    // 3. coverage agrees with the coverage check
    if (coverage !== undefined) {
        const line = (port: UncoveredPort) => `${port.side} ${port.at} ${port.item}`;
        const graph_ports = uncoveredPortsOf(facts, graph).map(line).sort();
        const checked = coverage.map(line).sort();
        if (!sameAs(graph_ports, checked)) issues.push(`3: uncovered ports [${graph_ports.join(", ")}], the coverage check [${checked.join(", ")}]`);
    }

    // 4. the condensed graph is a DAG in its order: every vertex once, outside a loop by itself, in one by its loop
    const condensed_of = new Map<string, string>([...vertices].map(vertex => [vertex, vertex]));
    for (const component of graph.components) {
        for (const member of component.members) {
            if (condensed_of.get(member) !== member) issues.push(`4: ${member} is in ${component.key} and elsewhere`);
            condensed_of.set(member, component.key);
        }
    }
    const condensed = [...new Set(condensed_of.values())];
    const position = new Map(graph.order.map((key, at) => [key, at]));
    if (graph.order.length !== condensed.length || condensed.some(key => !position.has(key))) issues.push("4: the order is not every condensed vertex once");
    if (graph.order[graph.order.length - 1] !== SINK) issues.push("4: the SINK is not last in the order");
    // every arc forward: an edge's from each vertex it takes from into the one it drops into, and a terminal edge's on
    // into the SINK (a storage drop's straight there); an end that is no vertex is item 2's
    for (const edge of graph.edges.filter(it => it.lands_in !== null)) {
        for (const arc of arcsOf(edge)) {
            const from = condensed_of.get(arc.from);
            const to = condensed_of.get(arc.to);
            if (from === undefined || to === undefined || from === to) continue;
            if (!(position.get(from)! < position.get(to)!)) issues.push(`4: ${edge.key} runs back in the order, ${from} to ${to}`);
        }
    }

    // 5. one SINK; the terminal edges are its in-edges
    if (graph.nodes.filter(node => node.kind === "sink").length !== 1 || graph.nodes[graph.nodes.length - 1].key !== SINK) issues.push("5: not one SINK, last");
    if (!sameAs(graph.terminal, graph.edges.filter(edge => edge.terminal !== null).map(edge => edge.key))) issues.push("5: the terminal list is not the terminal edges");

    // 6. keys: the entities' ids, with the lane, item and input suffixes
    for (const node of graph.nodes) {
        if (!NODE_KEY.test(node.key)) issues.push(`6: node key ${node.key}`);
        for (const port of node.ports) {
            if (!PORT_KEY.test(port) || !port.startsWith(`${node.key}#`)) issues.push(`6: port key ${port}`);
        }
    }
    for (const edge of graph.edges) {
        if (!EDGE_KEY.test(edge.key) || !edge.key.endsWith(`/${edge.item}`)) issues.push(`6: edge key ${edge.key}`);
    }

    // 7. plain JSON
    issues.push(...notPlainJson(graph, "graph").map(where => `7: ${where} is not plain JSON`));
    return issues;
}

/** Where a value holds what JSON does not keep as it is: undefined, a function, a number that is not finite, a class instance */
function notPlainJson(value: unknown, where: string): string[] {
    if (value === null || typeof value === "string" || typeof value === "boolean") return [];
    if (typeof value === "number") return Number.isFinite(value) ? [] : [where];
    if (Array.isArray(value)) return value.flatMap((item, at) => notPlainJson(item, `${where}[${at}]`));
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.entries(value).flatMap(([key, item]) => notPlainJson(item, `${where}.${key}`));
    }
    return [where];
}
