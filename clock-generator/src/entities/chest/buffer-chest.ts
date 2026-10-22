import { ChestType } from "../../common/entity-types";
import { BufferChestConfig } from "../../config/schema";
import { FactorioDataService, ItemName } from "../../data";
import { EntityId } from "../entity-id";
import { Chest } from "./chest";

/**
 * Buffer chest entity.
 * 
 * A buffer chest has finite storage capacity determined by the number of
 * inventory slots and the stack size of the filtered item.
 * 
 * For example, if a chest has 12 slots and we fill it with iron ore which
 * has a stack size of 50, the chest can hold up to 600 iron ore.
 * 
 * The item_filter restricts the chest to holding only a single item type.
 */
export class BufferChest implements Chest {

    public static fromConfig = fromConfig;

    public readonly chest_type = ChestType.BUFFER_CHEST;

    constructor(
        public readonly entity_id: EntityId,
        /**
         * The total number of inventory slots in this chest.
         */
        public readonly storage_size: number,
        /**
         * The single item type this chest is filtered to hold.
         */
        public readonly item_filter: ItemName,
        /**
         * The stack size of the filtered item (cached for capacity calculations).
         */
        public readonly item_stack_size: number,
        /** The chest's prototype name in the game data, for labels only (the config's `prototype`) */
        public readonly prototype?: string,
    ) {}

    /**
     * Get the maximum capacity of this chest in items.
     */
    public getCapacity(): number {
        return this.storage_size * this.item_stack_size;
    }

    /**
     * Get all item types this chest is filtered to hold.
     * Buffer chests only support a single item type.
     */
    public getItemFilters(): ItemName[] {
        return [this.item_filter];
    }

    public acceptsItem(item: ItemName): boolean {
        return item === this.item_filter;
    }

    public toString(): string {
        return `BufferChest(${this.entity_id.id}, item=${this.item_filter}, capacity=${this.getCapacity()})`;
    }
}

function fromConfig(config: BufferChestConfig): BufferChest {
    const item = FactorioDataService.findItemOrThrow(config.item_filter);
    return new BufferChest(
        EntityId.forChest(config.id),
        config.storage_size,
        config.item_filter,
        item.stack_size,
        config.prototype,
    );
}
