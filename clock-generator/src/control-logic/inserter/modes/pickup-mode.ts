import { handSizeFor } from "../../../entities";
import assert from "../../../common/assert";
import { ItemName } from "../../../data";
import { BeltState, ChestState, EntityState, InserterState, InserterStatus, MachineState, ReadableEntityStateRegistry } from "../../../state";
import { InserterMode } from "./inserter-mode";
import { TickProvider } from "../../current-tick-provider";

export class InserterPickupMode implements InserterMode {

    public static create(args: {
        inserterState: InserterState,
        sourceState: EntityState,
        sinkState: EntityState,
        /** With it, inserters waiting on the same machine take turns at what it makes */
        tick_provider?: TickProvider,
    }): InserterPickupMode {
        return new InserterPickupMode(
            args.inserterState,
            args.sourceState,
            args.sinkState,
            args.tick_provider,
        );
    }

    public readonly status = InserterStatus.PICKUP;

    private current_tick: number = 0;

    constructor(
        private readonly inserterState: InserterState,
        private readonly sourceEntityState: EntityState,
        private readonly sinkEntityState: EntityState,
        private readonly tick_provider?: TickProvider,
    ) { }

    public onEnter(fromMode: InserterMode): void {
        this.current_tick = 0;
        // a hand that starts right after a swing back lands its first stack on the usual schedule
        this.belt_grab_decided = !(
            (fromMode.status === InserterStatus.IDLE && this.inserterState.waits_for_sink)
            || fromMode.status === InserterStatus.WAITING_FOR_SINK
        );
        this.inserterState.waits_for_sink = false;
    }

    /**
     * As recorded in the game, a belt inserter that waited for its machine spends a tick deciding before the first
     * stack lands in its hand, both when the hand starts after an idle wait and when it goes on after a pause in
     * the middle; the stacks after that come a tick apart. True once that tick has passed.
     */
    private belt_grab_decided: boolean = true;

    public onExit(toMode: InserterMode): void {
        // No action needed on exit
    }

    public executeForTick(): void {
        if (!canPickupFromEntity(this.inserterState, this.sourceEntityState)) {
            this.waitForMachineOutput();
            // cannot pickup, go idle
            this.inserterState.status = InserterStatus.IDLE;
            return;
        }

        this.current_tick += 1;

        const source = this.sourceEntityState;
        if (EntityState.isBelt(source)) {
            this.pickupFromBelt(this.inserterState, source);
        }
        if (EntityState.isMachine(source)) {
            this.pickupFromMachine(this.inserterState, source);
        }
        if (EntityState.isChest(source)) {
            this.pickupFromChest(this.inserterState, source);
        }

        if (this.isHandFull()) {
            return;
        }
    }

    /** Waiting on a machine with nothing to take yet: the other inserters waiting on it take turns with this one */
    private waitForMachineOutput(): void {
        const source = this.sourceEntityState;
        if (!this.tick_provider || !EntityState.isMachine(source)) {
            return;
        }
        const held_item_name = this.inserterState.held_item?.item_name;
        const items = held_item_name !== undefined ? [held_item_name] : Array.from(this.inserterState.inserter.filtered_items);
        for (const item_name of items) {
            if (this.canPickupItemForSink(item_name)) {
                MachineState.waitsForOutput(source, item_name, this.inserterState.inserter.entity_id.id, this.tick_provider.getCurrentTick());
            }
        }
    }

    /** A hand is full at the inserter's hand size for the item it holds */
    private isHandFull(): boolean {
        const held_item = this.inserterState.held_item;
        return held_item !== null && held_item.quantity === handSizeFor(this.inserterState.inserter, held_item.item_name);
    }

    private heldItemQuantity(): number {
        return this.inserterState.held_item?.quantity ?? 0
    }

    private pickupFromBelt(inserter_state: InserterState, source: BeltState): void {

        const sink = this.sinkEntityState;

        if (!EntityState.isMachine(sink)) {
            throw new Error("Inserter sink is not a machine");
        }

        const held_item = inserter_state.held_item

        if (held_item) {
            // As in the game, a hand filling from a belt stops at every grab while the machine cannot take its item
            // (output at the block, or the ingredient at its insertion limit), and goes on once it can again
            if (!this.canPickupItemForSink(held_item.item_name)) {
                return;
            }
            if (!this.belt_grab_decided) {
                this.belt_grab_decided = true;
                return;
            }
            const lane = source.belt.lanes.find(lane => lane.ingredient_name === held_item.item_name);
            assert(lane, `No belt lane found for item ${held_item.item_name}`);
            // Pick up at most lane.stack_size items, but cap at remaining capacity
            const remaining_capacity = handSizeFor(inserter_state.inserter, held_item.item_name) - held_item.quantity;
            const pickup_quantity = Math.min(lane.stack_size, remaining_capacity);
            
            if (pickup_quantity <= 0) {
                return;
            }
            
            held_item.quantity = held_item.quantity + pickup_quantity;
            inserter_state.items_picked_up += pickup_quantity;
            inserter_state.inventoryState.addQuantity(held_item.item_name, pickup_quantity);
            inserter_state.held_item = held_item;
            return;
        }

        for (const item_name of inserter_state.inserter.filtered_items) {
            if (this.canPickupItemForSink(item_name)) {
                if (!this.belt_grab_decided) {
                    this.belt_grab_decided = true;
                    return;
                }
                const lane = source.belt.lanes.find(lane => lane.ingredient_name === item_name);
                assert(lane, `No belt lane found for item ${item_name}`);
                // Pick up at most lane.stack_size items, but cap at inserter stack size
                const pickup_quantity = Math.min(lane.stack_size, handSizeFor(inserter_state.inserter, item_name));
                inserter_state.held_item = { item_name: item_name, quantity: pickup_quantity };
                inserter_state.items_picked_up += pickup_quantity;
                inserter_state.inventoryState.addQuantity(item_name, pickup_quantity);
                return;
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

        state.items_picked_up += pickup_quantity;
        state.held_item = { item_name: held_item.item_name, quantity: held_item.quantity + pickup_quantity };
        state.inventoryState.addQuantity(output_item_name, pickup_quantity);
        source.inventoryState.removeQuantity(output_item_name, pickup_quantity);
    }

    /**
     * Order of filtered items matters for inserter pickups from a chest, at least for the simulation.
     */
    private pickupFromChest(state: InserterState, source: ChestState): void {
        const first_available_item = Array.from(state.inserter.filtered_items).find(it => {
            return source.getCurrentQuantity(it) > 0
                && canPickupItem(state, it)
                && this.canPickupItemForSink(it);
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

        state.items_picked_up += pickup_quantity;
        state.held_item = { item_name: held_item.item_name, quantity: held_item.quantity + pickup_quantity };
        state.inventoryState.addQuantity(first_available_item, pickup_quantity);
        source.inventoryState.removeQuantity(first_available_item, pickup_quantity);
    }

    /** The item in hand, else the first filtered item the machine has and the sink can take */
    private itemToPickupFromMachine(state: InserterState, source: MachineState): ItemName | null {
        if (state.held_item !== null) {
            return state.held_item.item_name;
        }
        const item = Array.from(state.inserter.filtered_items).find(it =>
            source.inventoryState.getQuantity(it) > 0 && this.canPickupItemForSink(it)
        );
        return item ?? null;
    }

    private canPickupItemForSink(item_name: ItemName): boolean {
        const sink = this.sinkEntityState;
        if (!EntityState.isMachine(sink)) {
            return true;
        }
        return !MachineState.machineInputIsBlocked(sink, item_name);
    }

    private hasPickupDurationElapsed(): boolean {
        return this.current_tick >= this.inserterState.inserter.animation.pickup.ticks;
    }
}


function canPickupFromEntity(inserter_state: InserterState, entity_state: EntityState): boolean {

    if (EntityState.isBelt(entity_state)) {
        return true;
    }

    if (EntityState.isMachine(entity_state)) {
        // TODO: this should be configurable, setting to stack size for now
        const output_threshold = 1
        // a hand holds one kind of item, so a hand with something in it can only take more of that
        const held_item_name = inserter_state.held_item?.item_name;
        // any result of the machine, not only its main product: a by-product inserter takes the by-product
        const picks_an_output = entity_state.machine.outputs.some(output =>
            (held_item_name === undefined || held_item_name === output.item_name)
            && entity_state.inventoryState.getQuantity(output.item_name) >= output_threshold
            && canPickupItem(inserter_state, output.item_name)
        );
        if (picks_an_output) {
            return true;
        }
    }

    if (EntityState.isChest(entity_state)) {
        // Check if any item in the chest can be picked up
        const item_filters = entity_state.getItemFilters();
        for (const item_name of item_filters) {
            const available_quantity = entity_state.getCurrentQuantity(item_name);
            if (available_quantity >= 1 && canPickupItem(inserter_state, item_name)) {
                return true;
            }
        }
    }

    return false;
}

function canPickupItem(inserter: InserterState, itemName: ItemName): boolean {
    if (inserter.inserter.filtered_items.size === 0) {
        return true;
    }
    return inserter.inserter.filtered_items.has(itemName);
}