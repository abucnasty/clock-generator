import { EntityId, MiningDrill } from "../entities";
import { EntityState } from "./entity-state";
import { InventoryState, WritableInventoryState } from "./inventory-state";
import { DrillStatus } from "./entity-status";

export interface DrillState extends EntityState {
    drill: MiningDrill
    inventoryState: WritableInventoryState
    status: DrillStatus
}


function fromMiningDrillEntity(drill: MiningDrill): DrillState {
    return {
        entity_id: drill.entity_id,
        status: DrillStatus.WORKING,
        drill: drill,
        inventoryState: InventoryState.createEmptyForSingleItem(drill.production_rate.item),
    }
}

/** What drives the drill's next ticks besides its inventory (see simulationStateKey) */
function stateKey(state: DrillState): string {
    return state.status;
}

export const DrillState = {
    fromEntity: fromMiningDrillEntity,
    stateKey: stateKey,
}