import { ControlLogic } from "../control-logic";
import { handSizeFor } from "../../entities";
import { EntityState, LiveQuantity, MachineState, ReadableEntityStateRegistry } from "../../state";
import { InserterStateMachine } from "./inserter-state-machine";

/**
 * In what order the inserters that take from one machine are updated in a tick when the rule of turns cannot decide
 * between them (see `MachineState.takesTurnForOutput`): the one built last first ("descending" config ids, the order the
 * game was recorded to serve them in on the thaeln scaffold), the one built first, or an order drawn from a seed, the
 * same for the whole run. The default is "descending".
 */
export type TakerOrder = "descending" | "ascending" | { seed: number };

export const DEFAULT_TAKER_ORDER: TakerOrder = "descending";

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

/**
 * Whether the turn rule leaves the order of the inserters that wait for a machine's product open this tick: when the
 * machine holds at least a hand for the biggest of them, or when nobody has taken from it yet. With less than a hand
 * and a taker before, the rule passes the last taker over, and the update order stays as it is.
 */
export function orderIsOpen(quantity: number, has_taker_history: boolean, biggest_hand: number): boolean {
    return quantity > 0 && (!has_taker_history || quantity >= biggest_hand);
}

/**
 * The inserters of a simulation, updated in the order of the list except where several take from one machine and the
 * order is open (see `orderIsOpen`): those are updated in the order of `order`, among the places they have in the list.
 * Every inserter that takes from a machine stays ahead of the inserters that put into it, as the list has them
 * (`orderInsertersDownstreamFirst`): a taker served late among its competitors does not move an inserter of its own
 * sink's feeders ahead of that sink's takers, which the rule for windows that open together needs (`wokenThisTick`).
 */
export class InserterUpdates implements ControlLogic {
    /** Competing takers whose ranked order differs from their original places in the list. */
    private readonly groups: {
        machine: MachineState; item: string; stock: LiveQuantity; biggest_hand: number; places: number[];
        original: InserterStateMachine[]; ranked: InserterStateMachine[]; open: boolean;
    }[] = [];
    private readonly list: readonly InserterStateMachine[];
    /** Pairs of places in the list: a taker of a machine before an inserter that puts into it */
    private readonly downstream_first: [number, number][] = [];
    /** The update order for each set of open groups, by the bits of their indices */
    private readonly orders = new Map<number, InserterStateMachine[]>();
    private updates: InserterStateMachine[];
    private open_groups = 0;

    constructor(
        inserters: readonly InserterStateMachine[],
        states: ReadableEntityStateRegistry,
        order: TakerOrder = DEFAULT_TAKER_ORDER,
    ) {
        this.list = [...inserters];
        this.updates = [...inserters];
        this.orders.set(0, this.updates);
        const places_by_machine = new Map<string, number[]>();
        inserters.forEach((it, place) => {
            const source = it.inserter_state.inserter.source.entity_id;
            if (source.type === "machine") {
                places_by_machine.set(source.id, [...(places_by_machine.get(source.id) ?? []), place]);
            }
        });
        const draw = typeof order === "object" ? seeded(order.seed) : null;
        for (const places of places_by_machine.values()) {
            const machine = states.getStateByEntityId(inserters[places[0]].inserter_state.inserter.source.entity_id);
            if (places.length < 2 || machine === null || !EntityState.isMachine(machine)) {
                continue;
            }
            const members = places.map(place => inserters[place]);
            const key = new Map(members.map(it => [it, draw === null ? it.inserter_state.entity_id.number : draw()] as const));
            const sign = order === "descending" ? -1 : 1;
            const ranked = [...members].sort((a, b) => sign * (key.get(a)! - key.get(b)!));
            // Draw seeded ranks before skipping: later groups must keep the same seeded order.
            if (ranked.every((member, index) => member === members[index])) continue;
            const item = machine.machine.output.item_name;
            const biggest_hand = Math.max(...places.map(place => handSizeFor(inserters[place].inserter_state.inserter, item)));
            const stock = new LiveQuantity(machine.inventoryState, item);
            this.groups.push({ machine, item, stock, biggest_hand, places, original: members, ranked, open: false });
        }
        if (this.groups.length > 0) {
            // what the list has the right way round; a loop of machines has some of it the other way, which stays
            inserters.forEach((taker, before) => {
                const source = taker.inserter_state.inserter.source.entity_id;
                if (source.type !== "machine") return;
                inserters.forEach((feeder, after) => {
                    if (after > before && feeder.inserter_state.inserter.sink.entity_id.id === source.id) {
                        this.downstream_first.push([before, after]);
                    }
                });
            });
        }
    }

    public executeForTick(): void {
        // Decide every group's order before any inserter can change a machine's stock this tick.
        const groups = this.groups;
        let open_groups = 0;
        for (let at = 0; at < groups.length; at++) {
            const group = groups[at];
            const quantity = group.stock.get();
            group.open = orderIsOpen(quantity,
                quantity > 0 && quantity < group.biggest_hand && group.machine.lastOutputTaker.has(group.item), group.biggest_hand);
            if (group.open) open_groups |= 1 << at;
        }
        if (open_groups !== this.open_groups) {
            this.open_groups = open_groups;
            let updates = this.orders.get(open_groups);
            if (updates === undefined) {
                updates = this.orderWith(open_groups);
                this.orders.set(open_groups, updates);
            }
            this.updates = updates;
        }
        const updates = this.updates;
        for (let index = 0; index < updates.length; index++) {
            updates[index].executeForTick();
        }
    }

    /**
     * The list with every open group's members in their ranked order among their places, then, where that put an
     * inserter ahead of a taker of the machine it puts into, with the taker moved ahead of it: of the inserters whose
     * turn has come (every taker of its sink and every earlier member of its group gone), the one with the earliest place.
     */
    private orderWith(open_groups: number): InserterStateMachine[] {
        const placed = [...this.list];
        const after: number[][] = placed.map(() => []);
        const waiting_for = placed.map(() => 0);
        this.groups.forEach((group, at) => {
            if ((open_groups & (1 << at)) === 0) return;
            group.places.forEach((place, index) => { placed[place] = group.ranked[index]; });
        });
        const place_of = new Map(placed.map((it, place) => [it, place] as const));
        const edge = (first: number, then: number) => { after[first].push(then); waiting_for[then]++; };
        for (const [taker, feeder] of this.downstream_first) {
            edge(place_of.get(this.list[taker])!, place_of.get(this.list[feeder])!);
        }
        this.groups.forEach((group, at) => {
            if ((open_groups & (1 << at)) === 0) return;
            for (let index = 1; index < group.ranked.length; index++) {
                edge(place_of.get(group.ranked[index - 1])!, place_of.get(group.ranked[index])!);
            }
        });
        const done = placed.map(() => false);
        const order: InserterStateMachine[] = [];
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
}
