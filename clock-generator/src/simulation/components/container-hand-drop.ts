import { ItemName } from "../../data";
import type { InserterState } from "../../state/inserter-state";
import type { ContainerStorage } from "./container-storage";
import { CarriedItems, dropFromHand, HandDropPort, HandScratch } from "./hand";
import { DropBy } from "./ports";

/**
 * A Container's drop port, its storage, as one hand reaches it: as many of the held items as it has room for, the rest
 * staying in the hand, which then waits in its target-full phase for room. It never stops a hand filling at its source.
 */
export class ContainerHandDrop implements HandDropPort {

    constructor(
        private readonly state: InserterState,
        private readonly scratch: HandScratch,
        private readonly items: CarriedItems,
        private readonly sink: ContainerStorage,
    ) { }

    public enter(): void {
        this.scratch.drop_ticks = 0;
    }

    public key(): string {
        return String(this.scratch.drop_ticks);
    }

    public drop(): void {
        const state = this.state;
        const held = state.held_item;
        if (held !== null) {
            // as many as the container has room for; none while it is full (a hand never holds 0 items)
            const amount = this.sink.accepts(held.item_name, held.quantity, DropBy.HAND);
            if (amount > 0) {
                this.sink.insert(held.item_name, amount);
                dropFromHand(state, this.scratch, amount);
            }
        }
        this.scratch.drop_ticks += 1;
    }

    /** The container's own answer: by its room, for a container of mixed items by the item in the hand or one it carries */
    public acceptsHand(): boolean {
        const held = this.state.held_item;
        return this.sink.acceptsHand(held === null ? null : held.item_name, this.items.names);
    }

    public takesAt(): boolean {
        return true;
    }

    public takes(): boolean {
        return true;
    }

    /** No room for the item: the hand waits at the container in its target-full phase */
    public fullFor(item: ItemName): boolean {
        return this.sink.isFull(item);
    }
}
