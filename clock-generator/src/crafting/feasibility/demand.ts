/**
 * The demand of the feasibility pass (P3 design 3.2): what a build must make, bring in and carry a second at its target,
 * as lower bounds, from its planner facts and graph alone. Every figure here is a true bound or a sum of them: a crafts
 * figure is never above what a clock must make, an amount never above what a cut must carry. Planned figures (shares,
 * swings per cycle, hands per window) are never read.
 *
 * - **Producers.** A recipe's machines (or a resource's drills) that make the same results from the same ingredients form
 *   one producer group; the split between them is the planner's.
 * - **Demands.** The target taken out of the build, each export belt's consumption, the target destroyed, and each
 *   group's inputs at its crafts. A demand is carried by its edges; it is fed from its roots, found by walking back from
 *   its edges through the ports that pass the item on: a producer group, a lane that brings the item from outside (at most
 *   its ceiling), or a source of no known bound (an infinity chest, a chest or lane nothing fills).
 * - **Crafts.** A demand whose roots are one producer group and bounded lanes is charged to that group, less what the
 *   lanes can bring; any other demand is charged to nobody (the split is the planner's, and the sums are checked on their
 *   own). The groups are walked in the reverse of the graph's order, so a group's consumers are charged before it; the
 *   groups of a loop are solved together as one exact linear system (as a loop of machines is in planner/balance.ts).
 *   Where the system is an M-matrix its solution is the least crafts the loop can run at; where it is not, and a
 *   certificate shows the loop cannot make what is asked of it, the loop is a trap (S3).
 */
import Fraction, { fraction } from "../../data-types/fraction";
import type { DrillNode, FactsRatio, LaneNode, MachineNode, PlannerFacts, PlannerNode } from "../../data-types/planner-facts";
import type { GraphEdge, PlannerGraph } from "../../data-types/planner-graph";

// ---------------------------------------------------------------------------------------------------------------------
// Exact arithmetic; null is a bound nobody knows, which never refuses
// ---------------------------------------------------------------------------------------------------------------------

export const ZERO = fraction(0);

export const exact = (ratio: FactsRatio): Fraction => fraction(ratio.numerator, ratio.denominator);

/** Whether `a` is strictly above `b` */
export const above = (a: Fraction, b: Fraction): boolean => a.subtract(b).getNumerator > 0;

export const larger = (a: Fraction, b: Fraction): Fraction => above(b, a) ? b : a;

/** `a` less `b`, or nothing where that is below zero */
export const less = (a: Fraction, b: Fraction): Fraction => above(a, b) ? a.subtract(b) : ZERO;

/** The sum, or null where any is null: a bound nobody knows makes the sum unknown */
export function sumOf(values: readonly (Fraction | null)[]): Fraction | null {
    let sum = ZERO;
    for (const value of values) {
        if (value === null) return null;
        sum = sum.add(value);
    }
    return sum;
}

/** The smaller, where null is no bound */
export const lowest = (a: Fraction | null, b: Fraction | null): Fraction | null => a === null ? b : b === null ? a : above(a, b) ? b : a;

// ---------------------------------------------------------------------------------------------------------------------
// The build as the pass reads it
// ---------------------------------------------------------------------------------------------------------------------

export type ProducerNode = MachineNode | DrillNode;

/** Machines (or drills) that make the same results from the same ingredients: the split between them is the planner's */
export interface ProducerGroup {
    readonly key: string;
    readonly kind: "machine" | "drill";
    readonly recipe: string;
    readonly members: readonly ProducerNode[];
    /** What a craft makes of each result with a positive yield, productivity as configured (A25) */
    readonly yields: ReadonlyMap<string, Fraction>;
}

/** A demand's roots: where what it carries comes from */
export interface Roots {
    /** Producer groups, by key */
    readonly producers: ReadonlySet<string>;
    /** Lane ports that bring the item from outside, each at most its lane's ceiling */
    readonly lanes: ReadonlyMap<string, Fraction>;
    /** A source of no known bound: an infinity chest that gives the item, a chest or lane nothing fills */
    readonly unbounded: boolean;
}

export type DemandKind = "target" | "export" | "destroyed" | "input";

/** Something the build must carry a second at its target, as a lower bound */
export interface Demand {
    readonly key: string;
    readonly kind: DemandKind;
    readonly item: string;
    /** The group whose machines take it in ("input") */
    readonly consumer: string | null;
    /** Items a second; for an input, the consumer's crafts times what a craft takes */
    readonly amount: Fraction;
    /** The edges that carry it */
    readonly edges: readonly GraphEdge[];
    readonly roots: Roots;
    /** For an export, the belt */
    readonly belt: string | null;
}

/** A loop that cannot make what is asked of it, whatever it crafts (S3): one row per group of the certificate */
export interface LoopTrap {
    readonly groups: readonly ProducerGroup[];
    readonly rows: readonly { readonly group: string; readonly item: string; readonly gives: Fraction; readonly takes: Fraction }[];
}

/** The graph and the facts, indexed */
export interface BuildView {
    readonly facts: PlannerFacts;
    readonly graph: PlannerGraph;
    readonly node: ReadonlyMap<string, PlannerNode>;
    /** The edges that carry an item (`lands_in` not null) */
    readonly carrying: readonly GraphEdge[];
    /** Carrying edges by the vertex they drop into */
    readonly into: ReadonlyMap<string, readonly GraphEdge[]>;
    /** Carrying edges by every vertex they take from */
    readonly out_of: ReadonlyMap<string, readonly GraphEdge[]>;
    readonly groups: readonly ProducerGroup[];
    readonly group_of: ReadonlyMap<string, ProducerGroup>;
}

/** The node of a vertex: a machine or drill is its node, a port belongs to the node before its `#` */
export const nodeKeyOf = (vertex: string): string => vertex.split("#")[0];

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
};

/**
 * The results of a producer with a positive yield, in the recipe's order. What a craft makes is the facts' float, read
 * exactly; its rate a second is no better, as it can be a bounded-denominator approximation (advanced circuits' 2.75 a
 * craft at 1601/96 crafts a second is 40715535479657/887784090863 a second, not 17611/384): `refuses` (checks.ts)
 * allows for the floats' noise
 */
export function yieldsOf(node: ProducerNode): Map<string, Fraction> {
    return new Map(node.yield.results.filter(result => result.expected_per_craft > 0)
        .map(result => [result.item, fraction(result.expected_per_craft)]));
}

export function buildViewOf(facts: PlannerFacts, graph: PlannerGraph): BuildView {
    const node = new Map(facts.nodes.map(it => [it.key, it]));
    const carrying = graph.edges.filter(edge => edge.lands_in !== null);
    const into = new Map<string, GraphEdge[]>();
    const out_of = new Map<string, GraphEdge[]>();
    for (const edge of carrying) {
        pushTo(into, edge.to, edge);
        for (const from of edge.from_ports) pushTo(out_of, from, edge);
    }

    // producers grouped by what a craft takes and makes: two machines of one recipe at another productivity are two groups
    const by_signature = new Map<string, ProducerNode[]>();
    for (const it of facts.nodes) {
        if (it.kind !== "machine" && it.kind !== "drill") continue;
        const signature = JSON.stringify([it.kind, it.production.recipe_or_resource,
            it.production.inputs.map(input => [input.item, input.per_craft]),
            it.yield.results.map(result => [result.item, result.expected_per_craft])]);
        pushTo(by_signature, signature, it);
    }
    const named = new Map<string, number>();
    const groups: ProducerGroup[] = [...by_signature.values()].map(members => {
        const first = members[0];
        const base = `${first.kind}:${first.production.recipe_or_resource}`;
        const count = (named.get(base) ?? 0) + 1;
        named.set(base, count);
        return {
            key: count === 1 ? base : `${base}#${count}`,
            kind: first.kind,
            recipe: first.production.recipe_or_resource,
            members,
            yields: yieldsOf(first),
        };
    });
    const group_of = new Map(groups.flatMap(group => group.members.map(member => [member.key, group] as const)));
    return { facts, graph, node, carrying, into, out_of, groups, group_of };
}

/**
 * What a craft of a machine takes of each item: its ingredients, and its fuel where the fuel is modelled and an edge
 * brings it (the facts: fuel comes by edge wherever an in-edge carries the machine's fuel item, whatever its `lands_in`)
 */
export function takesPerCraft(view: BuildView, member: ProducerNode): Map<string, Fraction> {
    const takes = new Map<string, Fraction>();
    const add = (item: string, amount: Fraction) => takes.set(item, (takes.get(item) ?? ZERO).add(amount));
    for (const input of member.production.inputs) {
        if (input.per_craft > 0) add(input.item, fraction(input.per_craft));
    }
    const fuel = member.energy.fuel;
    if (member.energy.fuel_modelled && fuel !== null && fuel.per_craft > 0 && (view.into.get(member.key) ?? []).some(edge => edge.item === fuel.item)) {
        add(fuel.item, fraction(fuel.per_craft));
    }
    return takes;
}

// ---------------------------------------------------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------------------------------------------------

/** Whether an item can appear in a node by spoiling: something it holds spoils into it, which no edge carries */
export function spoilsInto(node: PlannerNode, item: string): boolean {
    return node.kind !== "drill" && node.spoilage.items.some(it => it.spoil_result === item);
}

/** Whether a lane brings an item from outside: it lists the item and consumers outside do not empty it */
export function laneBrings(node: PlannerNode, item: string): boolean {
    return node.kind === "lane" && node.lane.item === item && !(node.lane.export_per_second !== null && node.lane.export_per_second > 0);
}

/** The roots of an item at a vertex: a producer, a lane from outside, or what feeds a port that passes it on */
export function rootsOf(view: BuildView, vertices: readonly string[], item: string): Roots {
    const producers = new Set<string>();
    const lanes = new Map<string, Fraction>();
    let unbounded = false;
    const seen = new Set<string>();
    const walk = (vertex: string): void => {
        if (seen.has(vertex)) return;
        seen.add(vertex);
        const node = view.node.get(nodeKeyOf(vertex));
        if (node === undefined) {
            unbounded = true;
            return;
        }
        if (node.kind === "machine" || node.kind === "drill") {
            const group = view.group_of.get(node.key)!;
            if (group.yields.has(item)) producers.add(group.key);
            else unbounded = true;
            return;
        }
        const fed = (view.into.get(vertex) ?? []).filter(edge => edge.item === item);
        let outside = false;
        if (laneBrings(node, item)) {
            lanes.set(vertex, exact((node as Extract<PlannerNode, { kind: "lane" }>).lane.items_per_second_ceiling));
            outside = true;
        }
        if (node.kind === "container" && node.storage.constant_supply && node.storage.gives.includes(item)) {
            unbounded = true;
            outside = true;
        }
        // a chest or a lane nothing fills holds what nobody knows; what spoils there into the item adds what nobody knows
        if ((!outside && fed.length === 0) || spoilsInto(node, item)) unbounded = true;
        for (const edge of fed) edge.from_ports.forEach(walk);
    };
    vertices.forEach(walk);
    return { producers, lanes, unbounded };
}

// ---------------------------------------------------------------------------------------------------------------------
// The destroyed target
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Whether every way a machine's result leaves it leads back into the machine: through the container it places into and the
 * inserters that take it out of there, as the ore voider's car (then every one it makes comes back)
 */
export function comesAllBack(view: BuildView, machine: string, item: string): boolean {
    const seen = new Set<string>();
    const back = (vertex: string): boolean => {
        if (seen.has(vertex)) return true;
        seen.add(vertex);
        const out = (view.out_of.get(vertex) ?? []).filter(edge => edge.item === item);
        return out.length > 0 && out.every(edge => edge.terminal === null
            && (edge.to === machine || (edge.to.includes("#") && back(edge.to))));
    };
    return back(machine);
}

/** A machine that destroys the target, with what a craft uses of it and gives back into it */
export interface Destroyer {
    readonly member: MachineNode;
    readonly uses: Fraction;
    readonly gives_back: Fraction;
    /** The edges that bring the target in from outside */
    readonly edges: readonly GraphEdge[];
}

export function destroyersOf(view: BuildView): Destroyer[] {
    const target = view.facts.target;
    if (target.counts !== "destroyed") return [];
    const terminal = view.carrying.filter(edge => edge.terminal === "destroyed");
    return [...new Set(terminal.map(edge => edge.to))].map(key => {
        const member = view.node.get(key) as MachineNode;
        const uses = member.production.inputs.filter(input => input.item === target.item).reduce((sum, input) => sum.add(fraction(input.per_craft)), ZERO);
        const made = view.group_of.get(key)!.yields.get(target.item);
        return {
            member,
            uses,
            gives_back: made !== undefined && comesAllBack(view, key, target.item) ? made : ZERO,
            edges: terminal.filter(edge => edge.to === key),
        };
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Demand and crafts
// ---------------------------------------------------------------------------------------------------------------------

/** Why a group must craft so much: so much of an item a second at so much a craft */
export interface CraftsBasis {
    readonly item: string;
    readonly per_second: Fraction;
    readonly per_craft: Fraction;
    /** "made": charged to it; "loop": made in a loop, some of it going back; "destroyed": the target it destroys */
    readonly how: "made" | "loop" | "destroyed";
}

export interface DemandResult {
    readonly view: BuildView;
    /** The least crafts a second of each group, by key */
    readonly crafts: ReadonlyMap<string, Fraction>;
    /** Why, for each group with crafts above zero */
    readonly basis: ReadonlyMap<string, CraftsBasis>;
    /** What a craft of each group takes, at least, of each item (the least over its machines) */
    readonly takes: ReadonlyMap<string, ReadonlyMap<string, Fraction>>;
    readonly demands: readonly Demand[];
    readonly destroyers: readonly Destroyer[];
    readonly loop_traps: readonly LoopTrap[];
}

/** A demand before its amount is known: a fixed amount, or an input of a group at so much a craft */
interface DemandSkeleton {
    readonly key: string;
    readonly kind: DemandKind;
    readonly item: string;
    readonly consumer: string | null;
    readonly fixed: Fraction | null;
    readonly per_craft: Fraction | null;
    readonly edges: readonly GraphEdge[];
    readonly roots: Roots;
    readonly belt: string | null;
}

/** A demand's charge to its one producer group: the amount less what its lanes from outside can bring */
interface Charge {
    readonly group: string;
    readonly item: string;
    readonly skeleton: DemandSkeleton;
    /** What the lanes from outside can bring */
    readonly lanes: Fraction;
}

function skeletonsOf(view: BuildView, takes: ReadonlyMap<string, ReadonlyMap<string, Fraction>>): DemandSkeleton[] {
    const { facts, carrying } = view;
    const target = facts.target;
    const skeletons: DemandSkeleton[] = [];
    // a demand nothing carries is left out; a target that nothing takes out of the build is too: it is refused where it is
    // today (missing coverage, a target that all goes back into its machine), or the simulator finds its chest full
    const add = (skeleton: Omit<DemandSkeleton, "roots">) => {
        if (skeleton.edges.length === 0) return;
        skeletons.push({ ...skeleton, roots: rootsOf(view, skeleton.edges.flatMap(edge => edge.from_ports), skeleton.item) });
    };

    if (target.counts === "made") {
        add({ key: "target", kind: "target", item: target.item, consumer: null, fixed: exact(target.per_copy), per_craft: null, belt: null,
            edges: carrying.filter(edge => edge.terminal !== null && edge.terminal !== "destroyed" && edge.item === target.item) });
    } else {
        add({ key: "destroyed", kind: "destroyed", item: target.item, consumer: null, fixed: exact(target.per_copy), per_craft: null, belt: null,
            edges: carrying.filter(edge => edge.terminal === "destroyed") });
    }

    // export belts, per belt and item: what consumers outside take off its lanes of the item. As `exportedItemsOf`
    // (export-delivery.ts), a belt and item that an output inserter fills is the build's output, which the target judges:
    // it is left out, as is the target's own item. An output inserter has a terminal edge of the target; an inserter
    // fills a belt with an item where it drops onto the belt and the item is among those it carries
    const outputs = new Set(target.counts === "made"
        ? carrying.filter(edge => edge.terminal !== null && edge.terminal !== "destroyed" && edge.item === target.item).map(edge => edge.entity)
        : []);
    const fillsBelt = (belt: string, item: string) => facts.edges.filter(edge => edge.via === "inserter"
        && view.node.get(edge.to)?.kind === "lane" && (view.node.get(edge.to) as LaneNode).entity === belt && edge.hand.items.includes(item))
        .map(edge => edge.entity);
    const per_belt = new Map<string, { belt: string; item: string; amount: Fraction }>();
    for (const node of facts.nodes) {
        if (node.kind !== "lane" || node.lane.item === null || node.lane.item === "" || !(node.lane.export_per_second !== null && node.lane.export_per_second > 0)) continue;
        const key = `${node.entity}#${node.lane.item}`;
        const amount = (per_belt.get(key)?.amount ?? ZERO).add(fraction(node.lane.export_per_second));
        per_belt.set(key, { belt: node.entity, item: node.lane.item, amount });
    }
    for (const [key, { belt, item, amount }] of per_belt) {
        if (target.counts === "made" && item === target.item) continue;
        if (fillsBelt(belt, item).some(entity => outputs.has(entity))) continue;
        add({ key: `export:${key}`, kind: "export", item, consumer: null, fixed: amount, per_craft: null, belt,
            edges: carrying.filter(edge => edge.terminal === "export-lane" && edge.item === item && view.node.get(nodeKeyOf(edge.to))?.entity === belt) });
    }

    // a machine's input that something it holds spoils into can come without an edge: no demand on the edges (a lower bound)
    for (const group of view.groups) {
        const members = new Set(group.members.map(member => member.key));
        for (const [item, per_craft] of takes.get(group.key)!) {
            if (group.members.some(member => spoilsInto(member, item))) continue;
            add({ key: `input:${group.key}#${item}`, kind: "input", item, consumer: group.key, fixed: null, per_craft, belt: null,
                edges: carrying.filter(edge => members.has(edge.to) && edge.item === item) });
        }
    }
    return skeletons;
}

/** The least of what a craft of each member of a group takes of each item */
function groupTakes(view: BuildView, group: ProducerGroup): Map<string, Fraction> {
    const per_member = group.members.map(member => takesPerCraft(view, member));
    const items = new Set(per_member.flatMap(takes => [...takes.keys()]));
    return new Map([...items].map(item => [item, per_member.map(takes => takes.get(item) ?? ZERO).reduce((a, b) => above(a, b) ? b : a)] as const)
        .filter(([, amount]) => amount.getNumerator > 0));
}

/**
 * Solves `matrix x = rhs` by Gaussian elimination without row exchanges, or gives the first step whose pivot is not
 * above zero. For a Z-matrix (no positive entry off the diagonal) every pivot is above zero exactly where it is a
 * nonsingular M-matrix, and the solution is then the least x >= 0 with `matrix x >= rhs`.
 */
function solveWithoutExchanges(matrix: Fraction[][], rhs: Fraction[]): { solution: Fraction[] } | { failed_at: number } {
    const n = rhs.length;
    const rows = matrix.map((row, at) => [...row, rhs[at]]);
    for (let column = 0; column < n; column++) {
        const pivot = rows[column][column];
        if (!(pivot.getNumerator > 0)) return { failed_at: column };
        for (let row = column + 1; row < n; row++) {
            const factor = rows[row][column].divide(pivot);
            if (factor.getNumerator === 0) continue;
            rows[row] = rows[row].map((value, at) => value.subtract(rows[column][at].multiply(factor)));
        }
    }
    const solution: Fraction[] = new Array(n).fill(ZERO);
    for (let row = n - 1; row >= 0; row--) {
        let value = rows[row][n];
        for (let column = row + 1; column < n; column++) value = value.subtract(rows[row][column].multiply(solution[column]));
        solution[row] = value.divide(rows[row][row]);
    }
    return { solution };
}

/**
 * A certificate that `matrix x >= rhs` has no x >= 0, from the first leading block of a Z-matrix that is not an
 * M-matrix: z >= 0 with z^T matrix <= 0 and z^T rhs > 0. Checked here entry by entry, so it holds whatever led to it.
 */
function infeasibilityCertificate(matrix: Fraction[][], rhs: Fraction[], at: number): Fraction[] | null {
    const n = rhs.length;
    // z over the first `at` rows solves z^T M[<at, <at] = -M[at, <at]; z[at] = 1; z is zero after it
    const z: Fraction[] = new Array(n).fill(ZERO);
    z[at] = fraction(1);
    if (at > 0) {
        const block = Array.from({ length: at }, (_, row) => Array.from({ length: at }, (_, column) => matrix[column][row]));
        const right = Array.from({ length: at }, (_, row) => ZERO.subtract(matrix[at][row]));
        const solved = solveWithoutExchanges(block, right);
        if (!("solution" in solved)) return null;
        solved.solution.forEach((value, row) => { z[row] = value; });
    }
    if (z.some(value => value.getNumerator < 0)) return null;
    for (let column = 0; column < n; column++) {
        const product = z.reduce((sum, value, row) => sum.add(value.multiply(matrix[row][column])), ZERO);
        if (product.getNumerator > 0) return null;
    }
    const asked = z.reduce((sum, value, row) => sum.add(value.multiply(rhs[row])), ZERO);
    return asked.getNumerator > 0 ? z : null;
}

/**
 * The demand of a build at its target (P3 3.2): the least crafts of every producer group, and every demand with its
 * amount and roots. Reads the graph's order and loops, the facts' yields, ingredients, fuel by edge, lanes and target.
 */
export function demandOf(facts: PlannerFacts, graph: PlannerGraph): DemandResult {
    const view = buildViewOf(facts, graph);
    const takes = new Map(view.groups.map(group => [group.key, groupTakes(view, group)]));
    const skeletons = skeletonsOf(view, takes);
    const crafts = new Map(view.groups.map(group => [group.key, ZERO]));

    const basis = new Map<string, CraftsBasis>();

    // the destroyed target: its one destroying group crafts at least the target over the most a craft destroys
    const destroyers = destroyersOf(view);
    const destroyed = new Map<string, CraftsBasis>();
    const destroying = new Set(destroyers.map(it => view.group_of.get(it.member.key)!.key));
    if (destroying.size === 1) {
        const net = destroyers.map(it => it.uses.subtract(it.gives_back)).reduce(larger);
        if (net.getNumerator > 0) {
            destroyed.set([...destroying][0], { item: facts.target.item, per_second: exact(facts.target.per_copy), per_craft: net, how: "destroyed" });
        }
    }

    const charges: Charge[] = skeletons.flatMap(skeleton => {
        const { roots } = skeleton;
        if (skeleton.kind === "destroyed" || roots.unbounded || roots.producers.size !== 1) return [];
        return [{ group: [...roots.producers][0], item: skeleton.item, skeleton, lanes: sumOf([...roots.lanes.values()])! }];
    });

    // units: the groups of one loop are solved together; a unit sits in the order where its first vertex does
    const position = new Map<string, number>();
    graph.order.forEach((key, at) => position.set(key, at));
    for (const component of graph.components) {
        for (const member of component.members) position.set(member, position.get(component.key)!);
    }
    const unit_of = new Map(view.groups.map(group => [group.key, group.key]));
    const find = (key: string): string => unit_of.get(key) === key ? key : find(unit_of.get(key)!);
    for (const component of graph.components) {
        const keys = component.members.flatMap(member => view.group_of.has(member) ? [view.group_of.get(member)!.key] : []);
        for (const key of keys.slice(1)) unit_of.set(find(key), find(keys[0]));
    }
    const units = new Map<string, ProducerGroup[]>();
    for (const group of view.groups) pushTo(units, find(group.key), group);
    const firstOf = (unit: readonly ProducerGroup[]) => Math.min(...unit.flatMap(group => group.members.map(member => position.get(member.key) ?? Infinity)));
    const ordered = [...units.values()].sort((a, b) => firstOf(b) - firstOf(a));

    const amountOf = (skeleton: DemandSkeleton): Fraction =>
        skeleton.fixed ?? crafts.get(skeleton.consumer!)!.multiply(skeleton.per_craft!);
    const loop_traps: LoopTrap[] = [];
    for (const unit of ordered) {
        const inside = new Set(unit.map(group => group.key));
        // what each item of each group is charged from outside the unit, and the coefficients of the unit's own inputs
        // charged to it with no lane from outside (a lane makes the charge no longer linear: left out, a lower bound)
        const outside = new Map<string, Fraction>();
        const coefficient = new Map<string, Fraction>();
        for (const charge of charges) {
            if (!inside.has(charge.group)) continue;
            const key = `${charge.group}\n${charge.item}`;
            const consumer = charge.skeleton.consumer;
            if (consumer !== null && inside.has(consumer)) {
                if (charge.lanes.getNumerator === 0) {
                    const at = `${key}\n${consumer}`;
                    coefficient.set(at, (coefficient.get(at) ?? ZERO).add(charge.skeleton.per_craft!));
                }
                continue;
            }
            outside.set(key, (outside.get(key) ?? ZERO).add(less(amountOf(charge.skeleton), charge.lanes)));
        }
        // what a group must craft for what it is charged from outside the unit, and the target it destroys
        const direct = (group: ProducerGroup): CraftsBasis | null => {
            let best = destroyed.get(group.key) ?? null;
            for (const [item, made] of group.yields) {
                const per_second = outside.get(`${group.key}\n${item}`) ?? ZERO;
                if (best === null ? per_second.getNumerator > 0 : above(per_second.divide(made), best.per_second.divide(best.per_craft))) {
                    best = { item, per_second, per_craft: made, how: "made" };
                }
            }
            return best;
        };
        const craftsOf = (it: CraftsBasis | null): Fraction => it === null ? ZERO : it.per_second.divide(it.per_craft);
        const settle = (group: ProducerGroup, it: CraftsBasis | null) => {
            crafts.set(group.key, craftsOf(it));
            if (it !== null) basis.set(group.key, it);
        };
        const looping = unit.map(group => [...group.yields.keys()].find(item =>
            unit.some(consumer => coefficient.has(`${group.key}\n${item}\n${consumer.key}`))) ?? null);
        if (looping.every(item => item === null)) {
            unit.forEach(group => settle(group, direct(group)));
            continue;
        }

        // one row a group: made - taken inside the unit >= charged from outside, of its looping item; a group with none
        // is held at what it is charged directly
        const matrix = unit.map((group, row) => unit.map((other, column) => {
            const item = looping[row];
            if (item === null) return fraction(row === column ? 1 : 0);
            const taken = coefficient.get(`${group.key}\n${item}\n${other.key}`) ?? ZERO;
            return (row === column ? group.yields.get(item)! : ZERO).subtract(taken);
        }));
        const rhs = unit.map((group, row) => looping[row] === null ? craftsOf(direct(group)) : outside.get(`${group.key}\n${looping[row]}`) ?? ZERO);
        const solved = solveWithoutExchanges(matrix, rhs);
        if ("solution" in solved) {
            unit.forEach((group, row) => {
                const item = looping[row];
                const solution = solved.solution[row];
                const alone = direct(group);
                if (item === null || !above(solution, craftsOf(alone))) settle(group, alone);
                else settle(group, { item, per_second: solution.multiply(group.yields.get(item)!), per_craft: group.yields.get(item)!, how: "loop" });
            });
            continue;
        }
        const certificate = infeasibilityCertificate(matrix, rhs, solved.failed_at);
        if (certificate !== null) {
            const rows = unit.flatMap((group, row) => certificate[row].getNumerator > 0 && looping[row] !== null ? [{
                group: group.key,
                item: looping[row]!,
                gives: group.yields.get(looping[row]!)!,
                takes: unit.reduce((sum, other) => sum.add(coefficient.get(`${group.key}\n${looping[row]}\n${other.key}`) ?? ZERO), ZERO),
            }] : []);
            loop_traps.push({ groups: unit.filter(group => rows.some(row => row.group === group.key)), rows });
        }
        // no sound least solution: what each group is charged from outside, over its yield, is still a lower bound
        unit.forEach(group => settle(group, direct(group)));
    }

    const demands: Demand[] = skeletons.map(skeleton => ({
        key: skeleton.key, kind: skeleton.kind, item: skeleton.item, consumer: skeleton.consumer, amount: amountOf(skeleton),
        edges: skeleton.edges, roots: skeleton.roots, belt: skeleton.belt,
    }));
    return { view, crafts, basis, takes, demands, destroyers, loop_traps };
}
