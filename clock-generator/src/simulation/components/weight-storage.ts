import { ItemName } from "../../data";
import { EntityId, RocketSiloChest } from "../../entities";
import { RocketSiloInventoryState } from "../../state/rocket-silo-inventory";
import { weightUnits } from "../../state/slot-inventory";
import { SupplyGate } from "../../state/supply-gate";
import type { MixedStorage } from "./container-storage";
import type { DropBy } from "./ports";

/**
 * The Storage of a rocket silo taken as a chest: its input slots and its rocket inventory, filled up to the weight the
 * rocket lifts (see RocketSiloInventoryState). It gives only from its rocket inventory.
 */
export class WeightStorage implements MixedStorage {

    public static forChest(chest: RocketSiloChest): WeightStorage {
        const inventory = new RocketSiloInventoryState({
            toInput: item => chest.toInput(item),
            insertionLimit: item => chest.input_limits.get(item)?.quantity ?? 0,
            lift_weight: weightUnits(chest.prototype.lift_weight),
        });
        for (const content of chest.contents) {
            inventory.placeAtStart(content.item, content.count);
        }
        for (const item of chest.getItemFilters()) {
            inventory.addQuantity(item, 0);
        }
        return new WeightStorage(chest.entity_id, chest, inventory);
    }

    public readonly supply = new SupplyGate();

    constructor(
        public readonly entity_id: EntityId,
        public readonly chest: RocketSiloChest,
        public readonly inventoryState: RocketSiloInventoryState,
    ) { }

    public getCapacity(itemName?: ItemName): number {
        return this.chest.getCapacity(itemName);
    }

    /** What it can give: what its rocket inventory holds */
    public getCurrentQuantity(itemName?: ItemName): number {
        return itemName === undefined ? this.inventoryState.rocket.getTotalQuantity() : this.inventoryState.suppliedQuantity(itemName);
    }

    public getAvailableSpace(itemName?: ItemName): number {
        if (this.supply.refused.size > 0) {
            return 0;
        }
        if (itemName !== undefined) {
            return this.inventoryState.roomFor(itemName);
        }
        const items = this.chest.items_put_in.length > 0 ? this.chest.items_put_in : this.chest.getItemFilters();
        return Math.max(0, ...items.map(item => this.inventoryState.roomFor(item)));
    }

    public isFull(itemName?: ItemName): boolean {
        return this.getAvailableSpace(itemName) <= 0;
    }

    public isEmpty(): boolean {
        return this.inventoryState.rocket.getTotalQuantity() <= 0;
    }

    public getItemFilters(): ItemName[] {
        return this.chest.getItemFilters();
    }

    /** As much of what is held as its input slots or its rocket inventory have room for, from a hand or a placer alike */
    public accepts(item: ItemName, held: number, by: DropBy): number {
        return Math.min(held, Math.max(0, this.getAvailableSpace(item)));
    }

    /** Into its input slots or its rocket inventory, as the item goes */
    public insert(item: ItemName, amount: number): void {
        this.inventoryState.addQuantity(item, amount);
    }

    /** Room for the item in the hand; with an empty hand, for any item the hand carries */
    public acceptsHand(held: ItemName | null, carried: readonly ItemName[]): boolean {
        if (held !== null) {
            return !this.isFull(held);
        }
        for (let index = 0; index < carried.length; index++) {
            if (!this.isFull(carried[index])) {
                return true;
            }
        }
        return false;
    }

    public has(item: ItemName): boolean {
        return this.getCurrentQuantity(item) >= 1;
    }

    public take(item: ItemName, amount: number): void {
        this.inventoryState.removeQuantity(item, amount);
    }

    public nextPickupItem(allowed: (item: ItemName) => boolean): ItemName | null {
        return this.inventoryState.rocket.lastItemAmong(allowed);
    }

    public slotKey(): string {
        return this.inventoryState.slotKey();
    }

    public toString(): string {
        return `WeightStorage(${this.entity_id}, ${JSON.stringify(this.inventoryState.export())})`;
    }
}
