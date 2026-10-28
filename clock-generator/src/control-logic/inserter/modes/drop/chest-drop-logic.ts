import { InserterState } from "../../../../state";
import { InserterTransferLogic } from "../transfer-logic";
import { removeFromHand } from "../transfer-helpers";
import { ContainerStorage } from "../../../../simulation/components/container-storage";
import { DropBy } from "../../../../simulation/components/ports";

export class ChestDropLogic implements InserterTransferLogic {
    private current_tick = 0;

    constructor(
        private readonly inserter_state: InserterState,
        private readonly sink_entity_state: ContainerStorage,
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
     * Drop items to a chest through its drop port, with partial drop support.
     *
     * If the chest has limited space, the inserter will only drop as many items
     * as can fit, leaving the remaining items in its hand. The inserter will
     * then transition to TARGET_FULL mode and wait for space.
     */
    private dropOffToChest(inserter_state: InserterState, sink: ContainerStorage): void {
        const held_item = inserter_state.held_item;

        // If no items in hand, nothing to do
        if (held_item === null) {
            return;
        }

        // As many as the chest has room for; none while it is full (a hand never holds 0 items)
        const items_to_drop = sink.accepts(held_item.item_name, held_item.quantity, DropBy.HAND);
        if (items_to_drop <= 0) {
            return;
        }

        sink.insert(held_item.item_name, items_to_drop);

        removeFromHand(inserter_state, items_to_drop);
    }
}
