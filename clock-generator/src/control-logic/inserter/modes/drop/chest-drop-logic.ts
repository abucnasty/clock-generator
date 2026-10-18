import { ChestState, InserterState } from "../../../../state";
import { InserterTransferLogic } from "../transfer-logic";
import { removeFromHand } from "../transfer-helpers";

export class ChestDropLogic implements InserterTransferLogic {
    private current_tick = 0;

    constructor(
        private readonly inserter_state: InserterState,
        private readonly sink_entity_state: ChestState,
    ) {}

    public onEnter(): void {
        this.current_tick = 0;
    }

    public stateKey(): string {
        return String(this.current_tick);
    }

    public executeForTick(): void {
        this.dropOffToChest(this.inserter_state, this.sink_entity_state);
        this.current_tick += 1;
    }

    /**
     * Drop items to a chest with partial drop support.
     *
     * If the chest has limited space, the inserter will only drop as many items
     * as can fit, leaving the remaining items in its hand. The inserter will
     * then transition to TARGET_FULL mode and wait for space.
     */
    private dropOffToChest(inserter_state: InserterState, sink: ChestState): void {
        const held_item = inserter_state.held_item;

        // If no items in hand, nothing to do
        if (held_item === null) {
            return;
        }

        const available_space = sink.getAvailableSpace();

        // If chest is full, nothing can be dropped this tick
        if (available_space <= 0) {
            return;
        }

        // Calculate how many items we can actually drop
        const items_to_drop = Math.min(held_item.quantity, available_space);

        // Add items to chest inventory
        sink.inventoryState.addQuantity(held_item.item_name, items_to_drop);

        removeFromHand(inserter_state, items_to_drop);
    }
}
