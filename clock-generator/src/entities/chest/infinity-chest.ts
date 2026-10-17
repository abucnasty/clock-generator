import { ChestType } from "../../common/entity-types";
import { InfinityChestConfig, InfinityFilterConfig } from "../../config/schema";
import { ItemName } from "../../data";
import { EntityId } from "../entity-id";
import { Chest } from "./chest";

/**
 * Infinity chest entity.
 * 
 * An infinity chest acts as an infinite source of items. It maintains
 * constant inventory levels regardless of insertions or withdrawals.
 * 
 * Unlike buffer chests, infinity chests:
 * - Have infinite capacity (getCapacity returns Infinity)
 * - Can hold multiple item types via the item_filter array
 * - Never run out of items when withdrawing
 * - Discard items when receiving deposits (inventory stays constant)
 * 
 * This is useful for simulating requester chests or other infinite sources
 * in factory simulations.
 */
export class InfinityChest implements Chest {

    public static fromConfig = fromConfig;

    public readonly chest_type = ChestType.INFINITY_CHEST;

    constructor(
        public readonly entity_id: EntityId,
        /**
         * The item filters defining which items this chest provides
         * and their constant quantities.
         */
        public readonly item_filters: InfinityFilterConfig[],
        public readonly remove_unfiltered_items = false,
    ) {}

    /**
     * Get the maximum capacity of this chest in items.
     * Infinity chests have unlimited capacity.
     */
    public getCapacity(): number {
        return Infinity;
    }

    /**
     * Get items supplied by filters with positive configured stock.
     */
    public getItemFilters(): ItemName[] {
        return this.item_filters.filter(filter => filter.request_count > 0).map(filter => filter.item_name);
    }

    /**
     * Get the configured quantity for a specific item.
     * Returns 0 if the item is not in the filter list.
     */
    public acceptsItem(item: ItemName): boolean {
        return this.remove_unfiltered_items || this.item_filters.some(filter => filter.item_name === item);
    }

    public getItemQuantity(itemName: ItemName): number {
        const filter = this.item_filters.find(f => f.item_name === itemName);
        return filter?.request_count ?? 0;
    }

    public toString(): string {
        const items = this.item_filters.map(f => `${f.item_name}:${f.request_count}`).join(", ");
        return `InfinityChest(${this.entity_id.id}, items=[${items}])`;
    }
}

function fromConfig(config: InfinityChestConfig): InfinityChest {
    return new InfinityChest(
        EntityId.forChest(config.id),
        config.item_filter,
        config.remove_unfiltered_items ?? false,
    );
}
