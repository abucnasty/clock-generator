import assert from "../../../common/assert";
import { ItemName } from "../../../data";
import { EntityState, InserterState, MachineState } from "../../../state";

export function canPickupItem(state: InserterState, item_name: ItemName): boolean {
    const filters = state.inserter.filtered_items;
    return filters.size === 0 || filters.has(item_name);
}

export function canPickupItemForSink(sink: EntityState, item_name: ItemName): boolean {
    return !EntityState.isMachine(sink) || !MachineState.machineInputIsBlocked(sink, item_name);
}

export function recordPickup(state: InserterState, item_name: ItemName, quantity: number): void {
    state.items_picked_up += quantity;
    state.inventoryState.addQuantity(item_name, quantity);
    state.trace?.record({type: "pickup", item: item_name, quantity});
}

/** Remove only what the hand holds, and clear the hand when its last items are dropped. */
export function removeFromHand(state: InserterState, amount: number): void {
    const held_item = state.held_item;
    assert(held_item !== null, `${state.entity_id} Held item should not be null when dropping off`);
    const actual_drop = Math.min(amount, held_item.quantity);
    if (actual_drop > 0) state.trace?.record({type: "drop", item: held_item.item_name, quantity: actual_drop});
    state.inventoryState.removeQuantity(held_item.item_name, actual_drop);
    held_item.quantity -= actual_drop;
    state.items_dropped += actual_drop;

    assert(held_item.quantity >= 0, "Held item quantity went below 0");
    if (held_item.quantity === 0) {
        state.held_item = null;
    }
}
