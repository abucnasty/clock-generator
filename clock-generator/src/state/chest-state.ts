import { ItemName } from "../data";
import { Chest } from "../entities";
import { EntityState } from "./entity-state";
import { WritableInventoryState } from "./inventory-state";

export interface ChestState extends EntityState {
    readonly chest: Chest;
    readonly inventoryState: WritableInventoryState;

    /** The most it holds, of the item for a chest of mixed items */
    getCapacity(itemName?: ItemName): number;
    /** What it can give of the item; without one, of all its items */
    getCurrentQuantity(itemName?: ItemName): number;
    /** The room for the item; without one, the most room for any of its items */
    getAvailableSpace(itemName?: ItemName): number;
    /** No room for the item; without one, for none of the items the build puts into it (or it holds) */
    isFull(itemName?: ItemName): boolean;
    isEmpty(): boolean;
    getItemFilters(): ItemName[];
}

/** A chest of mixed items, whose slots decide what an inserter takes next (a car, a tank, a cargo wagon, a rocket silo) */
export interface MixedChestState extends ChestState {
    /** The item an inserter takes next, of those `allowed` lets through: the last slot's that holds one */
    nextPickupItem(allowed: (item: ItemName) => boolean): ItemName | null;
    /** Where its items are, beyond the totals, for the simulation's state key */
    slotKey(): string;
}
