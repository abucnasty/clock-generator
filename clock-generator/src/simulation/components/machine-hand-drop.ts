import { AssertionError } from "../../common/assert";
import { ItemName } from "../../data";
import type { InserterState } from "../../state/inserter-state";
import { CarriedItems, dropFromHand, HandDropPort, HandScratch } from "./hand";
import type { Ingress } from "./ingress";
import { DropBy } from "./ports";

/**
 * A crafting machine's drop port, its Ingress, as one hand reaches it: the hand puts in all it holds in one tick, with
 * no limit check (a known quirk, kept until after the refactor: P4 D14), fuel into the fuel slot. The machine refuses
 * an item while its output is at the block or the item at its insertion limit (`Ingress.blockedAt`), by the slot of
 * each item the hand carries, bound at build.
 */
export class MachineHandDrop implements HandDropPort {

    /** Per carried item, in the hand's order, its slot in the machine's Ingress (-1 for an item it never takes) */
    private readonly slots: readonly number[];

    constructor(
        private readonly state: InserterState,
        private readonly scratch: HandScratch,
        private readonly items: CarriedItems,
        private readonly ingress: Ingress,
    ) {
        this.slots = items.names.map(item => ingress.slotOf(item));
    }

    public enter(): void {
        this.scratch.drop_ticks = 0;
    }

    public key(): string {
        return String(this.scratch.drop_ticks);
    }

    /** Dropping into a machine takes one tick */
    public drop(): void {
        const state = this.state;
        const held = state.held_item;
        if (held === null) {
            throw new AssertionError(`${state.entity_id} Held item should not be null when dropping off to machine`);
        }
        // the whole hand, with no limit check (a known quirk, kept): the Ingress takes from a hand all it holds
        const amount = this.ingress.accepts(held.item_name, held.quantity, DropBy.HAND);
        const index = this.items.indexOf(held.item_name);
        this.ingress.insertAt(index >= 0 ? this.slots[index] : this.ingress.slotOf(held.item_name), held.item_name, amount);
        dropFromHand(state, amount);
        this.scratch.drop_ticks += 1;
    }

    /** Whether the machine takes any item the hand carries now */
    public acceptsHand(): boolean {
        const slots = this.slots;
        for (let index = 0; index < slots.length; index++) {
            if (!this.ingress.blockedAt(slots[index])) {
                return true;
            }
        }
        return false;
    }

    public takesAt(index: number): boolean {
        return !this.ingress.blockedAt(this.slots[index]);
    }

    public takes(item: ItemName): boolean {
        const index = this.items.indexOf(item);
        return index >= 0 ? !this.ingress.blockedAt(this.slots[index]) : !this.ingress.blocked(item);
    }
}
