import { ItemName } from "../data";
import { EntityId, InfinityChest } from "../entities";
import { ConstantInventoryState } from "./constant-inventory-state";
import { ChestState } from "./chest-state";
import { WritableInventoryState } from "./inventory-state";
import { SupplyGate } from "./supply-gate";

/**
 * State class for infinity chest entities.
 * 
 * An infinity chest maintains constant inventory levels using ConstantInventoryState.
 * Items deposited are effectively discarded (inventory stays constant).
 * Items withdrawn are always available (never runs out).
 * 
 * This is useful for simulating requester chests or infinite sources.
 */
export class InfinityChestState implements ChestState {

    public static forChest = forChest;
    public static clone = clone;

    /** Items the chest does not give or take for now; nothing, unless a run cuts a supply (see SupplyGate) */
    public readonly supply = new SupplyGate();

    constructor(
        public readonly entity_id: EntityId,
        public readonly chest: InfinityChest,
        public readonly inventoryState: WritableInventoryState,
    ) {}

    public getCapacity(): number {
        return Infinity;
    }

    /**
     * Get the current quantity of a specific item in the chest.
     * For infinity chests, this returns the configured constant quantity.
     */
    public getCurrentQuantity(itemName?: ItemName): number {
        if (itemName) {
            return this.supply.withheld.has(itemName) ? 0 : this.inventoryState.getQuantity(itemName);
        }
        // If no item specified, return total quantity across all items
        return this.inventoryState.getTotalQuantity();
    }

    /**
     * Get the available space remaining in the chest.
     * Infinity chests always have infinite space, but for one that takes nothing while its supply gate refuses an item.
     */
    public getAvailableSpace(): number {
        return this.supply.refused.size > 0 ? 0 : Infinity;
    }

    /**
     * Check if the chest is full (no available space).
     * Infinity chests are never full, but for one that takes nothing while its supply gate refuses an item.
     */
    public isFull(): boolean {
        return this.supply.refused.size > 0;
    }

    /**
     * Check if the chest is empty.
     * Infinity chests are never empty (unless configured with zero quantities).
     */
    public isEmpty(): boolean {
        return this.inventoryState.isEmpty();
    }

    /**
     * Get all item types this chest can hold.
     */
    public getItemFilters(): ItemName[] {
        return this.chest.getItemFilters();
    }

    public toString(): string {
        const items = this.chest.item_filters.map(f => `${f.item_name}:${f.request_count}`).join(", ");
        return `InfinityChestState(${this.entity_id}, items=[${items}])`;
    }
}

function forChest(chest: InfinityChest): InfinityChestState {
    // Create constant inventory with configured quantities
    const items = new Map<ItemName, number>();
    chest.item_filters.forEach(filter => {
        items.set(filter.item_name, filter.request_count);
    });
    const inventoryState = ConstantInventoryState.fromMap(items);
    
    return new InfinityChestState(
        chest.entity_id,
        chest,
        inventoryState,
    );
}

function clone(state: InfinityChestState): InfinityChestState {
    return new InfinityChestState(
        state.entity_id,
        state.chest,
        state.inventoryState.clone(),
    );
}
