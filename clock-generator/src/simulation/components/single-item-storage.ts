import { ItemName } from "../../data";
import { BufferChest, EntityId } from "../../entities";
import { InventoryState, WritableInventoryState } from "../../state/inventory-state";
import { SupplyGate } from "../../state/supply-gate";
import type { ContainerStorage } from "./container-storage";
import type { DropBy } from "./ports";

/**
 * The Storage of a buffer chest: one item, up to its slots' worth (`BufferChest.getCapacity`). It fills up or runs dry
 * by what is put in and taken out; nothing else changes it.
 */
export class SingleItemStorage implements ContainerStorage {

    public static forChest(chest: BufferChest): SingleItemStorage {
        return new SingleItemStorage(chest.entity_id, chest, InventoryState.createEmptyForSingleItem(chest.item_filter));
    }

    /**
     * Set to refuse its item on a chest the build's output ends in, for a run in which the output is not taken away
     * (see SupplyGate): the chest then has no room, whatever it holds. Nothing is refused in any other run.
     */
    public readonly supply = new SupplyGate();

    constructor(
        public readonly entity_id: EntityId,
        public readonly chest: BufferChest,
        public readonly inventoryState: WritableInventoryState,
    ) { }

    /** Its slots times its item's stack */
    public getCapacity(): number {
        return this.chest.getCapacity();
    }

    /** What it holds of its item; it holds no other */
    public getCurrentQuantity(itemName?: ItemName): number {
        return this.inventoryState.getQuantity(itemName ?? this.chest.item_filter);
    }

    public getAvailableSpace(): number {
        return this.supply.refused.size > 0 ? 0 : this.getCapacity() - this.getCurrentQuantity();
    }

    public isFull(): boolean {
        return this.getAvailableSpace() <= 0;
    }

    public isEmpty(): boolean {
        return this.getCurrentQuantity() <= 0;
    }

    public getItemFilters(): ItemName[] {
        return this.chest.getItemFilters();
    }

    /** As much of what is held as it has room for, from a hand or a placer alike */
    public accepts(item: ItemName, held: number, by: DropBy): number {
        return Math.min(held, Math.max(0, this.getAvailableSpace()));
    }

    public insert(item: ItemName, amount: number): void {
        this.inventoryState.addQuantity(item, amount);
    }

    /** A hand finds room while it is not full, whatever the hand brings */
    public acceptsHand(held: ItemName | null, carried: readonly ItemName[]): boolean {
        return !this.isFull();
    }

    public has(item: ItemName): boolean {
        return this.getCurrentQuantity(item) >= 1;
    }

    public take(item: ItemName, amount: number): void {
        this.inventoryState.removeQuantity(item, amount);
    }

    public toString(): string {
        return `SingleItemStorage(${this.entity_id},item=${this.chest.item_filter},qty=${this.getCurrentQuantity()}/${this.getCapacity()})`;
    }
}
