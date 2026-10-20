import { handSizeFor } from "../../../../entities";
import { ItemName } from "../../../../data";
import { EntityState, InserterState, InserterStatus, MachineState } from "../../../../state";
import { TickProvider } from "../../../current-tick-provider";
import { InserterTransferLogic } from "../transfer-logic";
import { canPickupItem, canPickupItemForSink, recordPickup } from "../transfer-helpers";

export class MachinePickupLogic implements InserterTransferLogic {
    private current_tick = 0;
    /** Whether the pickup started in the first tick of a window. */
    private window_opened = false;
    /** Ticks since the pickup started, this one included. */
    private ticks_in_pickup = 0;

    constructor(
        private readonly inserterState: InserterState,
        private readonly sourceEntityState: MachineState,
        private readonly sinkEntityState: EntityState,
        private readonly tick_provider?: TickProvider,
        /** Where the decider of the inserter's clock of the game stands in the order they are built, when known */
        private readonly decider_build_order?: number,
    ) {}

    public onEnter(from_status: InserterStatus): void {
        this.current_tick = 0;
        this.window_opened = from_status === InserterStatus.DISABLED;
        this.ticks_in_pickup = 0;
    }

    public stateKey(): string {
        return String(this.current_tick);
    }

    public executeForTick(): void {
        this.ticks_in_pickup += 1;
        if (!this.canPickupFromMachine()) {
            this.waitForMachineOutput();
            this.inserterState.status = InserterStatus.IDLE;
            return;
        }
        this.current_tick += 1;
        this.pickupFromMachine(this.inserterState, this.sourceEntityState);
    }

    private canPickupFromMachine(): boolean {
        const held_item_name = this.inserterState.held_item?.item_name;
        // Any output, including by-products. A partly filled hand only takes more of its own item.
        return this.sourceEntityState.machine.outputs.some(output =>
            (held_item_name === undefined || held_item_name === output.item_name)
            && this.sourceEntityState.inventoryState.getQuantity(output.item_name) >= 1
            && canPickupItem(this.inserterState, output.item_name)
        );
    }

    /** Waiting on a machine with nothing to take yet: the other inserters waiting on it take turns with this one */
    private waitForMachineOutput(): void {
        const source = this.sourceEntityState;
        if (!this.tick_provider) {
            return;
        }
        const held_item_name = this.inserterState.held_item?.item_name;
        const items = held_item_name !== undefined ? [held_item_name] : Array.from(this.inserterState.inserter.filtered_items);
        for (const item_name of items) {
            if (canPickupItemForSink(this.sinkEntityState, item_name)) {
                MachineState.waitsForOutput(source, item_name, this.inserterState.inserter.entity_id.id, this.tick_provider.getCurrentTick());
            }
        }
    }

    private pickupFromMachine(state: InserterState, source: MachineState): void {
        const output_item_name = this.itemToPickupFromMachine(state, source);
        if (output_item_name === null) {
            return;
        }
        const output_quantity = source.inventoryState.getQuantity(output_item_name);
        const room_in_hand = handSizeFor(state.inserter, output_item_name) - (state.held_item?.quantity ?? 0);
        if (this.tick_provider && !MachineState.takesTurnForOutput(
            source, output_item_name, state.inserter.entity_id.id, this.tick_provider.getCurrentTick(), room_in_hand)) {
            return;
        }

        const held_item = state.held_item ?? { item_name: output_item_name, quantity: 0 }

        const pickup_quantity = Math.min(
            handSizeFor(state.inserter, held_item.item_name) - held_item.quantity,
            output_quantity
        );

        if (pickup_quantity <= 0) {
            return;
        }

        state.held_item = { item_name: held_item.item_name, quantity: held_item.quantity + pickup_quantity };
        recordPickup(this.inserterState, output_item_name, pickup_quantity);
        source.inventoryState.removeQuantity(output_item_name, pickup_quantity);
        if (this.window_opened && this.ticks_in_pickup === 1) {
            source.windowOpeningTakeDecider = Math.max(source.windowOpeningTakeDecider ?? -1, this.decider_build_order ?? -1);
        }
    }

    /** The item in hand, else the first filtered item the machine has and the sink can take */
    private itemToPickupFromMachine(state: InserterState, source: MachineState): ItemName | null {
        if (state.held_item !== null) {
            // as from a belt, a hand stops filling while the machine it puts into takes nothing of its item
            return canPickupItemForSink(this.sinkEntityState, state.held_item.item_name) ? state.held_item.item_name : null;
        }
        const item = Array.from(state.inserter.filtered_items).find(it =>
            source.inventoryState.getQuantity(it) > 0 && canPickupItemForSink(this.sinkEntityState, it)
        );
        return item ?? null;
    }
}
