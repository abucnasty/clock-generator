import { ItemName } from "../../data";
import { InventoryState, WritableInventoryState } from "../../state/inventory-state";
import type { PickupPort } from "./ports";

/**
 * The Storage of a drill: what it has mined and not yet dropped, one item. Mining puts into it, the drop takes from it
 * as far as the target accepts; while it holds anything, the drill mines nothing (R17).
 */
export class HeldStorage implements PickupPort {

    public static forItem(item: ItemName): HeldStorage {
        return new HeldStorage(InventoryState.createEmptyForSingleItem(item));
    }

    constructor(
        public readonly inventoryState: WritableInventoryState,
    ) { }

    /** What it holds of the item, which always has its slot */
    public getCurrentQuantity(item: ItemName): number {
        return this.inventoryState.getQuantity(item);
    }

    /** Whether it holds anything to place: the pickup side the drill's Placement takes the held items through */
    public has(item: ItemName): boolean {
        return this.getCurrentQuantity(item) >= 1;
    }

    public take(item: ItemName, amount: number): void {
        this.inventoryState.removeQuantity(item, amount);
    }

    /** What the drill's bars completed */
    public insert(item: ItemName, amount: number): void {
        this.inventoryState.addQuantity(item, amount);
    }
}
