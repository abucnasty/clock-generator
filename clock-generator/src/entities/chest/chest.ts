import { ChestType } from "../../common/entity-types";
import { ChestConfig } from "../../config";
import { ItemName } from "../../data";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { BufferChest } from "./buffer-chest";
import { InfinityChest } from "./infinity-chest";
import { RocketSiloChest } from "./rocket-silo-chest";
import { SlotContainer } from "./slot-container";

/**
 * Chest entity interface.
 * 
 * A chest is considered just a blob that can hold inventory.
 */
export interface Chest extends Entity {
    readonly entity_id: EntityId;
    readonly chest_type: ChestType;

    /**
     * Get the maximum capacity of this chest in items: of the item, for a chest that holds several
     */
    getCapacity(item?: ItemName): number;

    /**
     * Get the item types this chest can supply. Destination acceptance is separate.
     */
    getItemFilters(): ItemName[];

    /** Destination acceptance is independent of the items supplied by a chest. */
    acceptsItem(item: ItemName): boolean;
}

/**
 * The chest of a config. `items_put_in` are the items the build's inserters put into it, which a chest of mixed items
 * can then give.
 */
function createChestFromConfig(config: ChestConfig, items_put_in: readonly ItemName[] = []): Chest {
    // Handle discriminated union - route based on type
    switch(config.type) {
        case ChestType.BUFFER_CHEST:
            return BufferChest.fromConfig(config);
        case ChestType.INFINITY_CHEST:
            return InfinityChest.fromConfig(config);
        case ChestType.CAR:
        case ChestType.TANK:
        case ChestType.CARGO_WAGON:
            return SlotContainer.fromConfig(config, items_put_in);
        case ChestType.ROCKET_SILO:
            return RocketSiloChest.fromConfig(config, items_put_in);
    }
}

function isBufferChest(chest: Chest): chest is BufferChest {
    return chest.chest_type === ChestType.BUFFER_CHEST;
}

function isInfinityChest(chest: Chest): chest is InfinityChest {
    return chest.chest_type === ChestType.INFINITY_CHEST;
}

function isSlotContainer(chest: Chest): chest is SlotContainer {
    return chest instanceof SlotContainer;
}

function isRocketSilo(chest: Chest): chest is RocketSiloChest {
    return chest instanceof RocketSiloChest;
}

/** A chest that holds what it holds: all but the infinity chest, whose contents are a constant supply */
function isFinite(chest: Chest): boolean {
    return !isInfinityChest(chest);
}

export const Chest = {
    isBufferChest,
    isInfinityChest,
    isSlotContainer,
    isRocketSilo,
    isFinite,
    fromConfig: createChestFromConfig
};