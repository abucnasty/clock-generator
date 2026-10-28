import { ItemName } from "../../data";
import { WritableInventoryState } from "../../state/inventory-state";
import type { PickupPort } from "./ports";

/**
 * The pickup side of a machine's output: what a machine that places its results itself takes its results from. Over
 * the machine's inventory until the machine's Storage moves out of its state; hands still take by their own logic (R14).
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
}
