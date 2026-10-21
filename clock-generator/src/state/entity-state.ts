import { EntityId } from "../entities/entity-id";
import { BeltState } from "./belt-state";
import { ChestState } from "./chest-state";
import { BufferChestState } from "./buffer-chest-state";
import { DrillState } from "./drill-state";
import { InfinityChestState } from "./infinity-chest-state";
import { InserterState } from "./inserter-state";
import { WritableInventoryState } from "./inventory-state";
import { MachineState } from "./machine-state";
import { RocketSiloState } from "./rocket-silo-state";
import { SlotContainerState } from "./slot-container-state";

export interface EntityState {
    entity_id: EntityId;
    inventoryState: WritableInventoryState;
}


function isBelt(state: EntityState): state is BeltState {
    return EntityId.isBelt(state.entity_id);
}

function isMachine(state: EntityState): state is MachineState {
    return EntityId.isMachine(state.entity_id);
}

function isInserter(state: EntityState): state is InserterState {
    return EntityId.isInserter(state.entity_id);
}

function isDrill(state: EntityState): state is DrillState {
    return EntityId.isDrill(state.entity_id);
}

function isChest(state: EntityState): state is ChestState {
    return EntityId.isChest(state.entity_id);
}

function isBufferChest(state: EntityState): state is BufferChestState {
    return isChest(state) && state instanceof BufferChestState;
}

function isInfinityChest(state: EntityState): state is InfinityChestState {
    return isChest(state) && state instanceof InfinityChestState
}

function isSlotContainer(state: EntityState): state is SlotContainerState {
    return isChest(state) && state instanceof SlotContainerState;
}

function isRocketSilo(state: EntityState): state is RocketSiloState {
    return isChest(state) && state instanceof RocketSiloState;
}

/** A chest that holds what it holds and has room only for so much: all but the infinity chest */
function isFiniteChest(state: EntityState): state is BufferChestState | SlotContainerState | RocketSiloState {
    return isBufferChest(state) || isSlotContainer(state) || isRocketSilo(state);
}

export function assertIsMachineState(state: EntityState): asserts state is MachineState {
    if (!isMachine(state)) {
        throw new Error(`Expected machine state, got ${state.entity_id.type}`);
    }
}

export function assertIsInserterState(state: EntityState): asserts state is InserterState {
    if (!isInserter(state)) {
        throw new Error(`Expected inserter state, got ${state.entity_id.type}`);
    }
}

export const EntityState = {
    isBelt: isBelt,
    isMachine: isMachine,
    isInserter: isInserter,
    isDrill: isDrill,
    isChest: isChest,
    isBufferChest: isBufferChest,
    isInfinityChest: isInfinityChest,
    isSlotContainer: isSlotContainer,
    isRocketSilo: isRocketSilo,
    isFiniteChest: isFiniteChest,
}