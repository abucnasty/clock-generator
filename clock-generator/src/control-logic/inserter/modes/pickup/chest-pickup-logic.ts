import { handSizeFor } from "../../../../entities";
import { EntityState, InserterState, InserterStatus } from "../../../../state";
import { InserterTransferLogic } from "../transfer-logic";
import { canPickupItem, canPickupItemForSink, recordPickup } from "../transfer-helpers";
import { ContainerStorage } from "../../../../simulation/components/container-storage";

export class ChestPickupLogic implements InserterTransferLogic {
    private current_tick = 0;
    constructor(
        private readonly inserterState: InserterState,
        private readonly sourceEntityState: ContainerStorage,
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
            this.sourceEntityState.has(item_name) && canPickupItem(this.inserterState, item_name)
        );
    }

    /**
     * Order of filtered items matters for inserter pickups from a chest, at least for the simulation.
     */
    private pickupFromChest(state: InserterState, source: ContainerStorage): void {
        const takes = (it: string) => source.getCurrentQuantity(it) > 0
            && canPickupItem(this.inserterState, it)
            && canPickupItemForSink(this.sinkEntityState, it);
        // a chest of mixed items gives the item of its last slot that the inserter takes, and to a hand that holds some
        // only more of that item (the game: a hand of 5 iron waited for iron beside a stack of copper); the others leave
        // the order to the inserter's items
        const held = state.held_item;
        const first_available_item = ContainerStorage.isMixed(source)
            ? source.nextPickupItem(it => state.inserter.filtered_items.has(it) && takes(it) && (held === null || held.item_name === it))
            : Array.from(state.inserter.filtered_items).find(takes);

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
        source.take(first_available_item, pickup_quantity);
    }
}
