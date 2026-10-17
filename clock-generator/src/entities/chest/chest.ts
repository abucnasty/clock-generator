import { ChestType } from "../../common/entity-types";
import { ChestConfig } from "../../config";
import { ItemName } from "../../data";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { BufferChest } from "./buffer-chest";
import { InfinityChest } from "./infinity-chest";

/**
 * Chest entity interface.
 * 
 * A chest is considered just a blob that can hold inventory.
 */
export interface Chest extends Entity {
    readonly entity_id: EntityId;
    readonly chest_type: ChestType;

    /**
     * Get the maximum capacity of this chest in items.
     */
    getCapacity(): number;

    /**
     * Get the item types this chest can supply. Destination acceptance is separate.
     */
    getItemFilters(): ItemName[];

    /** Destination acceptance is independent of the items supplied by a chest. */
    acceptsItem(item: ItemName): boolean;
}

function createChestFromConfig(config: ChestConfig): Chest {
    // Handle discriminated union - route based on type
    switch(config.type) {
        case ChestType.BUFFER_CHEST:
            return BufferChest.fromConfig(config);
        case ChestType.INFINITY_CHEST:
            return InfinityChest.fromConfig(config);
    }
}

function isBufferChest(chest: Chest): chest is BufferChest {
    return chest.chest_type === ChestType.BUFFER_CHEST;
}

function isInfinityChest(chest: Chest): chest is InfinityChest {
    return chest.chest_type === ChestType.INFINITY_CHEST;
}

export const Chest = {
    isBufferChest,
    isInfinityChest,
    fromConfig: createChestFromConfig
};