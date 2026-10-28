import { ItemName } from "../data";
import { Inserter } from "../entities";
import { EntityState } from "./entity-state";
import { InventoryState } from "./inventory-state";
import { InserterStatus } from "./entity-status";
import { BeltPickupArm } from "./belt-pickup-arm";
import { InserterTrace } from "./inserter-trace";

export interface InserterHandContents {
    item_name: ItemName;
    quantity: number;
}

export interface InserterState extends EntityState {
    /**
     * The status as written at the Hand's last change of phase, which the game's status of the inserter and the
     * recordings read. It parts from the Hand's phase where a pickup finds nothing (set idle, the phase stays) and
     * through a control swap (kept, the new Hand starts idle): same-tick rules 11 and 12.
     */
    status: InserterStatus;
    /** Opt-in observer, kept across control replacement. */
    trace?: InserterTrace;
    /** Physical collection reach retained across control replacement, independently of diagnostic history. */
    pickup_arm?: BeltPickupArm;
    inserter: Inserter;
    held_item: InserterHandContents | null;
    /** Items the inserter has picked up so far */
    items_picked_up: number;
    /** Items the inserter has dropped so far */
    items_dropped: number;
    /** Set while the inserter sits idle and enabled because its sink takes nothing it could bring */
    waits_for_sink: boolean;
    /**
     * Whether the game would show it as enabled after this tick. An inserter that is switched off mid-swing finishes
     * the swing and the drop, so its status goes on as SWING and DROP while this is already false.
     */
    enabled: boolean;
}

function createIdleInserterState(inserter: Inserter): InserterState {
    return {
        entity_id: inserter.entity_id,
        inventoryState: InventoryState.empty(),
        inserter,
        status: InserterStatus.IDLE,
        held_item: null,
        items_picked_up: 0,
        items_dropped: 0,
        waits_for_sink: false,
        enabled: true,
    };
}

export const InserterState = {
    createIdle: createIdleInserterState,
};
