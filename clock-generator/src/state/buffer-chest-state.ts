import { ItemName } from "../data";
import { EntityId, BufferChest } from "../entities";
import { ChestState } from "./chest-state";
import { InventoryState, WritableInventoryState } from "./inventory-state";
import { SupplyGate } from "./supply-gate";

/**
 * State class for buffer chest entities.
 *
 * A buffer chest is a passive inventory container with finite capacity
 * that holds a single item type. It tracks inventory and capacity.
 */
export class BufferChestState implements ChestState {

    public static forChest(chest: BufferChest): BufferChestState {
        const inventoryState = InventoryState.createEmptyForSingleItem(chest.item_filter);
        return new BufferChestState(
            chest.entity_id,
            chest,
            inventoryState,
        );
    }
    public static clone = clone;

    /**
     * Set to refuse its item on a chest the build's output ends in, for a run in which the output is not taken away
     * (see SupplyGate): the chest then has no room, whatever it holds. Nothing is refused in any other run.
     */
    public readonly supply = new SupplyGate();

    constructor(
        public readonly entity_id: EntityId,
        public readonly chest: BufferChest,
        public readonly inventoryState: WritableInventoryState
    ) { }

    /**
     * Get the maximum capacity of this chest in items.
     * Calculated as storage_size (slots) × item_stack_size.
     */
    public getCapacity(): number {
        return this.chest.getCapacity();
    }

    /**
     * Get the current quantity of items in the chest.
     * For buffer chests, itemName is optional since they only hold one item type.
     */
    public getCurrentQuantity(itemName?: ItemName): number {
        const item = itemName ?? this.chest.item_filter;
        return this.inventoryState.getQuantity(item);
    }

    /**
     * Get the available space remaining in the chest.
     */
    public getAvailableSpace(): number {
        return this.supply.refused.size > 0 ? 0 : this.getCapacity() - this.getCurrentQuantity();
    }

    /**
     * Check if the chest is full (no available space).
     */
    public isFull(): boolean {
        return this.getAvailableSpace() <= 0;
    }

    /**
     * Check if the chest is empty.
     */
    public isEmpty(): boolean {
        return this.getCurrentQuantity() <= 0;
    }

    /**
     * Get all item types this chest can hold.
     */
    public getItemFilters(): ItemName[] {
        return this.chest.getItemFilters();
    }

    /**
     * Get the single item filter for this buffer chest.
     * @deprecated Use getItemFilters() for polymorphic access
     */
    public getItemFilter(): ItemName {
        return this.chest.item_filter;
    }

    public toString(): string {
        return `ChestState(${this.entity_id},item=${this.chest.item_filter},qty=${this.getCurrentQuantity()}/${this.getCapacity()})`;
    }
}

function clone(state: BufferChestState): BufferChestState {
    return new BufferChestState(
        state.entity_id,
        state.chest,
        state.inventoryState.clone(),
    );
}
