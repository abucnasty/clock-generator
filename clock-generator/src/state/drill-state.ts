import { EntityId, MiningDrill } from "../entities";
import { HeldStorage } from "../simulation/components/held-storage";
import { Placement } from "../simulation/components/placement";
import { EntityState } from "./entity-state";
import { WritableInventoryState } from "./inventory-state";
import { DrillStatus } from "./entity-status";
import { DrillStatusCode, drillStatusCodeOf, drillStatusOf } from "../simulation/status-codes";

export class DrillState implements EntityState {
    public static fromEntity = fromMiningDrillEntity;

    public readonly entity_id: EntityId;
    /**
     * The drill's status as its ticks go by it, WORKING or DISABLED, by its code: written by its archetype's control rule
     * and read by the drill's key and by its state in the game (`factorioDrillState`)
     */
    public status_code: DrillStatusCode = DrillStatusCode.WORKING;
    /** What it has mined and not yet dropped */
    public readonly held: HeldStorage;
    /** Drops what it holds into its target before it mines, bound to the target by `placeDrillInto` */
    public readonly placement: Placement;

    constructor(public readonly drill: MiningDrill) {
        this.entity_id = drill.entity_id;
        this.held = HeldStorage.forItem(drill.production_rate.item);
        this.placement = new Placement(this.held, [drill.item.name], false);
    }

    /** The status by the name the histories record (a view of the code) */
    public get status(): DrillStatus {
        return drillStatusOf(this.status_code);
    }

    public set status(value: DrillStatus) {
        this.status_code = drillStatusCodeOf(value);
    }

    /** What it holds, as every entity's state shows it: its held Storage's inventory */
    public get inventoryState(): WritableInventoryState {
        return this.held.inventoryState;
    }
}

function fromMiningDrillEntity(drill: MiningDrill): DrillState {
    return new DrillState(drill);
}
