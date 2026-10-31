/**
 * The demand of a crafting cycle as balance equations over the planner graph (synchronous dataflow's `Γq = 0`): what
 * every inserter and drill moves a cycle, and what every machine makes, for the hands a cycle the target's own edges
 * move (the seed: the cycle plan's choice of output swings, or of hands of a destroyed target brought in).
 *
 * The unknowns are the hands a cycle of every edge and the items of its main product each machine makes a cycle. The
 * rows are one per edge and one per machine:
 * - an edge that loads a machine moves its share of what the machine's crafts take of its item: the item a craft takes
 *   over what a craft makes, times what the machine makes, split evenly among the inserters that bring it the item, over
 *   the edge's hand (a drill's in DRILL_ITEMS_PER_SWING items). A machine that places a result into the machine supplies
 *   all of that item, with no hand; a modelled fuel that comes with the ingredients is one more item a craft takes;
 * - an edge that fills a container moves its share of what every edge taking from the container moves, split evenly among
 *   the inserters that drop into the container, each at its own hand;
 * - an edge that fills a lane moves its share of what every edge taking off the belt moves of its item, split evenly among
 *   the inserters that drop the item onto the belt, at its own hand; consumers outside the build that empty an export
 *   belt draw from its fillers too;
 * - a machine makes what the target asks of it directly plus what the edges taking from it move, and what the machines
 *   that place results into others are asked.
 * Hands need not be whole a cycle: the period is the lcm of their denominators (the repetitions vector), and a machine's
 * crafts need not be whole at all (it carries part crafts and productivity from one cycle to the next).
 *
 * The system is solved in exact fractions by substitution, the consumers first: the machine rows, condensed into their
 * strongly connected parts (the loops of machines that feed each other), are solved one part at a time, a loop as its
 * own sub-system by Gaussian elimination, and every edge row then follows from the machines it serves. A loop whose
 * sub-system is singular uses up everything it makes: no amount of crafting meets the target, which is refused (the
 * named check `LOOP_USES_ALL`). Fuel is rounded up to the fractions of a hand the ingredients come in (fuelRoundedUp),
 * so the system is solved with the fuel and without it.
 *
 * Synchronous dataflow models a producer's `held_limit` and a consumer's insertion limit as bounded buffers: back edges
 * with that many initial tokens. A back edge's row is its forward edge's with the sign turned, so it changes no solution
 * of `Γq = 0` and is no row here; the limits bound which periods can run (P-limit, P-stock), not the hands of one.
 *
 * The transfers are listed from the target's edges back to the inputs: the target's edges, the fillers of the export
 * belts, then each machine's loaders from the output back, every filler after the edge it fills for.
 */
import assert from "../../common/assert";
import type { Config } from "../../config/schema";
import Fraction, { fraction } from "../../data-types/fraction";
import type { MachineNode, PlannerFacts, PlannerNode } from "../../data-types/planner-facts";
import type { GraphEdge, PlannerGraph } from "../../data-types/planner-graph";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { nodeKeyOf } from "../feasibility/demand";
import { plannerGraphOf } from "../graph/build-graph";

/**
 * Items a mining drill's "swing" stands for. A drill drops what it mines straight into the machine it faces, with no
 * inserter and no hand, so the number is not any inserter's hand: it is the unit in which the plan counts a drill's
 * output per cycle (swings = items / 16), which sets how many whole drops a base cycle holds and so the cycle's length
 * together with the inserters' hands. It was the hand of the legendary stack inserter that the samples are built with, and
 * it is kept at 16 for every build so that a drill's plan does not move when an inserter's prototype does. Nothing in the
 * game data says what a drill's unit should be; whether it should follow the hand of the inserters beside it is open.
 */
export const DRILL_ITEMS_PER_SWING = 16;

/** The planner facts and graph of a build, which the balance is solved over */
export interface BalanceBuild {
    readonly facts: PlannerFacts;
    readonly graph: PlannerGraph;
}

const built = new WeakMap<Config, BalanceBuild>();

/** The facts and graph of a config, made once per config object */
export function balanceBuildOf(config: Config): BalanceBuild {
    let build = built.get(config);
    if (build === undefined) {
        const facts = toPlannerFacts(config);
        build = { facts, graph: plannerGraphOf(facts) };
        built.set(config, build);
    }
    return build;
}

/** Fuel burned per craft is counted in parts of an item this small, rounded up, to keep its fraction simple */
const FUEL_PARTS_PER_ITEM = 1000;

/** What the target's edges move a cycle, for a target that counts an item made */
export interface MadeSeed {
    readonly counts: "made";
    readonly item: string;
    /**
     * Each machine that makes the target, with the inserters that take it out of the build (`takers`), and where it puts
     * the target into one container that they take it from, the inserters that put it there (`feeders`, else empty)
     */
    readonly outputs: readonly { readonly machine: string; readonly takers: readonly string[]; readonly feeders: readonly string[] }[];
    /** Output swings a cycle of each machine, split among its takers */
    readonly swings: Fraction;
    /** The hand the output swings are counted in */
    readonly hand: number;
    /** Ticks of the cycle, for what consumers outside the build take off export belts; absent: none is drawn */
    readonly cycle_ticks?: number;
}

/** What the target's edges move a cycle, for a target that counts an item destroyed */
export interface DestroyedSeed {
    readonly counts: "destroyed";
    readonly item: string;
    /** Hands of the item brought into each machine a cycle */
    readonly hands: Fraction;
    /**
     * Each machine that destroys it: the inserters that bring it in from outside, the crafts that makes, and the
     * inserters that take each of its results out of the container it places them into
     */
    readonly machines: readonly {
        readonly machine: string;
        readonly bringing: readonly string[];
        readonly crafts: Fraction;
        readonly results: readonly { readonly item: string; readonly takers: readonly string[] }[];
    }[];
}

export type BalanceSeed = MadeSeed | DestroyedSeed;

/** One item an inserter or a drill moves a cycle, in hands */
export interface BalancedItem {
    readonly item: string;
    readonly hands: Fraction;
}

/** What an inserter or a drill moves a cycle */
export interface BalancedTransfer {
    /** The inserter or drill, "inserter:5", "drill:1" */
    readonly entity: string;
    /** In the order it carries them */
    readonly items: readonly BalancedItem[];
    readonly total: Fraction;
    /**
     * Hands a cycle the machine needs, ingredients and fuel together, before the fuel is rounded up; set on every
     * inserter or drill that loads a machine of a made target
     */
    readonly needed?: Fraction;
    /** Its hand of the first item it carries; DRILL_ITEMS_PER_SWING for a drill */
    readonly hand: number;
}

export interface Balance {
    readonly transfers: readonly BalancedTransfer[];
    /** Items of its main product each machine makes a cycle, by machine; for a destroyed target, its crafts' worth */
    readonly made: ReadonlyMap<string, Fraction>;
}

/** The named check of a singular loop: its machines use up everything they make */
export const LOOP_USES_ALL = (machine: string): string =>
    `Machine ${machine} is in a loop of machines that uses up everything it makes, so no amount of crafting meets the target.`;

// ---------------------------------------------------------------------------------------------------------------------
// The graph as the rows read it
// ---------------------------------------------------------------------------------------------------------------------

interface BalanceView {
    readonly node: ReadonlyMap<string, PlannerNode>;
    readonly machines: readonly MachineNode[];
    /** Every edge of an inserter or placer, by entity, in edge order */
    readonly edges_of: ReadonlyMap<string, readonly GraphEdge[]>;
    /** Inserter and placement edges by the node they drop into (a lane's belt for a lane), in edge order */
    readonly into: ReadonlyMap<string, readonly GraphEdge[]>;
}

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
};

/** The node an edge drops into, or for a lane its belt: a belt's fillers fill it whatever lane they drop on */
function sinkOf(view: Pick<BalanceView, "node">, edge: GraphEdge): string {
    const node = view.node.get(nodeKeyOf(edge.to))!;
    return node.kind === "lane" ? node.entity : node.key;
}

function viewOf(facts: PlannerFacts, graph: PlannerGraph): BalanceView {
    const node = new Map(facts.nodes.map(it => [it.key, it]));
    const edges_of = new Map<string, GraphEdge[]>();
    const into = new Map<string, GraphEdge[]>();
    for (const edge of graph.edges) {
        pushTo(edges_of, edge.entity, edge);
    }
    const view = { node, machines: facts.nodes.filter((it): it is MachineNode => it.kind === "machine"), edges_of, into };
    for (const edge of graph.edges) {
        pushTo(into, sinkOf(view, edge), edge);
    }
    return view;
}

/** The distinct entities of edges, in edge order */
const entitiesOf = (edges: readonly GraphEdge[]): string[] => [...new Set(edges.map(edge => edge.entity))];

const exactOf = (ratio: { numerator: number; denominator: number }): Fraction => new Fraction(ratio.numerator, ratio.denominator);

/** What a craft of a machine makes of an item, exact; of its main product where no item is named */
function perCraftOf(node: MachineNode, item?: string): Fraction {
    const result = item === undefined ? node.yield.results.find(it => it.main) : node.yield.results.find(it => it.item === item);
    assert(result !== undefined, `${node.key} makes no ${item ?? "main product"}`);
    return exactOf(result.per_craft);
}

/** The hand of an inserter of an item, as its edge of the item has it */
function handOf(view: BalanceView, entity: string, item: string): number {
    const edge = view.edges_of.get(entity)?.find(it => it.item === item);
    assert(edge !== undefined && edge.hand !== null, `${entity} carries no ${item}`);
    return edge.hand;
}

const carries = (view: BalanceView, entity: string, item: string): boolean =>
    (view.edges_of.get(entity) ?? []).some(edge => edge.item === item);

// ---------------------------------------------------------------------------------------------------------------------
// The transfers as they are listed
// ---------------------------------------------------------------------------------------------------------------------

/** Transfers by entity in the order first listed; what is listed again of an entity is added to it */
class Listing {
    readonly by_entity = new Map<string, BalancedTransfer>();

    add(transfer: BalancedTransfer): void {
        const existing = this.by_entity.get(transfer.entity);
        if (existing === undefined) {
            this.by_entity.set(transfer.entity, transfer);
            return;
        }
        const items = existing.items.map(it => ({ ...it }));
        for (const added of transfer.items) {
            const at = items.findIndex(it => it.item === added.item);
            if (at === -1) items.push({ ...added });
            else items[at] = { item: added.item, hands: items[at].hands.add(added.hands) };
        }
        this.by_entity.set(transfer.entity, {
            entity: existing.entity,
            items,
            total: existing.total.add(transfer.total),
            ...(existing.needed === undefined && transfer.needed === undefined ? {}
                : { needed: (existing.needed ?? existing.total).add(transfer.needed ?? transfer.total) }),
            hand: existing.hand,
        });
    }

    values(): BalancedTransfer[] {
        return [...this.by_entity.values()];
    }
}

/** Items a cycle asked of machines, by machine, in the order first asked */
type Asked = Map<string, Fraction>;

function ask(asked: Asked, machine: string, items: Fraction): void {
    asked.set(machine, (asked.get(machine) ?? fraction(0)).add(items));
}

// ---------------------------------------------------------------------------------------------------------------------
// The edge rows
// ---------------------------------------------------------------------------------------------------------------------

/** Whether an inserter brings a machine its fuel alone: then the fuel has a clock of its own, not the ingredients' */
function hasFuelOnlyInserter(view: BalanceView, node: MachineNode): boolean {
    const fuel = node.energy.fuel;
    if (fuel === null) return false;
    const ingredient = node.production.inputs.some(input => input.item === fuel.item);
    return entitiesOf((view.into.get(node.key) ?? []).filter(edge => edge.via === "inserter"))
        .some(entity => view.edges_of.get(entity)!.every(edge => edge.item === fuel.item && !ingredient));
}

/**
 * The rows of the edges that load a machine making `output_items` a cycle, and of the edges that fill what they take
 * from: each is listed with what it moves, and what they take from other machines is asked of those (`asked`)
 */
function loadersOf(
    view: BalanceView,
    node: MachineNode,
    output_items: Fraction,
    listing: Listing,
    asked: Asked,
    include_fuel: boolean,
    except_items: ReadonlySet<string> = new Set(),
): void {
    const made_per_craft = perCraftOf(node);
    // what a craft takes of each item over what it makes: 3 of A for 6 made is 1/2
    const ratios = new Map<string, Fraction>();
    for (const input of node.production.inputs) {
        if (!except_items.has(input.item)) {
            ratios.set(input.item, fraction(input.per_craft).divide(made_per_craft));
        }
    }
    const fuel = node.energy.fuel;
    if (include_fuel && fuel !== null && !hasFuelOnlyInserter(view, node)) {
        const fuel_per_craft = fraction(Math.ceil(fuel.per_craft * FUEL_PARTS_PER_ITEM), FUEL_PARTS_PER_ITEM);
        ratios.set(fuel.item, (ratios.get(fuel.item) ?? fraction(0)).add(fuel_per_craft.divide(made_per_craft)));
    }

    const into = view.into.get(node.key) ?? [];
    // a result placed directly is supplied all by the first machine that places it, with no hand
    for (const edge of into.filter(it => it.via === "placement" && view.node.get(it.entity)?.kind === "machine")) {
        const ratio = ratios.get(edge.item);
        if (ratio === undefined) continue;
        const placer = view.node.get(edge.entity) as MachineNode;
        ask(asked, placer.key, output_items.multiply(ratio).multiply(perCraftOf(placer)).divide(perCraftOf(placer, edge.item)));
        ratios.delete(edge.item);
    }

    const inserter_edges = into.filter(it => it.via === "inserter");
    const inserters_per_item = new Map<string, number>();
    for (const edge of inserter_edges) {
        inserters_per_item.set(edge.item, (inserters_per_item.get(edge.item) ?? 0) + 1);
    }
    for (const entity of entitiesOf(inserter_edges)) {
        const items: BalancedItem[] = [];
        let total = fraction(0);
        for (const edge of view.edges_of.get(entity)!) {
            const ratio = ratios.get(edge.item);
            if (ratio === undefined) continue;
            const hands = ratio.multiply(output_items).divide(inserters_per_item.get(edge.item) ?? 1).divide(edge.hand!);
            items.push({ item: edge.item, hands });
            total = total.add(hands);
        }
        if (items.length > 0) {
            listing.add({ entity, items, total, hand: handOf(view, entity, items[0].item) });
            fillersOf(view, entity, total, items, listing, asked);
        }
    }

    const drill_edges = into.filter(it => it.via === "placement" && view.node.get(it.entity)?.kind === "drill");
    for (const edge of drill_edges) {
        const ratio = ratios.get(edge.item);
        if (ratio === undefined) continue;
        const drills = drill_edges.filter(it => it.item === edge.item).length;
        const hands = ratio.multiply(output_items).divide(drills).divide(DRILL_ITEMS_PER_SWING);
        listing.add({ entity: edge.entity, items: [{ item: edge.item, hands }], total: hands, hand: DRILL_ITEMS_PER_SWING });
    }
}

/**
 * The rows of what an inserter takes from: a machine is asked for its items, in the hands of the first; a container's
 * and a belt's fillers are listed for them
 */
function fillersOf(view: BalanceView, entity: string, total: Fraction, items: readonly BalancedItem[], listing: Listing, asked: Asked): void {
    const source = view.node.get(nodeKeyOf(view.edges_of.get(entity)![0].from));
    const hand = (item: string) => handOf(view, entity, item);
    if (source?.kind === "machine") {
        ask(asked, source.key, total.multiply(hand(items[0].item)));
    } else if (source?.kind === "container") {
        containerFillersOf(view, source.key, hand, items, listing, asked);
    } else if (source?.kind === "lane") {
        beltFillersOf(view, source.entity, hand, items, listing, asked);
    }
}

/**
 * A container passes on what is taken from it: each inserter that drops into it moves its share of every item taken, an
 * even share among all of them, in its own hands
 */
function containerFillersOf(
    view: BalanceView,
    container: string,
    downstream_hand: (item: string) => number,
    taken: readonly BalancedItem[],
    listing: Listing,
    asked: Asked,
): void {
    const fillers = entitiesOf((view.into.get(container) ?? []).filter(edge => edge.via === "inserter"));
    for (const filler of fillers) {
        const items: BalancedItem[] = [];
        let total = fraction(0);
        for (const take of taken) {
            if (!carries(view, filler, take.item)) continue;
            // the ratio of the hands as a number, as the plan has always counted it
            const hands = take.hands.divide(fillers.length).multiply(downstream_hand(take.item) / handOf(view, filler, take.item));
            items.push({ item: take.item, hands });
            total = total.add(hands);
        }
        if (items.length > 0) {
            listing.add({ entity: filler, items, total, hand: handOf(view, filler, items[0].item) });
            fillersOf(view, filler, total, items, listing, asked);
        }
    }
}

/**
 * A belt passes on what is taken off it, item by item: each inserter that drops an item onto it moves its share of what
 * is taken of the item, an even share among those that drop the item, in its own hands. A belt nothing fills brings its
 * items from outside the build.
 */
function beltFillersOf(
    view: BalanceView,
    belt: string,
    downstream_hand: (item: string) => number,
    taken: readonly BalancedItem[],
    listing: Listing,
    asked: Asked,
    include: (filler: string) => boolean = () => true,
): void {
    const fillers = entitiesOf((view.into.get(belt) ?? []).filter(edge => edge.via === "inserter")).filter(include);
    for (const filler of fillers) {
        const items: BalancedItem[] = [];
        let total = fraction(0);
        for (const take of taken) {
            if (!carries(view, filler, take.item)) continue;
            const sharing = fillers.filter(it => carries(view, it, take.item)).length;
            const hands = take.hands.divide(sharing).multiply(downstream_hand(take.item)).divide(handOf(view, filler, take.item));
            items.push({ item: take.item, hands });
            total = total.add(hands);
        }
        if (items.length > 0) {
            listing.add({ entity: filler, items, total, hand: handOf(view, filler, items[0].item) });
            fillersOf(view, filler, total, items, listing, asked);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The machine rows
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The strongly connected parts of the machine rows (Tarjan), each part after every part it is asked by: a machine
 * depends on the machines that ask of it (`asks.get(consumer).get(machine)`), so the consumers are solved first
 */
function partsOf(machines: readonly string[], asks: ReadonlyMap<string, ReadonlyMap<string, Fraction>>): string[][] {
    // the machines that ask of each machine
    const askers = new Map<string, string[]>(machines.map(it => [it, []]));
    for (const consumer of machines) {
        for (const [machine, amount] of asks.get(consumer)!) {
            if (amount.toDecimal() !== 0 && askers.has(machine)) askers.get(machine)!.push(consumer);
        }
    }
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const on_stack = new Set<string>();
    const parts: string[][] = [];
    const visit = (machine: string): void => {
        index.set(machine, index.size);
        low.set(machine, index.get(machine)!);
        stack.push(machine);
        on_stack.add(machine);
        for (const asker of askers.get(machine)!) {
            if (!index.has(asker)) {
                visit(asker);
                low.set(machine, Math.min(low.get(machine)!, low.get(asker)!));
            } else if (on_stack.has(asker)) {
                low.set(machine, Math.min(low.get(machine)!, index.get(asker)!));
            }
        }
        if (low.get(machine) === index.get(machine)) {
            const part: string[] = [];
            let member: string;
            do {
                member = stack.pop()!;
                on_stack.delete(member);
                part.push(member);
            } while (member !== machine);
            // in the machines' order
            parts.push(machines.filter(it => part.includes(it)));
        }
    };
    machines.forEach(machine => { if (!index.has(machine)) visit(machine); });
    return parts;
}

/**
 * Solves `made = asked directly + what the machines that take from it ask of it` for every machine: part by part, the
 * consumers first, a loop as its own sub-system by Gaussian elimination on exact fractions
 */
function solveMade(machines: readonly string[], direct: Asked, asks: ReadonlyMap<string, ReadonlyMap<string, Fraction>>): Map<string, Fraction> {
    const made = new Map<string, Fraction>();
    const isZero = (value: Fraction) => value.toDecimal() === 0;
    for (const part of partsOf(machines, asks)) {
        const inside = new Set(part);
        const n = part.length;
        // row i: made[i] - sum over j in the part of (what an item of j asks of i) * made[j]
        //      = asked directly of i + sum over j solved before of (what an item of j asks of i) * made[j]
        const rows: Fraction[][] = part.map((row_id, i) => {
            let rhs = direct.get(row_id) ?? fraction(0);
            for (const [consumer, solved] of made) {
                if (!inside.has(consumer)) {
                    const amount = asks.get(consumer)!.get(row_id);
                    if (amount !== undefined) rhs = rhs.add(amount.multiply(solved));
                }
            }
            return [...part.map((column_id, j) => fraction(i === j ? 1 : 0).subtract(asks.get(column_id)!.get(row_id) ?? fraction(0))), rhs];
        });
        for (let column = 0; column < n; column++) {
            const pivot = rows.findIndex((row, at) => at >= column && !isZero(row[column]));
            assert(pivot !== -1, LOOP_USES_ALL(part[column]));
            [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
            const pivot_row = rows[column].map(value => value.divide(rows[column][column]));
            rows[column] = pivot_row;
            for (let at = 0; at < n; at++) {
                if (at !== column && !isZero(rows[at][column])) {
                    const factor = rows[at][column];
                    rows[at] = rows[at].map((value, k) => value.subtract(pivot_row[k].multiply(factor)));
                }
            }
        }
        part.forEach((id, i) => made.set(id, rows[i][n]));
    }
    return made;
}

/**
 * The loaders of every machine for what the machines make: the machine rows solved, then the edge rows, each machine's
 * loaders listed from the machines asked directly back to the inputs
 */
function machineLoaders(view: BalanceView, direct: Asked, include_fuel: boolean): { listing: Listing; made: Map<string, Fraction> } {
    const machines = view.machines.map(it => it.key);
    // what one item made by each machine asks of the machines it takes from
    const asks = new Map<string, Asked>();
    for (const node of view.machines) {
        const asked: Asked = new Map();
        loadersOf(view, node, fraction(1), new Listing(), asked, include_fuel);
        asks.set(node.key, asked);
    }
    const made = solveMade(machines, direct, asks);

    const listing = new Listing();
    const listed = new Set<string>();
    const list = (machine: string): void => {
        if (listed.has(machine)) return;
        listed.add(machine);
        const items = made.get(machine) ?? fraction(0);
        if (items.toDecimal() <= 0) return;
        loadersOf(view, view.node.get(machine) as MachineNode, items, listing, new Map(), include_fuel);
        Array.from(asks.get(machine)!.keys()).forEach(list);
    };
    Array.from(direct.keys()).forEach(list);
    return { listing, made };
}

/**
 * Fuel is burned at a rate that has nothing to do with the hands of the plan, so counted exactly it would stretch the
 * clock period to fit it. What an inserter carries on top of its ingredients is rounded up to the fractions of a hand its
 * ingredients already come in: a little more room than the fuel needs, in a period that stays the same.
 */
function fuelRoundedUp(with_fuel: BalancedTransfer, without_fuel: BalancedTransfer | undefined): BalancedTransfer {
    const cycles = without_fuel?.total.getDenominator ?? 1;
    const items = with_fuel.items.map(transfer => {
        const exact = without_fuel?.items.find(it => it.item === transfer.item)?.hands ?? fraction(0);
        const for_fuel = transfer.hands.toDecimal() - exact.toDecimal();
        if (for_fuel <= 1e-9) {
            return { item: transfer.item, hands: exact };
        }
        const parts = Math.max(cycles, exact.getDenominator);
        return { item: transfer.item, hands: exact.add(fraction(Math.ceil(for_fuel * parts - 1e-9), parts)) };
    }).filter(it => it.hands.toDecimal() > 0);
    return {
        entity: with_fuel.entity,
        items,
        total: items.reduce((sum, it) => sum.add(it.hands), fraction(0)),
        needed: with_fuel.total,
        hand: with_fuel.hand,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// The two targets
// ---------------------------------------------------------------------------------------------------------------------

function balanceMade(view: BalanceView, seed: MadeSeed): Balance {
    const listing = new Listing();
    const direct: Asked = new Map();
    for (const output of seed.outputs) {
        const per_taker = seed.swings.divide(output.takers.length);
        for (const taker of output.takers) {
            listing.add({ entity: taker, items: [{ item: seed.item, hands: per_taker }], total: per_taker, hand: handOf(view, taker, seed.item) });
        }
        // through a container: the feeders put into it what the takers take out, at their own hands
        if (output.feeders.length > 0) {
            const items_per_feeder = seed.swings.multiply(seed.hand).divide(output.feeders.length);
            for (const feeder of output.feeders) {
                const hands = items_per_feeder.divide(handOf(view, feeder, seed.item));
                listing.add({ entity: feeder, items: [{ item: seed.item, hands }], total: hands, hand: handOf(view, feeder, seed.item) });
            }
        }
        ask(direct, output.machine, seed.swings.multiply(seed.hand));
    }

    // export belts: what consumers outside the build take off them, from the fillers other than the target's own
    if (seed.cycle_ticks !== undefined) {
        const output_machines = new Set(seed.outputs.map(it => it.machine));
        const belts = [...new Set([...view.node.values()].flatMap(node => node.kind === "lane" ? [node.entity] : []))];
        for (const belt of belts) {
            const consumed: BalancedItem[] = [...view.node.values()]
                .flatMap(node => node.kind === "lane" && node.entity === belt && node.lane.listed && (node.lane.export_per_second ?? 0) > 0
                    ? [{ item: node.lane.item ?? "", hands: fraction(node.lane.export_per_second!).multiply(seed.cycle_ticks!).divide(60) }] : []);
            if (consumed.length > 0) {
                beltFillersOf(view, belt, () => 1, consumed, listing, direct,
                    filler => !output_machines.has(nodeKeyOf(view.edges_of.get(filler)![0].from)));
            }
        }
    }

    const without_fuel = machineLoaders(view, direct, false);
    const with_fuel = machineLoaders(view, direct, true);
    for (const planned of with_fuel.listing.values()) {
        listing.add(fuelRoundedUp(planned, without_fuel.listing.by_entity.get(planned.entity)));
    }
    return { transfers: listing.values(), made: with_fuel.made };
}

function balanceDestroyed(view: BalanceView, seed: DestroyedSeed): Balance {
    const listing = new Listing();
    const made = new Map<string, Fraction>();
    for (const destroying of seed.machines) {
        const node = view.node.get(destroying.machine) as MachineNode;
        for (const entity of destroying.bringing) {
            const hands = seed.hands.divide(destroying.bringing.length);
            listing.add({ entity, items: [{ item: seed.item, hands }], total: hands, hand: handOf(view, entity, seed.item) });
        }
        for (const result of destroying.results) {
            const per_taker = perCraftOf(node, result.item).multiply(destroying.crafts).divide(result.takers.length);
            for (const taker of result.takers) {
                const hands = per_taker.divide(handOf(view, taker, result.item));
                listing.add({ entity: taker, items: [{ item: result.item, hands }], total: hands, hand: handOf(view, taker, result.item) });
            }
        }
        // its other ingredients and fuel, as any machine's making what these crafts make
        const items = destroying.crafts.multiply(perCraftOf(node));
        made.set(node.key, items);
        const others = new Listing();
        loadersOf(view, node, items, others, new Map(), true, new Set([seed.item]));
        others.values().forEach(planned => listing.add(planned));
    }
    return { transfers: listing.values(), made };
}

/** The balance of a cycle: what every edge moves and every machine makes for what the target's edges move */
export function balanceOf(facts: PlannerFacts, graph: PlannerGraph, seed: BalanceSeed): Balance {
    const view = viewOf(facts, graph);
    return seed.counts === "made" ? balanceMade(view, seed) : balanceDestroyed(view, seed);
}

/** The cycles of the period: the lcm of the denominators of every hand a cycle, those of `ignored_items` left out */
export function periodCyclesOf(transfers: readonly BalancedTransfer[], ignored_items: readonly string[] = []): number {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    return transfers.flatMap(it => it.items).filter(it => !ignored_items.includes(it.item))
        .reduce((lcm, it) => lcm / gcd(lcm, it.hands.getDenominator) * it.hands.getDenominator, 1);
}
