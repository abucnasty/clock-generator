import { ItemName } from "../../data";
import { Chest, EntityId } from "../../entities";
import type { EntityState } from "../../state/entity-state";
import { SupplyGate } from "../../state/supply-gate";
import { ConstantStorage } from "./constant-storage";
import type { DropPort, PickupPort } from "./ports";
import { SingleItemStorage } from "./single-item-storage";
import { SlotStorage } from "./slot-storage";
import { WeightStorage } from "./weight-storage";

/**
 * The Storage of a Container: the one component of a chest, a car, a tank, a cargo wagon, an infinity chest and, in
 * phase 1, a rocket silo. It owns the inventory; a hand drops into it and takes from it through its ports, and a
 * machine or a drill places into it through its drop port. One class per variant: single-item (SingleItemStorage),
 * slots (SlotStorage), weight (WeightStorage), constant (ConstantStorage).
 */
export interface ContainerStorage extends EntityState, DropPort, PickupPort {
    /** The config's container: the Storage's immutable inputs */
    readonly chest: Chest;
    /** What it does not give or take for now (a run that cuts a supply) */
    readonly supply: SupplyGate;

    /** The most it holds, of the item for a chest of mixed items */
    getCapacity(itemName?: ItemName): number;
    /** What it can give of the item; without one, of all its items */
    getCurrentQuantity(itemName?: ItemName): number;
    /** The room for the item; without one, the most room for any of its items */
    getAvailableSpace(itemName?: ItemName): number;
    /** No room for the item; without one, for none of the items the build puts into it (or it holds) */
    isFull(itemName?: ItemName): boolean;
    isEmpty(): boolean;
    getItemFilters(): ItemName[];
}

/** The Storage of a container of mixed items, whose slots decide what an inserter takes next (slots and weight) */
export interface MixedStorage extends ContainerStorage {
    /** The item an inserter takes next, of those `allowed` lets through: the last slot's that holds one */
    nextPickupItem(allowed: (item: ItemName) => boolean): ItemName | null;
    /** Where its items are, beyond the totals, for the simulation's state key */
    slotKey(): string;
}

/** The Storage variant of a container of the config, by its class */
function forChest(chest: Chest): ContainerStorage {
    if (Chest.isInfinityChest(chest)) {
        return ConstantStorage.forChest(chest);
    }
    if (Chest.isBufferChest(chest)) {
        return SingleItemStorage.forChest(chest);
    }
    if (Chest.isSlotContainer(chest)) {
        return SlotStorage.forChest(chest);
    }
    if (Chest.isRocketSilo(chest)) {
        return WeightStorage.forChest(chest);
    }
    throw new Error(`Unsupported chest type: ${(chest as Chest).chest_type}`);
}

/** The Container archetype: a state of the registry that is a container's Storage */
function isContainer(state: EntityState): state is ContainerStorage {
    return EntityId.isChest(state.entity_id);
}

function isSingleItem(state: EntityState): state is SingleItemStorage {
    return isContainer(state) && state instanceof SingleItemStorage;
}

function isSlots(state: EntityState): state is SlotStorage {
    return isContainer(state) && state instanceof SlotStorage;
}

function isWeight(state: EntityState): state is WeightStorage {
    return isContainer(state) && state instanceof WeightStorage;
}

function isConstant(state: EntityState): state is ConstantStorage {
    return isContainer(state) && state instanceof ConstantStorage;
}

/** A container of mixed items: slots or weight */
function isMixed(state: EntityState): state is SlotStorage | WeightStorage {
    return isSlots(state) || isWeight(state);
}

/** A container that holds what it holds and has room only for so much: all but the constant one */
function isFiniteStorage(state: EntityState): state is SingleItemStorage | SlotStorage | WeightStorage {
    return isSingleItem(state) || isSlots(state) || isWeight(state);
}

export const ContainerStorage = {
    forChest,
    is: isContainer,
    isSingleItem,
    isSlots,
    isWeight,
    isConstant,
    isMixed,
    isFinite: isFiniteStorage,
};
