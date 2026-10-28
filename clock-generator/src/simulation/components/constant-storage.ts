import { ItemName } from "../../data";
import { EntityId, InfinityChest } from "../../entities";
import { ConstantInventoryState } from "../../state/constant-inventory-state";
import { WritableInventoryState } from "../../state/inventory-state";
import { SupplyGate } from "../../state/supply-gate";
import type { ContainerStorage } from "./container-storage";
import type { DropBy } from "./ports";

/**
 * The Storage of an infinity chest: what it holds stays at the configured quantities (ConstantInventoryState), so it
 * never runs out of what it gives and what is put in is gone. A run that cuts a supply (SupplyGate) withholds an item
 * or makes it take nothing.
 */
export class ConstantStorage implements ContainerStorage {

    public static forChest(chest: InfinityChest): ConstantStorage {
        const items = new Map<ItemName, number>();
        chest.item_filters.forEach(filter => {
            items.set(filter.item_name, filter.request_count);
        });
        return new ConstantStorage(chest.entity_id, chest, ConstantInventoryState.fromMap(items));
    }

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

    /** The configured quantity of the item, none of an item withheld; without one, of all its items */
    public getCurrentQuantity(itemName?: ItemName): number {
        if (itemName) {
            return this.supply.withheld.has(itemName) ? 0 : this.inventoryState.getQuantity(itemName);
        }
        return this.inventoryState.getTotalQuantity();
    }

    /** Endless room, but none while its supply gate refuses an item */
    public getAvailableSpace(): number {
        return this.supply.refused.size > 0 ? 0 : Infinity;
    }

    public isFull(): boolean {
        return this.supply.refused.size > 0;
    }

    /** Empty only when configured with no quantities */
    public isEmpty(): boolean {
        return this.inventoryState.isEmpty();
    }

    public getItemFilters(): ItemName[] {
        return this.chest.getItemFilters();
    }

    /** All that is held, from a hand or a placer alike, while its supply gate refuses nothing */
    public accepts(item: ItemName, held: number, by: DropBy): number {
        return Math.min(held, Math.max(0, this.getAvailableSpace()));
    }

    /** Gone: its quantities stay */
    public insert(item: ItemName, amount: number): void {
        this.inventoryState.addQuantity(item, amount);
    }

    public has(item: ItemName): boolean {
        return this.getCurrentQuantity(item) >= 1;
    }

    /** Nothing changes: its quantities stay */
    public take(item: ItemName, amount: number): void {
        this.inventoryState.removeQuantity(item, amount);
    }

    public toString(): string {
        const items = this.chest.item_filters.map(f => `${f.item_name}:${f.request_count}`).join(", ");
        return `ConstantStorage(${this.entity_id}, items=[${items}])`;
    }
}
