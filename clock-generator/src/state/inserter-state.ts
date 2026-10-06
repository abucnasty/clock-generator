import { ItemName } from "../data";
import { Inserter } from "../entities";
import { EntityState } from "./entity-state";
import { InventoryState } from "./inventory-state";


export const InserterStatus = {
    IDLE: "IDLE",
    PICKUP: "PICKUP",
    DROP_OFF: "DROP",
    SWING: "SWING",
    DISABLED: "DISABLED",
    /**
     * Inserter is waiting because its sink (chest) is full and it still has items in hand.
     * The inserter will retry dropping until space becomes available.
     */
    TARGET_FULL: "TARGET_FULL"
} as const;

export type InserterStatus = typeof InserterStatus[keyof typeof InserterStatus];

export type InserterStatusState = {
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
    inserter: Inserter;
    held_item: InserterHandContents | null;
    /** Items the inserter has picked up so far */
    items_picked_up: number;
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
    };
}

function clone(state: InserterState): InserterState {
    return {
        entity_id: state.entity_id,
        inventoryState: state.inventoryState.clone(),
        inserter: state.inserter,
        status: state.status,
        tick: state.tick,
        held_item: state.held_item ? { ...state.held_item } : null,
        items_picked_up: state.items_picked_up,
    };
}

export const InserterState = {
    createIdle: createIdleInserterState,
    clone: clone
};