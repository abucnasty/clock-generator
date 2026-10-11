import { ChestState, EntityState, InserterState, InserterStatus, MachineState } from "../../../state";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterMode } from "../modes/inserter-mode";
import { InserterPickupMode } from "../modes/pickup-mode";
import { EnableControl } from "../../enable-control";
import { InserterDisabledMode } from "../modes/disabled-mode";
import { TickProvider } from "../../current-tick-provider";
import { handSizeFor } from "../../../entities";
import { actsInTheTickTheBlockIsLifted } from "../waiting-inserter";

export class IdleModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {

    public static create(args: {
        inserter_state: InserterState,
        source_state: EntityState,
        sink_state: EntityState,
        pickup_mode: InserterPickupMode,
        disabled_mode: InserterDisabledMode,
        tick_provider: TickProvider,
        enable_control: EnableControl,
    }): IdleModeTransitionEvaluator {
        return new IdleModeTransitionEvaluator(
            args.inserter_state,
            args.source_state,
            args.sink_state,
            args.pickup_mode,
            args.disabled_mode,
            args.tick_provider,
            args.enable_control,
        );
    }

    private constructor(
        private readonly inserter_state: InserterState,
        private readonly source_state: EntityState,
        private readonly sink_state: EntityState,
        private readonly pickup_mode: InserterPickupMode,
        private readonly disabled_mode: InserterDisabledMode,
        private readonly tick_provider: TickProvider,
        private readonly enable_control: EnableControl,
    ) {}

    public onEnter(fromMode: InserterMode): void {}

    public onExit(toMode: InserterMode): void {}

    /** Whether the inserter found its sink taking nothing it brings when it last looked, and has not acted since */
    private saw_sink_blocked: boolean = false;

    public evaluateTransition(): ModeTransition<InserterMode> {

        if (!this.enable_control.isEnabled()) {
            this.inserter_state.waits_for_sink = false;
            this.saw_sink_blocked = false;
            return ModeTransition.transition(this.disabled_mode, "inserter disabled");
        }

        if (!this.sinkAcceptsItems()) {
            this.inserter_state.waits_for_sink = true;
            this.saw_sink_blocked = true;
            return ModeTransition.NONE;
        }

        const woken_this_tick = this.saw_sink_blocked && this.outputBlockWasLiftedThisTick();
        this.saw_sink_blocked = false;
        if (woken_this_tick) {
            return ModeTransition.NONE;
        }

        if (EntityState.isMachine(this.source_state)) {
            return this.machinePickupTransition(this.inserter_state, this.source_state);
        }

        if (EntityState.isBelt(this.source_state)) {
            return ModeTransition.transition(this.pickup_mode, "pickup from belt");
        }

        if (EntityState.isChest(this.source_state)) {
            return this.chestPickupTransition(this.inserter_state, this.source_state);
        }
        
        return null;
    }    

    /**
     * True when another inserter took the sink's products down below the output block in this tick and that is what
     * wakes this one: it then takes its first items a tick later (see `actsInTheTickTheBlockIsLifted`, the rule of the
     * game with its recorded cases). An inserter that takes from a belt lands its first stack a tick later in both
     * cases, which the pickup mode has (belt_grab_decided).
     *
     * Inserters are updated before machines, and those that take from a machine before those that put into it. So
     * a machine that was at its block when its last tick was done, and is not now, has had its products taken in
     * this tick.
     */
    private outputBlockWasLiftedThisTick(): boolean {
        const sink = this.sink_state;
        if (!EntityState.isMachine(sink) || EntityState.isBelt(this.source_state)) {
            return false;
        }
        return sink.outputBlockedAfterLastTick && !MachineState.machineIsOutputBlocked(sink) && !actsInTheTickTheBlockIsLifted(sink);
    }

    private sinkAcceptsItems(): boolean {
        if (EntityState.isBelt(this.sink_state)) {
            return true;
        }

        if (EntityState.isMachine(this.sink_state)) {
            for (const item_name of this.inserter_state.inserter.filtered_items) {
                if(!MachineState.machineInputIsBlocked(this.sink_state, item_name)) {
                    return true
                }
            }
        }

        if (EntityState.isChest(this.sink_state)) {
            // Chest accepts items if it has available space
            return !this.sink_state.isFull();
        }

        return false;
    }

    private machinePickupTransition(state: InserterState, source: MachineState): ModeTransition<InserterMode> {
        const pickup_amount_condition = 1;

        let items: Iterable<string> = state.inserter.filtered_items;

        if (state.held_item !== null) {
            items = [state.held_item.item_name];
        }

        const inserter_id = state.inserter.entity_id.id;
        const current_tick = this.tick_provider.getCurrentTick();
        for (const item_name of items) {
            const quantity = source.inventoryState.getQuantity(item_name);
            // asked even when there is nothing to take, so the inserters waiting on a machine know of each other
            const room_in_hand = handSizeFor(state.inserter, item_name) - (state.held_item?.quantity ?? 0);
            const its_turn = MachineState.takesTurnForOutput(source, item_name, inserter_id, current_tick, room_in_hand);
            if (quantity >= pickup_amount_condition && its_turn) {
                return ModeTransition.transition(this.pickup_mode, `machine has ${quantity} of ${item_name} to pickup`);
            }
        }
        return ModeTransition.NONE;
    }

    private chestPickupTransition(state: InserterState, source: ChestState): ModeTransition<InserterMode> {
        const pickup_amount_condition = 1;
        
        // Check all item types in the chest
        for (const item_name of state.inserter.filtered_items) {
            const quantity = source.getCurrentQuantity(item_name);
            if (quantity >= pickup_amount_condition) {
                return ModeTransition.transition(this.pickup_mode, `chest has ${quantity} of ${item_name} to pickup`);
            }
        }
        return ModeTransition.NONE;
    }
}