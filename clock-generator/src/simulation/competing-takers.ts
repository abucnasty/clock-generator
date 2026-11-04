import { EntityState, ReadableEntityStateRegistry } from "../state";
import type { InserterArchetype } from "./archetypes/inserter";

/**
 * In what order the inserters that take one product from one machine are served in a tick. The game serves them in one
 * stable local order in the measured intervals: the first takes up to its hand, the next what is left, in the same tick, and the one that
 * took last is not passed over (recorded on the #100 supercapacitor plant, 59 of 62 decided ticks one way, and on the
 * pentapod egg biochambers of #90, every contested tick one way). Which taker the game puts first is not known from a
 * config, so a clock is checked under several orders (`takerOrdersToCheck`, `otherTakerOrdersOf` in trial.ts): "descending" config ids, "ascending",
 * the descending order turned round by `rotation` places in each machine's group, or an order drawn from a seed. The
 * sampled order stays the same for the whole simulation run; this is not a universal native scheduling rule.
 * Sources can have different local priorities. The default is "descending".
 */
type SingleTakerOrder = "descending" | "ascending" | { rotation: number } | { seed: number };
export type TakerOrder = SingleTakerOrder | { source_orders: Readonly<Record<string, SingleTakerOrder>> };

export const DEFAULT_TAKER_ORDER: SingleTakerOrder = "descending";

/**
 * The orders a clock is checked under where `takers` inserters at most take one product from one machine: the default
 * alone where no machine has two, both ways round where the most is two, and where it is more, the descending order
 * and each of its rotations, so that every taker of a group is served first once and last once (two orders would leave
 * the middle ones never first nor last). For multiple contested sources, independentTakerOrdersToCheck adds one-source-at-a-time checks.
 */
export function takerOrdersToCheck(takers: number): SingleTakerOrder[] {
    if (takers < 2) return [DEFAULT_TAKER_ORDER];
    if (takers === 2) return ["descending", "ascending"];
    return [DEFAULT_TAKER_ORDER, ...Array.from({ length: takers - 1 }, (_, index) => ({ rotation: index + 1 }))];
}

/**
 * The existing global orders plus changing one contested source at a time. This adds independent mixed orders without
 * multiplying every source's choices: a real the circuit export build build has up to 512 combinations before its windows are considered.
 * Joint changes of several sources are not exhausted; this is a strict extension of the existing sampled-order gate.
 */
export function independentTakerOrdersToCheck(sources: readonly { id: string; size: number; contested: number }[]): TakerOrder[] {
    const groups = sources.filter(it => it.contested > 1);
    if (groups.length === 0) return [DEFAULT_TAKER_ORDER];
    const together = Math.max(...groups.map(it => it.contested));
    const size = Math.max(...groups.filter(it => it.contested >= 3).map(it => it.size), 0);
    const global = takerOrdersToCheck(together >= 3 ? size : together);
    if (groups.length === 1) return global;
    const local = groups.flatMap(source => takerOrdersToCheck(source.contested >= 3 ? source.size : 2).slice(1)
        .map(order => ({source_orders: {[source.id]: order}})));
    return [...global, ...local];
}

/** How an order is named in a line of the generator: "descending", "ascending", "rotated by 2", "drawn from seed 1" */
export function takerOrderName(order: TakerOrder): string {
    if (typeof order === "string") return order;
    if ("source_orders" in order) return `source orders ${JSON.stringify(order.source_orders)}`;
    return "rotation" in order ? `rotated by ${order.rotation}` : `drawn from seed ${order.seed}`;
}

/** A small seeded generator of numbers in [0, 1): mulberry32 */
function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The members of a group in the order given, by their config ids (see TakerOrder) */
function rankedMembers<T>(members: readonly T[], number_of: (member: T) => number, order: SingleTakerOrder, draw: (() => number) | null): T[] {
    const key = new Map(members.map(it => [it, draw === null ? number_of(it) : draw()] as const));
    // the descending order and its rotations put the highest id first; the ascending and the drawn the lowest key
    const sign = order === "descending" || (typeof order === "object" && "rotation" in order) ? -1 : 1;
    const ranked = [...members].sort((a, b) => sign * (key.get(a)! - key.get(b)!));
    if (typeof order === "object" && "rotation" in order) {
        const by = order.rotation % ranked.length;
        return [...ranked.slice(by), ...ranked.slice(0, by)];
    }
    return ranked;
}

/**
 * The inserters of a simulation in the order a tick updates them: the order of the list except where several take from
 * one machine: those are updated in the order of `order` on every tick, among the places they have in the list, so the
 * first of them takes up to its hand and the next what is left (see TakerOrder). Every inserter that takes from a
 * machine stays ahead of the inserters that put into it, as the list has them (`orderInsertersDownstreamFirst`): a taker
 * served late among its competitors does not move an inserter of its own sink's feeders ahead of that sink's takers,
 * which the rule for windows that open together needs (`Hand.wokenThisTick`). The phase table's inserters phase runs them
 * in this order (simulation/tick-phases.ts).
 */
export function inserterUpdateOrder(
    inserters: readonly InserterArchetype[],
    states: ReadableEntityStateRegistry,
    order: TakerOrder = DEFAULT_TAKER_ORDER,
): InserterArchetype[] {
    const list = [...inserters];
    const places_by_machine = new Map<string, number[]>();
    inserters.forEach((it, place) => {
        const source = it.inserter_state.inserter.source.entity_id;
        if (source.type === "machine") {
            places_by_machine.set(source.id, [...(places_by_machine.get(source.id) ?? []), place]);
        }
    });
    const draw = typeof order === "object" && "seed" in order ? seeded(order.seed) : null;
    const groups: { places: number[]; ranked: InserterArchetype[] }[] = [];
    for (const places of places_by_machine.values()) {
        const machine = states.getStateByEntityId(inserters[places[0]].inserter_state.inserter.source.entity_id);
        if (places.length < 2 || machine === null || !EntityState.isMachine(machine)) {
            continue;
        }
        const members = places.map(place => inserters[place]);
        // Draw seeded ranks before skipping: later groups must keep the same seeded order.
        const local_order = typeof order === "object" && "source_orders" in order
            ? order.source_orders[machine.entity_id.id] ?? DEFAULT_TAKER_ORDER : order;
        const ranked = rankedMembers(members, it => it.inserter_state.entity_id.number, local_order, draw);
        if (ranked.every((member, index) => member === members[index])) continue;
        groups.push({ places, ranked });
    }
    return groups.length === 0 ? list : orderWith(list, groups);
}

/**
 * The list with every group's members in their ranked order among their places, then, where that put an inserter ahead
 * of a taker of the machine it puts into, with the taker moved ahead of it: of the inserters whose turn has come (every
 * taker of its sink and every earlier member of its group gone), the one with the earliest place.
 */
function orderWith(list: readonly InserterArchetype[], groups: readonly { places: number[]; ranked: InserterArchetype[] }[]): InserterArchetype[] {
    // what the list has the right way round; a loop of machines has some of it the other way, which stays
    const downstream_first: [number, number][] = [];
    list.forEach((taker, before) => {
        const source = taker.inserter_state.inserter.source.entity_id;
        if (source.type !== "machine") return;
        list.forEach((feeder, after) => {
            if (after > before && feeder.inserter_state.inserter.sink.entity_id.id === source.id) {
                downstream_first.push([before, after]);
            }
        });
    });
    const placed = [...list];
    const after: number[][] = placed.map(() => []);
    const waiting_for = placed.map(() => 0);
    for (const group of groups) {
        group.places.forEach((place, index) => { placed[place] = group.ranked[index]; });
    }
    const place_of = new Map(placed.map((it, place) => [it, place] as const));
    const edge = (first: number, then: number) => { after[first].push(then); waiting_for[then]++; };
    for (const [taker, feeder] of downstream_first) {
        edge(place_of.get(list[taker])!, place_of.get(list[feeder])!);
    }
    for (const group of groups) {
        for (let index = 1; index < group.ranked.length; index++) {
            edge(place_of.get(group.ranked[index - 1])!, place_of.get(group.ranked[index])!);
        }
    }
    const done = placed.map(() => false);
    const order: InserterArchetype[] = [];
    while (order.length < placed.length) {
        let next = placed.findIndex((_, place) => !done[place] && waiting_for[place] === 0);
        // the competitors' order against a loop of machines: the earliest place goes
        if (next === -1) next = placed.findIndex((_, place) => !done[place]);
        done[next] = true;
        order.push(placed[next]);
        for (const then of after[next]) waiting_for[then]--;
    }
    return order;
}
