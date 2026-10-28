import assert, { AssertionError } from "../../common/assert";
import { ItemName } from "../../data";
import { handSizeFor, Inserter } from "../../entities/inserter/inserter";
import type { InserterStatus } from "../../state/entity-status";
import type { InserterState } from "../../state/inserter-state";

/**
 * What an inserter's hand keeps from one tick of its pickup and its drop to the next: one flat record, written by the
 * hand's ports only. Built with the ports, once per state machine, so a control swap starts a fresh one while the hand,
 * the pickup arm and the lanes are kept (same-tick rule 12).
 */
export class HandScratch {
    /** Ticks of the pickup from a machine or a container that found something to take, since the pickup started */
    public pickup_ticks: number = 0;
    /** Whether the pickup from a machine started in the first tick of a window: entered from the disabled phase */
    public window_opened: boolean = false;
    /** Ticks since the pickup from a machine started, this one included */
    public ticks_in_pickup: number = 0;
    /**
     * As recorded in the game, a belt inserter that waited for its machine to have its products taken spends a tick
     * deciding before the first stack lands in its hand, both when the hand starts after an idle wait and when it goes
     * on after a pause in the middle; the stacks after that come a tick apart. True once that tick has passed.
     */
    public belt_grab_decided: boolean = true;
    /** Ticks of the drop into a machine or a container, since the drop started */
    public drop_ticks: number = 0;
}

/**
 * The items a hand carries (`Inserter.filtered_items`), in the order it tries them, with the hand of each: bound once
 * at build, so that a tick asks by index and both of the hand's ports by the same one
 */
export class CarriedItems {
    public readonly names: readonly ItemName[];
    /** For each item, how many of it a swing carries (handSizeFor) */
    private readonly hand_sizes: readonly number[];

    constructor(private readonly inserter: Inserter) {
        this.names = Array.from(inserter.filtered_items);
        this.hand_sizes = this.names.map(item => handSizeFor(inserter, item));
    }

    /** The index of an item, -1 for one it does not carry */
    public indexOf(item: ItemName): number {
        const names = this.names;
        for (let index = 0; index < names.length; index++) {
            if (names[index] === item) {
                return index;
            }
        }
        return -1;
    }

    /** How many of the item a swing carries */
    public handSizeOf(item: ItemName): number {
        const index = this.indexOf(item);
        return index >= 0 ? this.hand_sizes[index] : handSizeFor(this.inserter, item);
    }

    /** Whether the hand's filter lets it take the item: any item when it carries none by name */
    public lets(item: ItemName): boolean {
        return this.names.length === 0 || this.indexOf(item) >= 0;
    }
}

/**
 * The pickup port of a source as one hand reaches it, bound at build (P4 2.7): the CraftingMachine's output, a
 * Container's storage or a belt's lanes. It keeps nothing of its own between ticks: what the hand keeps is in its
 * HandScratch. The pickup phase calls it.
 */
export interface HandPickupPort {
    /** The pickup phase's enter step, from the phase the hand leaves */
    enter(from: InserterStatus): void;
    /** The pickup phase's step: what the hand takes in this tick */
    pickup(): void;
    /** What the hand's pickup keeps between ticks, for the state key */
    key(): string;
}

/**
 * The drop port of a sink as one hand reaches it, bound at build (P4 2.7): the CraftingMachine's Ingress, a Container's
 * storage or a belt's lane. The drop phase calls it, and the hand's rules ask it what the sink takes, so that no rule
 * asks what kind of entity the sink is.
 */
export interface HandDropPort {
    /** The drop phase's enter step */
    enter(): void;
    /** The drop phase's step (the target-full phase's too): what the hand puts into the sink in this tick */
    drop(): void;
    /** What the hand's drop keeps between ticks, for the state key */
    key(): string;
    /** The idle rule's ask: whether the sink takes anything the hand brings now, the item in it or one it carries */
    acceptsHand(): boolean;
    /** Whether the sink takes more of the carried item at `index` now, as a hand fills: only a machine ever refuses */
    takesAt(index: number): boolean;
    /** The same for an item by its name: the item in the hand */
    takes(item: ItemName): boolean;
}

/**
 * A pickup into the hand: `quantity` more of what it holds, or a new hand of `item`; counted and traced as `item`. A
 * hand that holds items is filled in place.
 */
export function takeIntoHand(state: InserterState, item: ItemName, quantity: number): void {
    const held = state.held_item;
    if (held === null) {
        state.held_item = { item_name: item, quantity };
    } else {
        held.quantity += quantity;
    }
    state.items_picked_up += quantity;
    state.inventoryState.addQuantity(item, quantity);
    state.trace?.record({ type: "pickup", item, quantity });
}

/** Removes only what the hand holds, and clears the hand when its last items are dropped */
export function dropFromHand(state: InserterState, amount: number): void {
    const held = state.held_item;
    if (held === null) {
        throw new AssertionError(`${state.entity_id} Held item should not be null when dropping off`);
    }
    const actual_drop = Math.min(amount, held.quantity);
    if (actual_drop > 0) state.trace?.record({ type: "drop", item: held.item_name, quantity: actual_drop });
    state.inventoryState.removeQuantity(held.item_name, actual_drop);
    held.quantity -= actual_drop;
    state.items_dropped += actual_drop;

    assert(held.quantity >= 0, "Held item quantity went below 0");
    if (held.quantity === 0) {
        state.held_item = null;
    }
}
