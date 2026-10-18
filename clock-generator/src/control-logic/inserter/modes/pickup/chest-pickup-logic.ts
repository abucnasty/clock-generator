import { handSizeFor } from "../../../../entities";
import { ChestState, EntityState, InserterState, InserterStatus } from "../../../../state";
import { InserterTransferLogic } from "../transfer-logic";
import { canPickupItem, canPickupItemForSink, recordPickup } from "../transfer-helpers";

export class ChestPickupLogic implements InserterTransferLogic {
    private current_tick = 0;
    constructor(
        private readonly inserterState: InserterState,
        private readonly sourceEntityState: ChestState,
        private readonly sinkEntityState: EntityState,
    ) {}

    public stateKey(): string {
        return String(this.current_tick);
    }

    public onEnter(): void {
        this.current_tick = 0;
    }

    public executeForTick(): void {
        if (!this.canPickupFromChest()) {
            this.inserterState.status = InserterStatus.IDLE;
            return;
        }
        this.current_tick += 1;
        this.pickupFromChest(this.inserterState, this.sourceEntityState);
    }

    private canPickupFromChest(): boolean {
        return this.sourceEntityState.getItemFilters().some(item_name =>
            this.sourceEntityState.getCurrentQuantity(item_name) >= 1 && canPickupItem(this.inserterState, item_name)
        );
    }

    /**
     * Order of filtered items matters for inserter pickups from a chest, at least for the simulation.
     */
    private pickupFromChest(state: InserterState, source: ChestState): void {
        const first_available_item = Array.from(state.inserter.filtered_items).find(it => {
            return source.getCurrentQuantity(it) > 0
                && canPickupItem(this.inserterState, it)
                && canPickupItemForSink(this.sinkEntityState, it);
        })

        if (!first_available_item) {
            return;
        }

        const held_item = state.held_item ?? { item_name: first_available_item, quantity: 0 };

        const pickup_quantity = Math.min(
            handSizeFor(state.inserter, held_item.item_name) - held_item.quantity,
            source.getCurrentQuantity(first_available_item)
        );

        if (pickup_quantity <= 0) {
            return;
        }

        state.held_item = { item_name: held_item.item_name, quantity: held_item.quantity + pickup_quantity };
        recordPickup(this.inserterState, first_available_item, pickup_quantity);
        source.inventoryState.removeQuantity(first_available_item, pickup_quantity);
    }
}
