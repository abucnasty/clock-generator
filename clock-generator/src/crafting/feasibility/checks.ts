/**
 * The cuts of the feasibility pass (P3 design 3.2, C1-C7), each necessary on its own: what a cut must carry at the target
 * (demand.ts) against the most it can carry, from true maxima only (the facts' crafts a second, an edge's ceiling of its
 * hand over its fewest swing ticks, a lane's ceiling). A cut refuses where the need is strictly above the capacity, in
 * exact fractions, by more than a billionth of it (`refuses`: the facts' yields and fuel are floats). A capacity of null
 * is one nobody knows (an edge whose floor is not measured, a placement, a source of no known bound): it never refuses.
 *
 * - C1, a recipe's machines: the sum over them of the least of their crafts a second, what their inserters bring of each
 *   input over what a craft takes, and what their inserters take of each result over what a craft makes (a result that
 *   spoils is left out: it can leave as its spoil), against the crafts the target needs of them.
 * - C2, the supply of an item: the lanes that bring it from outside (at most their ceilings) and the machines that make
 *   it, where the target takes it from more than one of them (the split is the planner's), against what the target needs
 *   of it from there.
 * - C3, the target taken out: the edges that take it out of the build, onto a belt at most its ceiling.
 * - C4, one inserter that carries several items, one a swing: the share of its swings each item takes at the least it
 *   must carry (what its demand needs past the most its other edges carry) adds up to at most 1.
 * - C5, a belt lane: what its takers must take off it against its ceiling, or what is put onto it.
 * - C6, an export belt: what its consumers take against what its fillers can put onto it.
 * - C7, the target destroyed: the machines' crafts times what a craft destroys, and the edges that bring it in.
 */
import { FeasibilityCarriers, FeasibilityIssue, FeasibilityLane, FeasibilityLimit, FeasibilityRule, FeasibilitySource, FeasibilityTaker } from "../../config/errors";
import Fraction, { fraction } from "../../data-types/fraction";
import type { LaneNode } from "../../data-types/planner-facts";
import type { GraphEdge } from "../../data-types/planner-graph";
import { FactorioDataService } from "../../data/factorio-data-service";
import { above, BuildView, Demand, DemandResult, exact, laneBrings, less, lowest, nodeKeyOf, ProducerGroup, ProducerNode, spoilsInto, sumOf, takesPerCraft, ZERO } from "./demand";
import { leaks, numberOf, trappedResultIssue, trappedResultsOf } from "./traps";

/** A cut: what it must carry against the most it carries */
export interface Cut {
    readonly rule: FeasibilityRule;
    /** What it is, for tables and tests: "C1 machine:rocket-fuel-from-jelly" */
    readonly name: string;
    /** The producer group it is about, where it is one */
    readonly group: string | null;
    readonly need: Fraction;
    /** The most it carries; null where nobody knows, which never refuses */
    readonly capacity: Fraction | null;
    /** The issues it refuses with, built only where it refuses */
    readonly issues: () => FeasibilityIssue[];
}

/**
 * What a need may be above its capacity and still not refuse, as a share of the capacity: a yield or a fuel a craft is a
 * float in the facts (0.16000000000000017), whose noise is some 1e-16 of it, so a need that is above its capacity by
 * less than that may be noise. A billionth leaves every true shortfall of a build a refusal: the least any sample or
 * test shows is a 480th (241 of 240)
 */
const FLOAT_MARGIN = fraction(1, 1_000_000_000);

/** Whether a cut refuses: its need is strictly above a known capacity, by more than the floats' noise */
export const refuses = (cut: Cut): boolean => cut.capacity !== null && above(cut.need, cut.capacity.add(cut.capacity.multiply(FLOAT_MARGIN)));

const label = (item: string): string => FactorioDataService.itemNameInSentence(item);

function recipeLabel(recipe: string): string {
    const name = FactorioDataService.recipeDisplayName(recipe);
    return name.charAt(0).toLowerCase() + name.slice(1);
}

/** "belt:2/lane:1" or a port of it -> belt 2, lane 1 */
function laneOf(vertex: string): FeasibilityLane {
    const [belt, lane] = nodeKeyOf(vertex).split("/");
    return { belt: numberOf(belt), lane: numberOf(lane) };
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** The inserters of edges with known ceilings, as a text names them */
function carriersOf(edges: readonly GraphEdge[]): FeasibilityCarriers {
    const alike = <T>(values: readonly T[]): T | null => unique(values).length === 1 ? values[0] : null;
    return {
        inserters: unique(edges.map(edge => numberOf(edge.entity))),
        per_second: (sumOf(edges.map(edge => edge.ceiling === null ? null : exact(edge.ceiling))) ?? ZERO).toDecimal(),
        hand: alike(edges.map(edge => edge.hand)),
        ticks: alike(edges.map(edge => edge.floor_cycle)),
    };
}

/** The most items a second edges carry: the sum of their ceilings; null where one has none (a placement, a null floor) */
const ceilingOf = (edges: readonly GraphEdge[]): Fraction | null => sumOf(edges.map(edge => edge.ceiling === null ? null : exact(edge.ceiling)));

const laneCeiling = (view: BuildView, vertex: string): Fraction => exact((view.node.get(nodeKeyOf(vertex)) as LaneNode).lane.items_per_second_ceiling);

/** What limits one machine: its crafts a second, or the edges of one input or result */
interface MachineLimit {
    readonly kind: "crafts" | "input" | "output";
    readonly item: string | null;
    readonly edges: readonly GraphEdge[];
    readonly per_craft: Fraction | null;
}

interface MachineCapacity {
    readonly member: ProducerNode;
    readonly crafts: Fraction;
    readonly limit: MachineLimit;
}

/**
 * The most crafts a second a machine (or a drill) makes: the least of its crafts a second, each input's edges over what
 * a craft takes, and each result's edges out of it over what a craft makes. An edge into a port its item never leaves
 * carries nothing for good; a result that spoils is left out (it can leave as its spoil); a bound nobody knows is left out.
 */
function machineCapacityOf(view: BuildView, member: ProducerNode): MachineCapacity {
    let best: MachineCapacity = { member, crafts: exact(member.production.crafts_per_second), limit: { kind: "crafts", item: null, edges: [], per_craft: null } };
    const consider = (crafts: Fraction | null, limit: MachineLimit) => {
        if (crafts !== null && above(best.crafts, crafts)) best = { member, crafts, limit };
    };
    for (const [item, per_craft] of takesPerCraft(view, member)) {
        // what the machine holds may spoil into the input: it then comes without an edge
        if (spoilsInto(member, item)) continue;
        const edges = (view.into.get(member.key) ?? []).filter(edge => edge.item === item);
        consider(ceilingOf(edges)?.divide(per_craft) ?? null, { kind: "input", item, edges, per_craft });
    }
    const spoils = member.kind === "machine" ? new Set(member.spoilage.items.map(it => it.item)) : new Set<string>();
    for (const [item, made] of view.group_of.get(member.key)!.yields) {
        if (spoils.has(item)) continue;
        const edges = (view.out_of.get(member.key) ?? []).filter(edge => edge.item === item && leaks(view, edge, new Set()));
        consider(ceilingOf(edges)?.divide(made) ?? null, { kind: "output", item, edges, per_craft: made });
    }
    return best;
}

/** The text's view of what limits a recipe's machines, one entry for the machines held back by the same thing */
function limitsOf(capacities: readonly MachineCapacity[]): FeasibilityLimit[] {
    const groups = new Map<string, MachineCapacity[]>();
    for (const capacity of capacities) {
        const key = `${capacity.limit.kind}\n${capacity.limit.item}\n${capacity.limit.per_craft?.toString()}`;
        groups.set(key, [...groups.get(key) ?? [], capacity]);
    }
    return [...groups.values()].map(group => {
        const { limit } = group[0];
        const machines = group.map(capacity => numberOf(capacity.member.key));
        const crafts_per_second = group.reduce((sum, capacity) => sum.add(capacity.crafts), ZERO).toDecimal();
        if (limit.kind === "crafts") return { kind: "crafts", machines, crafts_per_second };
        return {
            kind: limit.kind, machines, item: label(limit.item!), per_craft: limit.per_craft!.toDecimal(), crafts_per_second,
            carriers: carriersOf(group.flatMap(capacity => capacity.limit.edges)),
        };
    });
}

/** Who takes what a demand carries, as a text names them */
function takerOf(demand: DemandResult, of: Demand): FeasibilityTaker {
    if (of.kind === "export") return { kind: "export", belt: numberOf(of.belt!) };
    if (of.kind === "input") {
        const group = demand.view.groups.find(it => it.key === of.consumer)!;
        return { kind: "producers", producer: group.kind, ids: group.members.map(member => numberOf(member.key)) };
    }
    return { kind: "target" };
}

const idsOf = (group: ProducerGroup): number[] => group.members.map(member => numberOf(member.key));

/** C2: what the lanes from outside and the machines that make an item can supply, against what `set` must take of it */
function supplyCut(demand: DemandResult, item: string, set: readonly Demand[], groupCapacity: (group: ProducerGroup) => Fraction, what: string): Cut {
    const lanes = new Map(set.flatMap(it => [...it.roots.lanes]));
    const producers = demand.view.groups.filter(group => set.some(it => it.roots.producers.has(group.key)));
    const supply: [FeasibilitySource, Fraction][] = [
        ...[...lanes].map(([port, ceiling]): [FeasibilitySource, Fraction] => [{ kind: "lane", lane: laneOf(port), per_second: ceiling.toDecimal() }, ceiling]),
        ...producers.map((group): [FeasibilitySource, Fraction] => {
            const made = groupCapacity(group).multiply(group.yields.get(item)!);
            return [{ kind: "producers", producer: group.kind, ids: idsOf(group), recipe: recipeLabel(group.recipe), per_second: made.toDecimal() }, made];
        }),
    ];
    const capacity = supply.reduce((sum, [, amount]) => sum.add(amount), ZERO);
    const need = set.reduce((sum, it) => sum.add(it.amount), ZERO);
    return {
        rule: "C2", name: `C2 ${item} ${what}`, group: null, need, capacity,
        issues: () => [{
            rule: "C2",
            nodes: [...lanes.keys(), ...producers.flatMap(group => group.members.map(member => member.key))],
            edges: set.flatMap(it => it.edges.map(edge => edge.key)),
            need: need.toDecimal(),
            capacity: capacity.toDecimal(),
            terms: {
                rule: "C2", item: label(item), sources: supply.map(([source]) => source), takers: set.map(it => takerOf(demand, it)),
                supply_per_second: capacity.toDecimal(), need_per_second: need.toDecimal(),
            },
        }],
    };
}

/** Every cut of the build, in rule order; `refuses` says which ones fail */
export function cutsOf(demand: DemandResult): Cut[] {
    const { view, crafts, basis, demands } = demand;
    const target = view.facts.target;
    const cuts: Cut[] = [];

    // what each belt carries at most: the ceilings of its two sides, at the largest stack anything puts on it (a side's
    // stack is the config's; an inserter that drops onto the belt stacks up to its own most, `max_belt_stack_size`)
    const facts_edge = new Map(view.facts.edges.map(edge => [edge.key, edge]));
    const dropStack = new Map<string, number>();
    for (const edge of view.carrying) {
        const sink = view.node.get(nodeKeyOf(edge.to));
        const dropper = facts_edge.get(edge.key);
        if (sink?.kind === "lane" && dropper?.via === "inserter") dropStack.set(sink.entity, Math.max(dropStack.get(sink.entity) ?? 0, dropper.hand.max_belt_stack_size));
    }
    const beltCeilings = new Map<string, Fraction>();
    for (const node of view.facts.nodes) {
        if (node.kind !== "lane") continue;
        const stack = Math.max(node.lane.stack, dropStack.get(node.entity) ?? 0);
        const side = exact(node.lane.items_per_second_ceiling).multiply(stack).divide(node.lane.stack);
        beltCeilings.set(node.entity, (beltCeilings.get(node.entity) ?? ZERO).add(side));
    }
    const endOf = (edge: GraphEdge): string => {
        const node = view.node.get(nodeKeyOf(edge.to));
        return node?.kind === "lane" ? node.entity : edge.to;
    };

    // C1: a recipe's machines
    const capacities = new Map(view.groups.map(group => [group.key, group.members.map(member => machineCapacityOf(view, member))]));
    const groupCapacity = (group: ProducerGroup): Fraction => capacities.get(group.key)!.reduce((sum, capacity) => sum.add(capacity.crafts), ZERO);
    const trapped = trappedResultsOf(view);
    for (const group of view.groups) {
        const need = crafts.get(group.key)!;
        if (!(need.getNumerator > 0)) continue;
        const capacity = groupCapacity(group);
        cuts.push({
            rule: "C1", name: `C1 ${group.key}`, group: group.key, need, capacity,
            issues: () => {
                const members = new Set(group.members.map(member => member.key));
                const traps = trapped.filter(trap => members.has(trap.machine));
                if (traps.length > 0) {
                    const free = capacities.get(group.key)!.filter(it => !traps.some(trap => trap.machine === it.member.key));
                    const others = free.length === 0 ? null : {
                        ids: free.map(it => numberOf(it.member.key)),
                        crafts_per_second: free.reduce((sum, it) => sum.add(it.crafts), ZERO).toDecimal(),
                        need_crafts_per_second: need.toDecimal(),
                    };
                    return traps.map(trap => trappedResultIssue(view, trap, others));
                }
                const why = basis.get(group.key)!;
                const limits = capacities.get(group.key)!;
                return [{
                    rule: "C1",
                    nodes: group.members.map(member => member.key),
                    edges: limits.flatMap(it => it.limit.edges.map(edge => edge.key)),
                    need: need.toDecimal(),
                    capacity: capacity.toDecimal(),
                    terms: {
                        rule: "C1", producer: group.kind, ids: idsOf(group), recipe: recipeLabel(group.recipe),
                        crafts_per_second: capacity.toDecimal(), limits: limitsOf(limits), need_crafts_per_second: need.toDecimal(),
                        need: { item: label(why.item), per_second: why.per_second.toDecimal(), per_craft: why.per_craft.toDecimal(), how: why.how },
                    },
                }];
            },
        });
    }

    // C2: the supply of an item, where it comes only from lanes from outside, or from more than one place
    for (const item of unique(demands.map(it => it.item))) {
        const known = demands.filter(it => it.item === item && it.kind !== "destroyed" && it.edges.length > 0 && it.amount.getNumerator > 0 && !it.roots.unbounded);
        const from_outside = known.filter(it => it.roots.producers.size === 0);
        const producers = unique(known.flatMap(it => [...it.roots.producers]));
        const mixed = producers.length > 1 || (producers.length === 1 && known.some(it => it.roots.lanes.size > 0));
        for (const set of [from_outside, mixed ? known : []]) {
            if (set.length === 0) continue;
            cuts.push(supplyCut(demand, item, set, groupCapacity, set === from_outside ? "from outside" : "in all"));
        }
    }

    // C3 and C6: what leaves through terminal edges; onto a belt, at most what the belt carries. The facts do not say on
    // which side of a belt a drop lands where the config names no drop spot (`to` is then the side its hand is rounded
    // to, a guess), so a drop is held to its belt's two sides, not to one
    const throughEnds = (edges: readonly GraphEdge[]) => {
        const capped: { belt: number; per_second: number }[] = [];
        const parts = unique(edges.map(endOf)).map(end => {
            const sum = ceilingOf(edges.filter(edge => endOf(edge) === end));
            if (!beltCeilings.has(end)) return sum;
            const ceiling = beltCeilings.get(end)!;
            if (sum === null || above(sum, ceiling)) capped.push({ belt: numberOf(end), per_second: ceiling.toDecimal() });
            return lowest(sum, ceiling);
        });
        return { capacity: sumOf(parts), capped };
    };
    for (const of of demands.filter(it => it.kind === "target")) {
        const { capacity, capped } = throughEnds(of.edges);
        cuts.push({
            rule: "C3", name: `C3 ${of.item}`, group: null, need: of.amount, capacity,
            issues: () => [{
                rule: "C3", nodes: unique(of.edges.map(edge => edge.to)), edges: of.edges.map(edge => edge.key),
                need: of.amount.toDecimal(), capacity: capacity!.toDecimal(),
                terms: {
                    rule: "C3", item: label(of.item), carriers: carriersOf(of.edges), capped, per_second: capacity!.toDecimal(),
                    target_per_second: of.amount.toDecimal(), copies: target.copies,
                },
            }],
        });
    }

    // C4: one inserter's swings, shared by the items it carries
    const at_least = new Map<string, Fraction>();
    for (const of of demands) {
        for (const edge of of.edges) {
            const others = sumOf(of.edges.filter(other => other !== edge).map(other => other.ceiling === null ? null : exact(other.ceiling)));
            if (others === null) continue;
            const rate = less(of.amount, others);
            if (rate.getNumerator > 0 && !(at_least.has(edge.key) && !above(rate, at_least.get(edge.key)!))) at_least.set(edge.key, rate);
        }
    }
    for (const group of view.facts.capacity_groups) {
        const edges = view.carrying.filter(edge => edge.group === group.group);
        if (edges.length < 2) continue;
        // a swing of an item takes at least its floor cycle and moves at most a hand; a floor nobody knows takes nothing
        const shares = edges.map(edge => ({
            edge,
            rate: at_least.get(edge.key) ?? ZERO,
            share: edge.floor_cycle === null || edge.hand === null ? ZERO
                : (at_least.get(edge.key) ?? ZERO).multiply(edge.floor_cycle).divide(60 * edge.hand),
        }));
        const need = shares.reduce((sum, it) => sum.add(it.share), ZERO);
        if (!(need.getNumerator > 0)) continue;
        cuts.push({
            rule: "C4", name: `C4 ${group.group}`, group: null, need, capacity: fraction(1),
            issues: () => [{
                rule: "C4", nodes: [], edges: edges.map(edge => edge.key), need: need.toDecimal(), capacity: 1,
                terms: {
                    rule: "C4", inserter: numberOf(group.group), share: need.toDecimal(), carries: unique(edges.map(edge => label(edge.item))),
                    // an item with no share (none it must carry, or a floor nobody knows) is named only among what it carries
                    items: shares.filter(it => it.share.getNumerator > 0).map(it => ({
                        item: label(it.edge.item), at_least_per_second: it.rate.toDecimal(), hand: it.edge.hand!, ticks: it.edge.floor_cycle!,
                        share: it.share.toDecimal(),
                    })),
                },
            }],
        });
    }

    // C5: what is taken off a belt. A pickup takes from the sides of its belt that carry its item; where the build drops
    // the item onto the belt too, it may land on either side (see C3), so the belt's sides of the item are one cut, at
    // most the belt's ceiling, and at most what is dropped onto it where no side brings the item from outside or spoils
    // into it; where nothing is dropped and nothing spoils into it, each side is a cut of its own, at most its ceiling
    const lane_ports = view.graph.nodes.filter(node => node.kind === "lane").flatMap(node => node.ports);
    const itemOf = (port: string) => port.slice(port.indexOf("#") + 1);
    const units = new Map<string, { ports: string[]; belt: string; lane: string | null; capacity: Fraction; put: Fraction | null; fed: GraphEdge[] }>();
    const unit_of = new Map<string, string>();
    for (const port of lane_ports) {
        const node = view.node.get(nodeKeyOf(port)) as LaneNode;
        const item = itemOf(port);
        const ports = lane_ports.filter(other => itemOf(other) === item && (view.node.get(nodeKeyOf(other)) as LaneNode).entity === node.entity);
        const fed = ports.flatMap(other => (view.into.get(other) ?? []).filter(edge => edge.item === item));
        const spoiled = view.facts.nodes.some(other => other.kind === "lane" && other.entity === node.entity && spoilsInto(other, item));
        if (fed.length === 0 && !spoiled) {
            units.set(port, { ports: [port], belt: node.entity, lane: node.key, capacity: laneCeiling(view, port), put: null, fed });
            unit_of.set(port, port);
            continue;
        }
        const key = `${node.entity}#${item}`;
        const brings = spoiled || ports.some(other => laneBrings(view.node.get(nodeKeyOf(other))!, item));
        const put = brings ? null : ceilingOf(fed);
        units.set(key, { ports, belt: node.entity, lane: null, capacity: lowest(beltCeilings.get(node.entity)!, put)!, put, fed });
        unit_of.set(port, key);
    }
    for (const [key, unit] of units) {
        const item = itemOf(unit.ports[0]);
        let need = ZERO;
        const takers: GraphEdge[] = [];
        for (const of of demands.filter(it => it.item === item)) {
            const from = unique(of.edges.flatMap(edge => edge.from_ports));
            if (!from.some(port => unit.ports.includes(port))) continue;
            takers.push(...of.edges.filter(edge => edge.from_ports.some(port => unit.ports.includes(port))));
            const elsewhere = unique(from.filter(port => !unit.ports.includes(port)).map(port => unit_of.get(port) ?? port));
            const others = sumOf(elsewhere.map(other => units.get(other)?.capacity ?? null));
            if (others !== null) need = need.add(less(of.amount, others));
        }
        if (!(need.getNumerator > 0)) continue;
        cuts.push({
            rule: "C5", name: `C5 ${key}`, group: null, need, capacity: unit.capacity,
            issues: () => [{
                rule: "C5", nodes: unit.ports, edges: unique([...unit.fed, ...takers]).map(edge => edge.key), need: need.toDecimal(),
                capacity: unit.capacity.toDecimal(),
                terms: {
                    rule: "C5", belt: numberOf(unit.belt), lane: unit.lane === null ? null : laneOf(unit.lane).lane, item: label(item),
                    fillers: unit.put !== null && above(beltCeilings.get(unit.belt)!, unit.put) ? carriersOf(unit.fed) : null,
                    per_second: unit.capacity.toDecimal(), takers: unique(takers.map(edge => numberOf(edge.entity))), need_per_second: need.toDecimal(),
                },
            }],
        });
    }

    // C6: an export belt
    for (const of of demands.filter(it => it.kind === "export")) {
        const { capacity, capped } = throughEnds(of.edges);
        cuts.push({
            rule: "C6", name: `C6 ${of.belt}#${of.item}`, group: null, need: of.amount, capacity,
            issues: () => [{
                rule: "C6", nodes: unique(of.edges.map(edge => edge.to)), edges: of.edges.map(edge => edge.key),
                need: of.amount.toDecimal(), capacity: capacity!.toDecimal(),
                terms: {
                    rule: "C6", belt: numberOf(of.belt!), item: label(of.item), carriers: carriersOf(of.edges), capped,
                    per_second: capacity!.toDecimal(), consumed_per_second: of.amount.toDecimal(),
                },
            }],
        });
    }

    // C7: the target destroyed, by what the machines destroy and by what the inserters bring in
    if (demand.destroyers.length > 0) {
        const need = exact(target.per_copy);
        const first = demand.destroyers[0];
        // what a craft uses and gives back, for the text, only where every destroyer's craft is alike
        const same = (a: Fraction, b: Fraction) => a.subtract(b).getNumerator === 0;
        const alike = demand.destroyers.every(it => same(it.uses, first.uses) && same(it.gives_back, first.gives_back));
        const machines = demand.destroyers.reduce((sum, it) => sum.add(exact(it.member.production.crafts_per_second).multiply(it.uses.subtract(it.gives_back))), ZERO);
        const groups = unique(demand.destroyers.map(it => view.group_of.get(it.member.key)!.key));
        cuts.push({
            rule: "C7", name: "C7 machines", group: groups.length === 1 ? groups[0] : null, need, capacity: machines,
            issues: () => [{
                rule: "C7", nodes: demand.destroyers.map(it => it.member.key), edges: [], need: need.toDecimal(), capacity: machines.toDecimal(),
                terms: {
                    rule: "C7", item: label(target.item), target_per_second: need.toDecimal(), copies: target.copies, per_second: machines.toDecimal(),
                    by: {
                        kind: "machines", ids: demand.destroyers.map(it => numberOf(it.member.key)), recipe: recipeLabel(first.member.production.recipe_or_resource),
                        crafts_per_second: demand.destroyers.reduce((sum, it) => sum.add(exact(it.member.production.crafts_per_second)), ZERO).toDecimal(),
                        uses: alike ? first.uses.toDecimal() : null, gives_back: alike ? first.gives_back.toDecimal() : null,
                    },
                },
            }],
        });
        const edges = demand.destroyers.flatMap(it => it.edges);
        const brought = ceilingOf(edges);
        cuts.push({
            rule: "C7", name: "C7 inserters", group: null, need, capacity: brought,
            issues: () => [{
                rule: "C7", nodes: [], edges: edges.map(edge => edge.key), need: need.toDecimal(), capacity: brought!.toDecimal(),
                terms: {
                    rule: "C7", item: label(target.item), target_per_second: need.toDecimal(), copies: target.copies, per_second: brought!.toDecimal(),
                    by: { kind: "inserters", carriers: carriersOf(edges) },
                },
            }],
        });
    }
    return cuts;
}
