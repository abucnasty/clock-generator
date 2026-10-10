import { Belt } from "../entities"
import { BeltInventoryState } from "./belt-inventory-state"
import { EntityState } from "./entity-state"
import { SupplyGate } from "./supply-gate"

export interface BeltState extends EntityState {
    belt: Belt
    inventoryState: BeltInventoryState
    /** Items the belt does not give or take for now; nothing, unless a run cuts a supply (see SupplyGate) */
    supply: SupplyGate
}


function fromBelt(belt: Belt): BeltState {
    return {
        entity_id: belt.entity_id,
        belt: belt,
        inventoryState: BeltInventoryState.fromBelt(belt),
        supply: new SupplyGate(),
    }
}

export const BeltState = {
    create: fromBelt,
}