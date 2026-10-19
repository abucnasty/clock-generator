import { ItemName } from "../data";
import { handSizeFor, Inserter } from "../entities";
import { EntityState } from "./entity-state";
import { InventoryState } from "./inventory-state";
import { InserterStatus } from "./entity-status";
import { BeltPickupArm } from "./belt-pickup-arm";
import { InserterTrace } from "./inserter-trace";


type InserterStatusState = {
    status: InserterStatus;
    tick: number;
}

export interface InserterHandContents {
    item_name: ItemName;
    quantity: number;
}

export const InserterHandContents = {
    clone(contents: InserterHandContents | null): InserterHandContents | null {
        if (contents == null) {
            return null;
        }
        return {
            item_name: contents.item_name,
            quantity: contents.quantity,
        };
    }
}

export interface InserterState extends EntityState, InserterStatusState {
    /** Opt-in observer, kept across control replacement but not copied into an independent state clone. */
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
        tick: 0,
        held_item: null,
        items_picked_up: 0,
        items_dropped: 0,
        waits_for_sink: false,
        enabled: true,
    };
}

function clone(state: InserterState): InserterState {
    return {
        entity_id: state.entity_id,
        inventoryState: state.inventoryState.clone(),
        inserter: state.inserter,
        status: state.status,
        tick: state.tick,
        pickup_arm: state.pickup_arm?.clone(),
        held_item: state.held_item ? { ...state.held_item } : null,
        items_picked_up: state.items_picked_up,
        items_dropped: state.items_dropped,
        waits_for_sink: state.waits_for_sink,
        enabled: state.enabled,
    };
}

/**
 * What drives the inserter's next ticks besides its inventory (see simulationStateKey). The counts of items only grow,
 * and `tick` is never updated, so relative to the current tick it would never repeat either.
 */
function stateKey(state: InserterState, tick: number): string {
    // A new hand initializes its own collection reach. Old reach cannot affect an empty/full hand's future,
    // and retaining it here would delay repeat detection despite identical physical outcomes.
    const held = state.held_item;
    const arm = held && held.quantity < handSizeFor(state.inserter, held.item_name) ? state.pickup_arm?.stateKey(tick) : undefined;
    return [state.status, state.waits_for_sink, state.enabled, JSON.stringify(held), arm].join(";");
}

export const InserterState = {
    createIdle: createIdleInserterState,
    clone: clone,
    stateKey: stateKey,
};
