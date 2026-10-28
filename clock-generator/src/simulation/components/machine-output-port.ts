import { ItemName } from "../../data";
import { LiveQuantity, WritableInventoryState } from "../../state/inventory-state";
import type { PickupPort } from "./ports";

/**
 * The pickup side of a machine's output: what a machine that places its results itself takes its results from, and what
 * an inserter's hand takes from (as one hand reaches it: MachineHandPickup). Over the machine's inventory until the
 * machine's Storage moves out of its state.
 */
export class MachineOutputPort implements PickupPort {

    constructor(
        private readonly output: WritableInventoryState,
    ) { }

    public has(item: ItemName): boolean {
        return this.output.getQuantity(item) >= 1;
    }

    public getCurrentQuantity(item: ItemName): number {
        return this.output.getQuantity(item);
    }

    public take(item: ItemName, amount: number): void {
        this.output.removeQuantity(item, amount);
    }

    /** What the output holds of an item, read in a tick without a lookup: for a reader that binds it once at build */
    public quantityOf(item: ItemName): LiveQuantity {
        return new LiveQuantity(this.output, item);
    }
}
