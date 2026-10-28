import { ItemName } from "../../data";
import { EntityId, SlotContainer } from "../../entities";
import { SlotInventoryState } from "../../state/slot-inventory";
import { SupplyGate } from "../../state/supply-gate";
import type { MixedStorage } from "./container-storage";
import type { DropBy } from "./ports";

/**
 * The Storage of a car, a tank or a cargo wagon taken as a chest: its slots and what they hold. It fills up or runs dry
 * as a buffer chest does; a container swapped when full (a train that leaves) is not modelled.
 */
export class SlotStorage implements MixedStorage {

    public static forChest(chest: SlotContainer): SlotStorage {
        const inventory = new SlotInventoryState({ slot_filters: chest.slot_filters });
        for (const content of chest.contents) {
            inventory.placeInSlot(content.slot - 1, content.item, content.count);
        }
        for (const item of chest.getItemFilters()) {
            inventory.addQuantity(item, 0);
        }
        return new SlotStorage(chest.entity_id, chest, inventory);
    }

    /** Refuses its items on a chest the build's output ends in, for a run in which the output is not taken away */
    public readonly supply = new SupplyGate();

    constructor(
        public readonly entity_id: EntityId,
        public readonly chest: SlotContainer,
        public readonly inventoryState: SlotInventoryState,
    ) { }

    public getCapacity(itemName?: ItemName): number {
        return this.chest.getCapacity(itemName);
    }

    public getCurrentQuantity(itemName?: ItemName): number {
        return itemName === undefined ? this.inventoryState.getTotalQuantity() : this.inventoryState.getQuantity(itemName);
    }

    public getAvailableSpace(itemName?: ItemName): number {
        if (this.supply.refused.size > 0) {
            return 0;
        }
        if (itemName !== undefined) {
            return this.inventoryState.roomFor(itemName);
        }
        return Math.max(0, ...this.fullnessItems().map(item => this.inventoryState.roomFor(item)));
    }

    public isFull(itemName?: ItemName): boolean {
        return this.getAvailableSpace(itemName) <= 0;
    }

    public isEmpty(): boolean {
        return this.inventoryState.getTotalQuantity() <= 0;
    }

    public getItemFilters(): ItemName[] {
        return this.chest.getItemFilters();
    }

    /** As much of what is held as its slots have room for, from a hand or a placer alike */
    public accepts(item: ItemName, held: number, by: DropBy): number {
        return Math.min(held, Math.max(0, this.getAvailableSpace(item)));
    }

    public insert(item: ItemName, amount: number): void {
        this.inventoryState.addQuantity(item, amount);
    }

    public has(item: ItemName): boolean {
        return this.getCurrentQuantity(item) >= 1;
    }

    public take(item: ItemName, amount: number): void {
        this.inventoryState.removeQuantity(item, amount);
    }

    public nextPickupItem(allowed: (item: ItemName) => boolean): ItemName | null {
        return this.inventoryState.lastItemAmong(allowed);
    }

    public slotKey(): string {
        return this.inventoryState.slotKey();
    }

    /** The items whose room says whether it is full: those the build puts into it, else those it can give */
    private fullnessItems(): readonly ItemName[] {
        return this.chest.items_put_in.length > 0 ? this.chest.items_put_in : this.chest.getItemFilters();
    }

    public toString(): string {
        return `SlotStorage(${this.entity_id}, ${JSON.stringify(this.inventoryState.export())})`;
    }
}
