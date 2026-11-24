/**
 * The copied regions of a build: parts of one planner group that are copies of one another about one machine they share.
 *
 * - **Anchors:** inside one planner group (`groupsOf`, its unbounded sources already out), each machine whose removal splits
 *   the rest of the group into two or more parts.
 * - **Regions:** the parts with equal labels that hold at least two machines each. An orbit is a set of such parts. The anchor
 *   is the removed machine, with every part that matches no other and the arms into or out of the removed machine.
 * - **Labels:** a node's kind, its recipe and its lane item, the two lanes of one belt related; on each edge its item, `lands_in`, hand, floor cycle, ceiling,
 *   terminal kind, and for a belt pickup the side of the lane it takes from, near or far as the arm's `near_lane` says. The
 *   lane index and the machine speed are not labels: the speed is a capacity check (`capacity_short`).
 * - **The map** between two regions is found by colour refinement, then one pair of equal colours at a time: the takers of a
 *   machine that hands one item to two or more machines that make the target first, in the order the metered takers maker
 *   turns them (source by its key, then inserter number; the k-th taker of a source to the k-th of its partner), then the
 *   lowest id. No map is enumerated. The map found is checked node by node and edge by edge; where it fails, `no_map`.
 *
 * A pure function of the planner facts, the planner graph, the arms' near lanes and the machine groups' utilizations;
 * `regionOrbitsOfConfig` makes it once per config object.
 */
import type { Config } from "../../config";
import type { PlannerFacts } from "../../data-types/planner-facts";
import type { GraphEdge, PlannerGraph } from "../../data-types/planner-graph";
import { exact } from "../feasibility/demand";
import { feasibilityOf, graphOf } from "../feasibility/assert-feasible";
import type { GroupUtilization } from "../feasibility/utilization";
import { groupsOf } from "../planner/groups";
import { fraction } from "../../data-types/fraction";

/** The fewest machines a region holds: a one-machine copy is the grouped hands rule's */
export const REGION_MIN_MACHINES = 2;

export interface Region {
    /** "<anchor>/region:<n>", numbered from 1 in the order of the region's first node in the graph's order */
    key: string;
    /** Its node keys: machines, drills, lanes, containers */
    nodes: string[];
    /** The inserters with an edge on its nodes, the anchor's arms left out */
    arms: string[];
}

/** One orbit of copied regions about one anchor */
export interface RegionOrbit {
    /** The planner group */
    group: string;
    /** The removed machine first, then the nodes of the parts that match no other part, then the anchor's arms */
    anchor: string[];
    regions: Region[];
    /** `maps[i]` sends region 0's node keys and inserter ids to region i's (`maps[0]` is the identity) */
    maps: Record<string, string>[];
}

export type OrbitRefusal = "capacity_short" | "no_map";

/** An orbit the copy may use, or the regions of one it may not and why */
export type FoundOrbit = { kind: "orbit"; orbit: RegionOrbit } | { kind: "refused"; reason: OrbitRefusal; group: string; anchor: string[]; regions: Region[] };

/** The steps the finder took: refinement rounds and pairs it fixed, for the cost test */
export interface FinderSteps { rounds: number; pairs: number }

const nodeOf = (vertex: string): string => vertex.split("#")[0];

/** The number at the end of a key, "inserter:12" 12, "belt:2/lane:1" 2 */
const numberOf = (key: string): number => Number(/^[a-z-]+:(\d+)/.exec(key)?.[1] ?? NaN);
const KIND_RANK: Record<string, number> = { machine: 0, drill: 1, container: 2, belt: 3, inserter: 4 };
/** Lowest id first: by kind, then the entity number, then the lane */
const idOrder = (a: string, b: string): number => (KIND_RANK[a.split(":")[0]] ?? 9) - (KIND_RANK[b.split(":")[0]] ?? 9)
    || numberOf(a) - numberOf(b) || (a < b ? -1 : a > b ? 1 : 0);

/** The near lane of each arm that takes from a belt, by inserter key, as the config gives it */
export function nearLanesOf(config: Pick<Config, "inserters">): Map<string, number> {
    const sides = new Map<string, number>();
    for (const inserter of config.inserters) {
        const source = inserter.source as { type: string; near_lane?: number };
        if (source.type === "belt") sides.set(`inserter:${inserter.id}`, source.near_lane ?? 1);
    }
    return sides;
}

/** A relation of the refinement graph: from a node, of a kind and label, to another node */
interface Relation { to: string; label: string }

/**
 * The labelled graph of one cut: the group's nodes but the anchor, every inserter with an edge on them, and the anchor as one
 * node of its own colour. Edges from outside the group are labels of their arm.
 */
interface CutGraph {
    nodes: string[];
    /** The inserters among `nodes` */
    arms: Set<string>;
    label: Map<string, string>;
    out: Map<string, Relation[]>;
    into: Map<string, Relation[]>;
}

const ANCHOR = "\u0000anchor";

function edgeLabel(edge: GraphEdge, side: string): string {
    const ceiling = edge.ceiling === null ? "-" : `${edge.ceiling.numerator}/${edge.ceiling.denominator}`;
    return [edge.via, edge.item, edge.lands_in ?? "-", edge.hand ?? "-", edge.floor_cycle ?? "-", ceiling, edge.terminal ?? "-", side].join(",");
}

function cutGraphOf(
    facts: PlannerFacts, graph: PlannerGraph, members: ReadonlySet<string>, anchor: string, sides: ReadonlyMap<string, number>,
): CutGraph {
    const fact = new Map(facts.nodes.map(node => [node.key, node]));
    const label = new Map<string, string>();
    const out = new Map<string, Relation[]>();
    const into = new Map<string, Relation[]>();
    const relate = (from: string, to: string, rel: string) => {
        if (!out.has(from)) out.set(from, []);
        if (!into.has(to)) into.set(to, []);
        out.get(from)!.push({ to, label: rel });
        into.get(to)!.push({ to: from, label: rel });
    };
    const inside = (node: string) => members.has(node) && node !== anchor;
    const nameOf = (node: string) => node === anchor ? ANCHOR : node;
    for (const node of members) {
        if (node === anchor) continue;
        const it = fact.get(node);
        if (it === undefined) continue;
        label.set(node, it.kind === "machine" || it.kind === "drill" ? `${it.kind}:${it.production.recipe_or_resource}`
            : it.kind === "lane" ? `lane:${it.lane.item ?? ""}`
                : `container:${graph.nodes.find(n => n.key === node)?.ports.map(port => port.slice(port.indexOf("#") + 1)).join(",") ?? ""}`);
    }
    label.set(ANCHOR, "anchor");
    // the two lanes of one belt stay together
    const lanes = [...members].filter(node => node !== anchor && fact.get(node)?.kind === "lane");
    for (const a of lanes) for (const b of lanes) if (a !== b && a.split("/")[0] === b.split("/")[0]) relate(a, b, "belt");
    const arms = new Map<string, string[]>();
    for (const edge of graph.edges) {
        const from = nodeOf(edge.from);
        const to = nodeOf(edge.to);
        if (!members.has(from) && !members.has(to)) continue;
        const lane = fact.get(from);
        const side = lane?.kind === "lane" && edge.via === "inserter"
            ? (lane.lane.lane === (sides.get(edge.entity) ?? 1) ? "near" : "far") : "-";
        const text = edgeLabel(edge, side);
        const arm = edge.entity;
        if (!arms.has(arm)) arms.set(arm, []);
        if (members.has(from)) relate(arm, nameOf(from), `takes:${text}`);
        else arms.get(arm)!.push(`takes outside:${text}`);
        if (members.has(to)) relate(arm, nameOf(to), `drops:${text}`);
        else arms.get(arm)!.push(`drops outside:${text}`);
    }
    for (const [arm, outside] of arms) label.set(arm, `arm|${outside.sort().join("|")}`);
    const nodes = [...[...members].filter(inside), ...arms.keys(), ANCHOR].filter(node => label.has(node));
    return { nodes, arms: new Set(arms.keys()), label, out, into };
}

/** Colour refinement to a stable partition. Colours are canonical: the same structure gets the same colour in any part */
function refine(g: CutGraph, start: Map<string, number>, steps: FinderSteps): Map<string, number> {
    let colour = start;
    let classes = new Set(colour.values()).size;
    for (;;) {
        steps.rounds++;
        const signature = new Map<string, string>();
        for (const node of g.nodes) {
            const rels = [...(g.out.get(node) ?? []).map(r => `>${r.label}:${colour.get(r.to)}`), ...(g.into.get(node) ?? []).map(r => `<${r.label}:${colour.get(r.to)}`)].sort();
            signature.set(node, `${colour.get(node)}|${rels.join("|")}`);
        }
        const names = [...new Set(signature.values())].sort();
        const index = new Map(names.map((name, i) => [name, i]));
        const next = new Map(g.nodes.map(node => [node, index.get(signature.get(node)!)!]));
        const count = names.length;
        colour = next;
        if (count === classes) return colour;
        classes = count;
    }
}

function initialColours(g: CutGraph): Map<string, number> {
    const names = [...new Set(g.nodes.map(node => g.label.get(node)!))].sort();
    const index = new Map(names.map((name, i) => [name, i]));
    return new Map(g.nodes.map(node => [node, index.get(g.label.get(node)!)!]));
}

/** The connected parts of the group's nodes without the anchor, joined by an edge with both ends in them */
function partsOf(graph: PlannerGraph, members: ReadonlySet<string>, anchor: string): string[][] {
    const parent = new Map<string, string>();
    const find = (node: string): string => { let root = node; while (parent.get(root) !== root) root = parent.get(root)!; return root; };
    const join = (a: string, b: string) => { const [x, y] = [find(a), find(b)]; if (x !== y) parent.set(y, x); };
    const nodes = [...members].filter(node => node !== anchor);
    nodes.forEach(node => parent.set(node, node));
    for (const edge of graph.edges) {
        const ends = [...edge.from_ports.map(nodeOf), nodeOf(edge.to)].filter(node => parent.has(node));
        for (const end of ends.slice(1)) join(ends[0], end);
    }
    const parts = new Map<string, string[]>();
    for (const node of nodes) {
        const root = find(node);
        if (!parts.has(root)) parts.set(root, []);
        parts.get(root)!.push(node);
    }
    return [...parts.values()];
}

/** The takers of a machine that hands one item to two or more machines that make the target, in the maker's turn order */
function takerOrderOf(facts: PlannerFacts, graph: PlannerGraph): string[] {
    const target = graph.target.item;
    const makes = new Set(facts.nodes.filter(node => node.kind === "machine" && node.yield.results.some(result => result.item === target)).map(node => node.key));
    const kinds = new Map(facts.nodes.map(node => [node.key, node.kind]));
    const candidates = graph.edges.filter(edge => edge.via === "inserter" && kinds.get(nodeOf(edge.from)) === "machine" && makes.has(nodeOf(edge.to)));
    const per_source = new Map<string, Set<string>>();
    for (const edge of candidates) {
        const source = nodeOf(edge.from);
        if (!per_source.has(source)) per_source.set(source, new Set());
        per_source.get(source)!.add(edge.entity);
    }
    const takers = [...new Set(candidates.filter(edge => per_source.get(nodeOf(edge.from))!.size >= 2).map(edge => edge.entity))];
    const source_of = new Map(candidates.map(edge => [edge.entity, nodeOf(edge.from)]));
    return takers.sort((a, b) => source_of.get(a)!.localeCompare(source_of.get(b)!) || numberOf(a) - numberOf(b));
}

/**
 * The map from region `a` to region `b` by refinement and one pair at a time, checked; null where it does not hold. `own`
 * gives each node and arm its region.
 */
function mapBetween(
    g: CutGraph, colours: Map<string, number>, a: ReadonlySet<string>, b: ReadonlySet<string>, takers: readonly string[],
    source_of: ReadonlyMap<string, string>, steps: FinderSteps,
): Record<string, string> | null {
    let colour = colours;
    let fresh = Math.max(...colour.values()) + 1;
    const rank = new Map(takers.map((id, i) => [id, i]));
    const order = (x: string, y: string) => (rank.get(x) ?? Infinity) - (rank.get(y) ?? Infinity) || idOrder(x, y);
    const in_a = [...a].sort(order);
    const in_b = [...b].sort(order);
    for (;;) {
        const of = (set: readonly string[], c: number) => set.filter(node => colour.get(node) === c);
        let x: string | undefined;
        for (const node of in_a) {
            const c = colour.get(node)!;
            const [na, nb] = [of(in_a, c).length, of(in_b, c).length];
            if (na !== nb) return null;
            if (na > 1) { x = node; break; }
        }
        if (x === undefined) break;
        const c = colour.get(x)!;
        const choices = of(in_b, c);
        let y = choices[0];
        // a taker goes to the taker of its source's partner of its own place among that source's takers
        const source = source_of.get(x);
        if (source !== undefined && rank.has(x)) {
            const partner = in_b.find(node => colour.get(node) === colour.get(source) && of(in_b, colour.get(source)!).length === 1);
            if (partner !== undefined) {
                const mine = takers.filter(id => source_of.get(id) === source && colour.get(id) === c && a.has(id));
                const theirs = takers.filter(id => source_of.get(id) === partner && colour.get(id) === c && b.has(id));
                const at = mine.indexOf(x);
                if (at >= 0 && theirs[at] !== undefined) y = theirs[at];
            }
        }
        steps.pairs++;
        colour = new Map(colour);
        colour.set(x, fresh);
        colour.set(y, fresh);
        fresh++;
        colour = refine(g, colour, steps);
        fresh = Math.max(fresh, ...colour.values()) + 1;
    }
    const map: Record<string, string> = {};
    for (const node of in_a) map[node] = in_b.find(other => colour.get(other) === colour.get(node))!;
    // the check: every label, and every relation of a node of `a` sent to one of its image, with the same count
    const image = (node: string) => node === ANCHOR ? ANCHOR : map[node];
    for (const node of in_a) {
        if (g.label.get(node) !== g.label.get(map[node])) return null;
        for (const side of [g.out, g.into]) {
            const mine = (side.get(node) ?? []).filter(r => r.to === ANCHOR || a.has(r.to)).map(r => `${r.label}>${image(r.to)}`).sort();
            const theirs = (side.get(map[node]) ?? []).filter(r => r.to === ANCHOR || b.has(r.to)).map(r => `${r.label}>${r.to}`).sort();
            if (mine.length !== theirs.length || mine.some((it, i) => it !== theirs[i])) return null;
            const all_mine = (side.get(node) ?? []).length, all_theirs = (side.get(map[node]) ?? []).length;
            if (all_mine !== all_theirs) return null;
        }
    }
    return map;
}

/**
 * The orbits of copied regions of a build, in the order of their anchor's place in the graph's order; null where no anchor's
 * removal leaves two or more parts with equal labels.
 */
export function regionOrbitsOf(
    facts: PlannerFacts, graph: PlannerGraph, sides: ReadonlyMap<string, number>, utilizations: readonly GroupUtilization[],
    steps: FinderSteps = { rounds: 0, pairs: 0 },
): FoundOrbit[] | null {
    const kinds = new Map(facts.nodes.map(node => [node.key, node.kind]));
    const place = new Map<string, number>();
    const loops = new Map(graph.components.map(component => [component.key, component.members]));
    graph.order.forEach((entry, at) => {
        for (const vertex of loops.get(entry) ?? [entry]) if (!place.has(nodeOf(vertex))) place.set(nodeOf(vertex), at);
    });
    const takers = takerOrderOf(facts, graph);
    const source_of = new Map(graph.edges.filter(edge => takers.includes(edge.entity)).map(edge => [edge.entity, nodeOf(edge.from)]));
    const capacity = new Map(facts.nodes.flatMap(node => node.kind === "machine" || node.kind === "drill" ? [[node.key, exact(node.production.crafts_per_second)] as const] : []));
    const found: FoundOrbit[] = [];
    let any = false;
    for (const group of groupsOf(facts, graph).groups) {
        const members = new Set(group.vertices.map(nodeOf).filter(node => kinds.has(node)));
        const anchors = [...members].filter(node => kinds.get(node) === "machine").sort((a, b) => place.get(a)! - place.get(b)!);
        for (const anchor of anchors) {
            const parts = partsOf(graph, members, anchor);
            if (parts.length < 2) continue;
            const g = cutGraphOf(facts, graph, members, anchor, sides);
            const colours = refine(g, initialColours(g), steps);
            // each part with its arms: the inserters with an edge on its nodes that do not touch the anchor
            const anchor_arms = g.nodes.filter(node => g.arms.has(node) && (g.out.get(node) ?? []).some(r => r.to === ANCHOR));
            const with_arms = parts.map(nodes => {
                const set = new Set(nodes);
                const arms = g.nodes.filter(node => g.arms.has(node) && !anchor_arms.includes(node) && (g.out.get(node) ?? []).some(r => set.has(r.to)));
                return { nodes, arms };
            });
            const invariant = (part: { nodes: string[]; arms: string[] }) => [...part.nodes, ...part.arms].map(node => colours.get(node)!).sort((a, b) => a - b).join(",");
            const machines = (part: { nodes: string[] }) => part.nodes.filter(node => kinds.get(node) === "machine").length;
            const by_invariant = new Map<string, typeof with_arms>();
            for (const part of with_arms) {
                const key = invariant(part);
                if (!by_invariant.has(key)) by_invariant.set(key, []);
                by_invariant.get(key)!.push(part);
            }
            const orbits = [...by_invariant.values()].filter(same => same.length >= 2 && same.every(part => machines(part) >= REGION_MIN_MACHINES));
            if (orbits.length === 0) continue;
            any = true;
            const in_orbit = new Set(orbits.flat());
            const unmatched = with_arms.filter(part => !in_orbit.has(part)).flatMap(part => part.nodes);
            const first = (part: { nodes: string[] }) => Math.min(...part.nodes.map(node => place.get(node) ?? Infinity));
            for (const orbit of orbits) {
                const sorted = [...orbit].sort((a, b) => first(a) - first(b));
                const regions: Region[] = sorted.map((part, i) => ({ key: `${anchor}/region:${i + 1}`,
                    nodes: [...part.nodes].sort((a, b) => (place.get(a) ?? Infinity) - (place.get(b) ?? Infinity) || idOrder(a, b)), arms: [...part.arms].sort(idOrder) }));
                const anchor_list = [anchor, ...unmatched, ...anchor_arms.sort(idOrder)];
                const maps: Record<string, string>[] = [];
                const zero = new Set([...regions[0].nodes, ...regions[0].arms]);
                for (const region of regions) {
                    const map = mapBetween(g, colours, zero, new Set([...region.nodes, ...region.arms]), takers, source_of, steps);
                    if (map === null) break;
                    maps.push(map);
                }
                if (maps.length !== regions.length) {
                    found.push({ kind: "refused", reason: "no_map", group: group.key, anchor: anchor_list, regions });
                    continue;
                }
                // the capacity: each machine group whose machines all lie in the regions gives each region its share
                const short = utilizations.some(use => {
                    const kind = use.group.split(":")[0];
                    const keys = use.machines.map(n => `${kind}:${n}`);
                    const of_region = regions.map(region => keys.filter(key => region.nodes.includes(key)));
                    if (of_region.flat().length !== keys.length) return false;
                    const share = use.crafts_needed.divide(regions.length);
                    return of_region.some(keys_in => keys_in.reduce((sum, key) => sum.add(capacity.get(key)!), fraction(0)).subtract(share).getNumerator < 0);
                });
                if (short) {
                    found.push({ kind: "refused", reason: "capacity_short", group: group.key, anchor: anchor_list, regions });
                    continue;
                }
                found.push({ kind: "orbit", orbit: { group: group.key, anchor: anchor_list, regions, maps } });
            }
        }
    }
    return any ? found : null;
}

const memo = new WeakMap<Config, FoundOrbit[] | null>();

/** The orbits of a config, made once per config object; null where its facts or graph cannot be built, or it has none */
export function regionOrbitsOfConfig(config: Config): FoundOrbit[] | null {
    if (memo.has(config)) return memo.get(config)!;
    const built = graphOf(config);
    const found = built === null ? null
        : regionOrbitsOf(built.facts, built.graph, nearLanesOf(config), feasibilityOf(built.facts, built.graph).utilizations);
    memo.set(config, found);
    return found;
}
