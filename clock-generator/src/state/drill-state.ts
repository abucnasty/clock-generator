import { EntityId, MiningDrill } from "../entities";
import { HeldStorage } from "../simulation/components/held-storage";
import { Placement } from "../simulation/components/placement";
import { EntityState } from "./entity-state";
import { WritableInventoryState } from "./inventory-state";
import { DrillStatus } from "./entity-status";

export class DrillState implements EntityState {
    public static fromEntity = fromMiningDrillEntity;

    public readonly entity_id: EntityId;
    /**
     * Never written (a known quirk, kept: P4 D14): the game's state of the drill reads it, while the drill's status that
     * its ticks go by is its archetype's (`MiningDrillArchetype.status`), which the drill's key holds
     */
    public status: DrillStatus = DrillStatus.WORKING;
    /** What it has mined and not yet dropped */
    public readonly held: HeldStorage;
    /** Drops what it holds into its target before it mines, bound to the target by `placeDrillInto` */
    public readonly placement: Placement;

    constructor(public readonly drill: MiningDrill) {
        this.entity_id = drill.entity_id;
        this.held = HeldStorage.forItem(drill.production_rate.item);
        this.placement = new Placement(this.held, [drill.item.name], false);
    }

    /** What it holds, as every entity's state shows it: its held Storage's inventory */
    public get inventoryState(): WritableInventoryState {
        return this.held.inventoryState;
    }
}

function fromMiningDrillEntity(drill: MiningDrill): DrillState {
    return new DrillState(drill);
}
