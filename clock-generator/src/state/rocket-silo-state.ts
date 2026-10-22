import { ItemName } from "../data";
import { EntityId, RocketSiloChest } from "../entities";
import { MixedChestState } from "./chest-state";
import { RocketSiloInventoryState } from "./rocket-silo-inventory";
import { weightUnits } from "./slot-inventory";
import { SupplyGate } from "./supply-gate";

/** The state of a rocket silo taken as a chest: its input slots and its rocket inventory (see RocketSiloInventoryState) */
export class RocketSiloState implements MixedChestState {

    public static forChest(chest: RocketSiloChest): RocketSiloState {
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
        return new RocketSiloState(chest.entity_id, chest, inventory);
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

    public nextPickupItem(allowed: (item: ItemName) => boolean): ItemName | null {
        return this.inventoryState.rocket.lastItemAmong(allowed);
    }

    public slotKey(): string {
        return this.inventoryState.slotKey();
    }

    public toString(): string {
        return `RocketSiloState(${this.entity_id}, ${JSON.stringify(this.inventoryState.export())})`;
    }
}
