import { EntityId, MiningDrill } from "../entities";
import { HeldStorage } from "../simulation/components/held-storage";
import { EntityState } from "./entity-state";
import { WritableInventoryState } from "./inventory-state";
import { DrillStatus } from "./entity-status";

export class DrillState implements EntityState {
    public static fromEntity = fromMiningDrillEntity;
    public static stateKey = stateKey;

    public readonly entity_id: EntityId;
    public status: DrillStatus = DrillStatus.WORKING;
    /** What it has mined and not yet dropped */
    public readonly held: HeldStorage;

    constructor(public readonly drill: MiningDrill) {
        this.entity_id = drill.entity_id;
        this.held = HeldStorage.forItem(drill.production_rate.item);
    }

    /** What it holds, as every entity's state shows it: its held Storage's inventory */
    public get inventoryState(): WritableInventoryState {
        return this.held.inventoryState;
    }
}

function fromMiningDrillEntity(drill: MiningDrill): DrillState {
    return new DrillState(drill);
}

/** What drives the drill's next ticks besides its inventory (see simulationStateKey) */
function stateKey(state: DrillState): string {
    return state.status;
}
