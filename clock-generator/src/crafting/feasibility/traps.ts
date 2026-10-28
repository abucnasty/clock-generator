/**
 * The structural refusals of the feasibility pass (P3 design 3.3), each a condition over the facts and the graph:
 * - S1, a result with no way out: a machine result with a positive yield that does not spoil, whose every way out ends
 *   in a port nothing takes it out of and that is not terminal (a chest, or a rocket silo's input slots: the schema's
 *   silo trap), or that has no way out at all. Its machine stops for good once that fills. Refused where the target needs
 *   the machine: where the rest of its recipe's machines cannot make what the target needs (checks.ts, with C1). The
 *   text follows the item from the port it is first dropped into to the ports it stops in.
 * - S2, a shared hand at a placer's target: an inserter that takes two or more of a placer's results out of where it
 *   places them, with the full hand rule there (`hand.full_hand.at_placing_source`); the same condition and text as
 *   `sharedHandRefusal` (result-windows.ts), for every target, where the placer must craft.
 * - S3, a loop that uses up all it makes: a certificate from the loop's linear system (demand.ts).
 */
import { FeasibilityIssue } from "../../config/errors";
import type { InserterEdge } from "../../data-types/planner-facts";
import type { GraphEdge } from "../../data-types/planner-graph";
import { FactorioDataService } from "../../data/factorio-data-service";
import { BuildView, DemandResult, nodeKeyOf } from "./demand";

/** The number of an entity key, "inserter:6" -> 6 */
export const numberOf = (key: string): number => Number(key.split("/")[0].split(":")[1]);

/** A machine result that cannot leave it for good */
export interface TrappedResult {
    readonly machine: string;
    readonly item: string;
    /** The port it is first dropped into, or null where nothing takes it out of the machine at all */
    readonly port: string | null;
    /** The edges that carry it into that port */
    readonly edges: readonly GraphEdge[];
    /** The edges that move it on from there, from port to port; none where it stops in the first port */
    readonly moves: readonly GraphEdge[];
    /**
     * The ports it stops in, past the first: those nothing takes it out of. Where the moves only go round between ports,
     * none stops it on its own: every port they reach
     */
    readonly ends: readonly string[];
    /** The moves go round: no port past the first is one nothing takes it out of */
    readonly loop: boolean;
}

/**
 * Whether an item an edge carries leaves the build or is used up: the edge is terminal, it drops into a machine (which
 * takes it in as an ingredient or fuel: `lands_in` is not null), or into a port it leaves from in turn
 */
export function leaks(view: BuildView, edge: GraphEdge, seen: Set<string>): boolean {
    if (edge.terminal !== null) return true;
    if (!edge.to.includes("#")) return true;
    if (seen.has(edge.to)) return false;
    seen.add(edge.to);
    return (view.out_of.get(edge.to) ?? []).some(out => out.item === edge.item && leaks(view, out, seen));
}

/**
 * Where a trapped item goes from the port it is first dropped into: the edges that move it on and the ports it stops in.
 * Every edge reached here drops into a port (none leaks), so the walk stays among ports.
 */
function trailOf(view: BuildView, item: string, first: string): { moves: GraphEdge[]; ends: string[]; loop: boolean } {
    const seen = new Set<string>();
    const moves: GraphEdge[] = [];
    const ends: string[] = [];
    const queue = [first];
    while (queue.length > 0) {
        const port = queue.shift()!;
        if (seen.has(port)) continue;
        seen.add(port);
        const out = (view.out_of.get(port) ?? []).filter(edge => edge.item === item);
        if (out.length === 0 && port !== first) ends.push(port);
        for (const edge of out) {
            moves.push(edge);
            queue.push(edge.to);
        }
    }
    const loop = moves.length > 0 && ends.length === 0;
    return { moves, ends: loop ? [...seen] : ends, loop };
}

/**
 * The results of every machine that cannot leave it for good (S1), in node order. A result that spoils is left out: it
 * can leave as its spoil, so it does not hold its machine back (as `machineCapacityOf`, checks.ts).
 */
export function trappedResultsOf(view: BuildView): TrappedResult[] {
    const trapped: TrappedResult[] = [];
    for (const node of view.facts.nodes) {
        if (node.kind !== "machine") continue;
        for (const item of view.group_of.get(node.key)!.yields.keys()) {
            if (node.spoilage.items.some(it => it.item === item)) continue;
            const out = (view.out_of.get(node.key) ?? []).filter(edge => edge.item === item);
            if (out.some(edge => leaks(view, edge, new Set()))) continue;
            const port = out.find(edge => edge.to.includes("#"))?.to ?? null;
            const trail = port === null ? { moves: [], ends: [], loop: false } : trailOf(view, item, port);
            trapped.push({ machine: node.key, item, port, edges: out.filter(edge => edge.to === port), ...trail });
        }
    }
    return trapped;
}

/** A port as a text names it: its container, and whether it is a rocket silo's input slots (the edges that fill it say) */
function portNamed(view: BuildView, port: string): { container: number; input_slots: boolean } {
    return { container: numberOf(nodeKeyOf(port)), input_slots: (view.into.get(port) ?? []).some(edge => edge.lands_in === "input-slots") };
}

/** S1 for one trapped result, with the rest of the recipe's machines where it has more */
export function trappedResultIssue(view: BuildView, trap: TrappedResult, others: { ids: number[]; crafts_per_second: number; need_crafts_per_second: number } | null): FeasibilityIssue {
    const placed = trap.edges.every(edge => edge.via === "placement");
    const inserters = (edges: readonly GraphEdge[]) => [...new Set(edges.map(edge => numberOf(edge.entity)))];
    return {
        rule: "S1",
        nodes: [trap.machine, ...trap.port === null ? [] : [trap.port], ...trap.ends.filter(end => end !== trap.port)],
        edges: [...trap.edges, ...trap.moves].map(edge => edge.key),
        need: null,
        capacity: null,
        terms: {
            rule: "S1",
            machine: numberOf(trap.machine),
            item: FactorioDataService.itemNameInSentence(trap.item),
            into: trap.port === null ? null : {
                container: numberOf(nodeKeyOf(trap.port)),
                input_slots: trap.edges.some(edge => edge.lands_in === "input-slots"),
                inserters: placed ? [] : inserters(trap.edges),
            },
            then: trap.moves.length === 0 ? null : {
                inserters: inserters(trap.moves),
                ends: trap.ends.map(end => portNamed(view, end)),
                loop: trap.loop,
            },
            others,
        },
    };
}

/** S2: every inserter that takes two or more of a placer's results out of its target, where the placer must craft */
export function sharedHandIssues(demand: DemandResult): FeasibilityIssue[] {
    const { view, crafts } = demand;
    const issues: FeasibilityIssue[] = [];
    for (const node of view.facts.nodes) {
        if ((node.kind !== "machine" && node.kind !== "drill") || node.placement === null || node.placement.target === null) continue;
        const group = view.group_of.get(node.key)!;
        if (!(crafts.get(group.key)!.getNumerator > 0)) continue;
        const target = node.placement.target;
        const results = node.yield.results.map(result => result.item);
        const takers = view.facts.edges.filter((edge): edge is InserterEdge => edge.via === "inserter" && edge.from === target);
        for (const inserter of [...new Set(takers.map(edge => edge.entity))]) {
            const own = takers.filter(edge => edge.entity === inserter);
            const taken = results.filter(item => own.some(edge => edge.item === item));
            if (taken.length < 2 || !own[0].hand.full_hand.at_placing_source) continue;
            issues.push({
                rule: "S2",
                nodes: [node.key, target],
                edges: own.filter(edge => taken.includes(edge.item)).map(edge => edge.key),
                need: null,
                capacity: null,
                terms: { rule: "S2", inserter: numberOf(inserter), items: taken, target },
            });
        }
    }
    return issues;
}

/** S3: every loop whose linear system shows it cannot make what is asked of it */
export function loopTrapIssues(demand: DemandResult): FeasibilityIssue[] {
    return demand.loop_traps.map(trap => {
        const members = trap.groups.flatMap(group => group.members);
        return {
            rule: "S3",
            nodes: members.map(member => member.key),
            edges: [],
            need: null,
            capacity: null,
            terms: {
                rule: "S3",
                producer: trap.groups[0].kind,
                ids: members.map(member => numberOf(member.key)),
                rows: trap.rows.map(row => ({ item: FactorioDataService.itemNameInSentence(row.item), gives: row.gives.toDecimal(), takes: row.takes.toDecimal() })),
            },
        };
    });
}
