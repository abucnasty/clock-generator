import assert from "../../../common/assert";
import { ItemName } from "../../../data";
import { Belt, BeltStackSize, Lane } from "../../../entities/belt";
import { BeltDropSpot } from "../../../entities/inserter";
import { BeltState, ChestState, EntityState, InserterState, InserterStatus, MachineState } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { InserterMode } from "./inserter-mode";

export class InserterDropMode implements InserterMode {
    public readonly status = InserterStatus.DROP_OFF;

    private current_tick: number = 0;

    constructor(
        private readonly inserter_state: InserterState,
        private readonly sink_entity_state: EntityState,
        private readonly tick_provider: TickProvider
    ) {
        const drop = inserter_state.inserter.drop;
        if (drop !== undefined && EntityState.isBelt(sink_entity_state)) {
            sink_entity_state.lane_traffic[drop.lane - 1].registerSpot(this.spotTicks(sink_entity_state, drop));
        }
    }

    public onEnter(fromMode: InserterMode): void {
        this.current_tick = 0;
    }

    public onExit(toMode: InserterMode): void { }

    public stateKey(): string {
        return String(this.current_tick);
    }

    public executeForTick(): void {
        if (EntityState.isBelt(this.sink_entity_state)) {
            // the belt is full of what the hand holds (a run in which the output is not taken away): the hand waits
            // over it, and goes on as a hand that has just arrived once there is room
            const held_item_name = this.inserter_state.held_item?.item_name;
            if (held_item_name !== undefined && this.sink_entity_state.supply.refused.has(held_item_name)) {
                return;
            }
            this.dropOffToBelt(this.sink_entity_state, this.inserter_state);
        }

        if (EntityState.isMachine(this.sink_entity_state)) {
            this.dropOffToMachine(this.inserter_state, this.sink_entity_state);
        }

        if (EntityState.isChest(this.sink_entity_state)) {
            this.dropOffToChest(this.inserter_state, this.sink_entity_state);
        }

        this.current_tick += 1;
    }

    /**
     * Select the lane to use for dropping items.
     * Prefers the lane matching the held item's ingredient_name if found,
     * otherwise returns the lane with the maximum stack_size.
     */
    private selectLaneForDrop(lanes: readonly Lane[], heldItemName: ItemName): Lane {
        // Try to find a lane matching the held item
        const matchingLane = lanes.find(lane => lane.ingredient_name === heldItemName);
        if (matchingLane) {
            return matchingLane;
        }

        // Fallback: return the lane with the maximum stack size
        return lanes.reduce((maxLane, lane) => 
            lane.stack_size > maxLane.stack_size ? lane : maxLane
        );
    }

    private dropOffToBelt(belt_state: BeltState, inserter_state: InserterState): void {
        const held_item = inserter_state.held_item;
        assert(
            held_item !== null, 
            `${inserter_state.entity_id} Held item should not be null when dropping off to belt`
        );

        const belt = belt_state.belt;
        const drop = inserter_state.inserter.drop;
        if (drop !== undefined) {
            this.dropOffToLane(belt_state, drop, inserter_state);
            return;
        }
        const lane = this.selectLaneForDrop(belt.lanes, held_item.item_name);
        const amount_to_drop = Belt.amountToDropAtTick(belt.belt_speed, lane.stack_size as BeltStackSize, this.current_tick);

        if (amount_to_drop > 0) {
            this.removeFromHand(inserter_state, amount_to_drop);
        }
    }

    /**
     * Drop on a lane that carries the stacks of the inserters that drop on it: one stack, in this tick, if the lane has
     * room for it where the stack would pass the spot (LaneTraffic); otherwise the hand tries again in the next tick.
     */
    private dropOffToLane(belt_state: BeltState, drop: BeltDropSpot, inserter_state: InserterState): void {
        const stack_size = belt_state.belt.lanes[drop.lane - 1].stack_size;
        const traffic = belt_state.lane_traffic[drop.lane - 1];
        if (traffic.tryPlace(this.tick_provider.getCurrentTick(), this.spotTicks(belt_state, drop))) {
            this.removeFromHand(inserter_state, stack_size);
        }
    }

    /** Ticks a stack takes to travel from the origin of the belt's positions to the spot */
    private spotTicks(belt_state: BeltState, drop: BeltDropSpot): number {
        return Math.round(Belt.ticksPerTile(belt_state.belt.belt_speed).toDecimal() * drop.position);
    }

    private removeFromHand(inserter_state: InserterState, amount: number): void {
        const held_item = inserter_state.held_item;
        assert(held_item !== null, `${inserter_state.entity_id} Held item should not be null when dropping off`);
        const actual_drop = Math.min(amount, held_item.quantity);
        inserter_state.inventoryState.removeQuantity(held_item.item_name, actual_drop);
        held_item.quantity -= actual_drop;
        inserter_state.items_dropped += actual_drop;

        assert(held_item.quantity >= 0, "Held item quantity went below 0");
        if (held_item.quantity === 0) {
            inserter_state.held_item = null;
        }
    }

    private dropOffToMachine(inserter_state: InserterState, sink: MachineState): void {
        // dropping to a machine should take 1 tick
        const held_item = inserter_state.held_item;
        assert(
            held_item !== null,
            `${inserter_state.entity_id} Held item should not be null when dropping off to machine`
        );
        MachineState.insertItem(sink, held_item.item_name, held_item.quantity);
        inserter_state.inventoryState.removeQuantity(held_item.item_name, held_item.quantity);
        inserter_state.items_dropped += held_item.quantity;
        inserter_state.held_item = null;
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
        
        // Remove items from inserter inventory and hand
        inserter_state.inventoryState.removeQuantity(held_item.item_name, items_to_drop);
        held_item.quantity -= items_to_drop;
        inserter_state.items_dropped += items_to_drop;

        assert(held_item.quantity >= 0, "Held item quantity went below 0");
        
        // Clear held_item if all items have been dropped
        if (held_item.quantity === 0) {
            inserter_state.held_item = null;
        }
    }
}