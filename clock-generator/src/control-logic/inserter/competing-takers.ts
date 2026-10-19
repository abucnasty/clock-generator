import { ControlLogic } from "../control-logic";
import { handSizeFor } from "../../entities";
import { EntityState, MachineState, ReadableEntityStateRegistry } from "../../state";
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
 */
export class InserterUpdates implements ControlLogic {
    /** The inserters that take from one machine, with the places they have in the list, for every machine with more than one */
    private readonly groups: { machine: MachineState; item: string; biggest_hand: number; places: number[]; ranked: InserterStateMachine[] }[] = [];

    constructor(
        private readonly inserters: readonly InserterStateMachine[],
        states: ReadableEntityStateRegistry,
        order: TakerOrder = DEFAULT_TAKER_ORDER,
    ) {
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
            const item = machine.machine.output.item_name;
            const biggest_hand = Math.max(...places.map(place => handSizeFor(inserters[place].inserter_state.inserter, item)));
            this.groups.push({ machine, item, biggest_hand, places, ranked: [...members].sort((a, b) => sign * (key.get(a)! - key.get(b)!)) });
        }
    }

    public executeForTick(): void {
        let updates = this.inserters;
        for (const { machine, item, biggest_hand, places, ranked } of this.groups) {
            if (!orderIsOpen(machine.inventoryState.getQuantity(item), machine.lastOutputTaker.get(item) !== undefined, biggest_hand)) {
                continue;
            }
            if (updates === this.inserters) {
                updates = [...this.inserters];
            }
            const reordered = updates as InserterStateMachine[];
            places.forEach((place, index) => { reordered[place] = ranked[index]; });
        }
        for (const inserter of updates) {
            inserter.executeForTick();
        }
    }
}
