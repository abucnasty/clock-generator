import { ItemName } from "../../../data";
import { EntityState, InserterState, LiveQuantity, MachineState } from "../../../state";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterMode } from "../modes/inserter-mode";
import { InserterPickupMode } from "../modes/pickup/pickup-mode";
import { EnableControl } from "../../enable-control";
import { InserterDisabledMode } from "../modes/disabled-mode";
import { actsInTheTickTheBlockIsLifted } from "../waiting-inserter";
import { ContainerStorage } from "../../../simulation/components/container-storage";
import { HandDropPort } from "../../../simulation/components/hand";

export class IdleModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {

    public static create(args: {
        inserter_state: InserterState,
        source_state: EntityState,
        sink_state: EntityState,
        /** The sink's drop port as the hand reaches it: whether the sink takes anything the hand brings */
        sink_port: HandDropPort,
        pickup_mode: InserterPickupMode,
        disabled_mode: InserterDisabledMode,
        enable_control: EnableControl,
    }): IdleModeTransitionEvaluator {
        return new IdleModeTransitionEvaluator(
            args.inserter_state,
            args.source_state,
            args.sink_state,
            args.sink_port,
            args.pickup_mode,
            args.disabled_mode,
            args.enable_control,
        );
    }

    private constructor(
        private readonly inserter_state: InserterState,
        private readonly source_state: EntityState,
        private readonly sink_state: EntityState,
        private readonly sink_port: HandDropPort,
        private readonly pickup_mode: InserterPickupMode,
        private readonly disabled_mode: InserterDisabledMode,
        private readonly enable_control: EnableControl,
    ) {
        // the items it carries in its order, and a machine source's live stock of each, bound once (the states never
        // change identity)
        this.items = Array.from(inserter_state.inserter.filtered_items);
        this.pickup_stock = EntityState.isMachine(source_state)
            ? this.items.map(item_name => source_state.output.quantityOf(item_name))
            : [];
    }

    public onEnter(fromMode: InserterMode): void {}

    public onExit(toMode: InserterMode): void {}

    /** Whether the inserter found its sink taking nothing it brings when it last looked, and has not acted since */
    private saw_sink_blocked: boolean = false;

    /** Whether a window of a clock of the game opens in this tick: the inserter was disabled the tick before */
    private window_opens: boolean = false;

    /** The items the inserter carries, in its order */
    private readonly items: readonly ItemName[];

    /** Per carried item, what a machine source's output holds of it; empty for any other source */
    private readonly pickup_stock: readonly LiveQuantity[];

    public stateKey(): string {
        return `${this.saw_sink_blocked},${this.window_opens}`;
    }

    public evaluateTransition(): ModeTransition<InserterMode> {

        if (!this.enable_control.isEnabled()) {
            this.inserter_state.waits_for_sink = false;
            this.saw_sink_blocked = false;
            this.window_opens = this.opensWindowNextTick();
            return ModeTransition.transition(this.disabled_mode, "inserter disabled");
        }
        const window_opens = this.window_opens;
        this.window_opens = false;

        if (!this.sinkAcceptsItems()) {
            this.inserter_state.waits_for_sink = true;
            this.saw_sink_blocked = true;
            return ModeTransition.NONE;
        }

        const woken_this_tick = this.wokenThisTick(window_opens);
        this.saw_sink_blocked = false;
        if (woken_this_tick) {
            return ModeTransition.NONE;
        }

        if (EntityState.isMachine(this.source_state)) {
            return this.machinePickupTransition(this.source_state);
        }

        if (EntityState.isBelt(this.source_state)) {
            return ModeTransition.transition(this.pickup_mode, "pickup from belt");
        }

        if (ContainerStorage.is(this.source_state)) {
            return this.chestPickupTransition(this.source_state);
        }
        
        return null;
    }    

    /**
     * True when another inserter took the sink's products down below the output block in this tick and that is what
     * wakes this one: it then takes its first items a tick later (see `actsInTheTickTheBlockIsLifted`, the rule of the
     * game with its recorded cases). An inserter that takes from a belt and waited for the machine lands its first
     * stack a tick later in both cases, which the belt's pickup port has (`HandScratch.belt_grab_decided`, set by
     * `BeltHandPickup.enter`); so for a belt source only the window that opens on the output-blocked machine counts
     * here, which starts from the disabled mode and has no such tick of its own.
     *
     * Inserters are updated before machines, and those that take from a machine before those that put into it. So
     * a machine that was at its block when its last tick was done, and is not now, has had its products taken in
     * this tick.
     *
     * An inserter whose window of a clock of the game opens in this tick shows as enabled in the tick before, and
     * waits in it: when the machine was at its block when that tick was done, the inserter is asleep on it and takes
     * its first items a tick later, whatever the machine did in that tick, as where the inserter that took the
     * products was enabled before (1,158 of 1,170 recorded in Factorio 2.1.21). Where the window of that inserter
     * opened in this tick too, the game updates the two in the reverse of the order their deciders were built, the
     * last built first: the inserter takes its first items in this tick when the taker's decider was built after its
     * own, as it is updated after the take, and a tick later when it was built before (`windowOpeningTakeDecider`,
     * `decider_build_order`). Recorded in Factorio 2.1.21 on windows that open with the taker's on a machine at its
     * block, from a belt and from a machine, onto a belt and into a machine or a chest, in 9,189 of 9,189 over fifteen
     * runs, each clock built in its own order, in reverse and renumbered (PR #268); where the drop target seemed to
     * decide (PR #267) it was the order the generator builds the deciders in. Where either order is not known, a tick
     * later.
     */
    private wokenThisTick(window_opens: boolean): boolean {
        const sink = this.sink_state;
        if (!EntityState.isMachine(sink)) {
            return false;
        }
        const lifted = sink.outputBlockedAfterLastTick && !sink.ingress.outputBlocked();
        if (window_opens) {
            return lifted && !this.updatedAfterTheTake(sink);
        }
        if (EntityState.isBelt(this.source_state)) {
            return false;
        }
        return this.saw_sink_blocked && lifted && !actsInTheTickTheBlockIsLifted(sink);
    }

    /**
     * The game updated this inserter after the inserter that took the sink's products as both their windows opened:
     * the taker's decider was built after this one's
     */
    private updatedAfterTheTake(sink: MachineState): boolean {
        const own = this.enable_control.decider_build_order;
        const taker = sink.windowOpeningTakeDecider;
        return own !== undefined && taker !== null && taker > own;
    }

    /** True in the tick before a window of a clock of the game opens, which the game shows the inserter enabled in */
    private opensWindowNextTick(): boolean {
        const control = this.enable_control;
        return control.is_game_clock === true && control.isEnabledIn !== undefined && control.isEnabledIn(1);
    }

    /**
     * Whether the sink takes anything the inserter brings now: its drop port's answer (a belt takes all; a machine an
     * item it carries that is not blocked; a container by its room, for one of mixed items for the item in the hand or
     * one the inserter carries)
     */
    private sinkAcceptsItems(): boolean {
        return this.sink_port.acceptsHand();
    }

    private machinePickupTransition(source: MachineState): ModeTransition<InserterMode> {
        const pickup_amount_condition = 1;
        const held = this.inserter_state.held_item;

        if (held !== null) {
            const index = this.items.indexOf(held.item_name);
            const quantity = index >= 0 ? this.pickup_stock[index].get() : source.output.getCurrentQuantity(held.item_name);
            return quantity >= pickup_amount_condition
                ? ModeTransition.transition(this.pickup_mode, `machine has ${quantity} of ${held.item_name} to pickup`)
                : ModeTransition.NONE;
        }

        const items = this.items;
        for (let index = 0; index < items.length; index++) {
            const quantity = this.pickup_stock[index].get();
            if (quantity >= pickup_amount_condition) {
                return ModeTransition.transition(this.pickup_mode, `machine has ${quantity} of ${items[index]} to pickup`);
            }
        }
        return ModeTransition.NONE;
    }

    private chestPickupTransition(source: ContainerStorage): ModeTransition<InserterMode> {
        const pickup_amount_condition = 1;

        // Check all item types in the chest
        const items = this.items;
        for (let index = 0; index < items.length; index++) {
            const quantity = source.getCurrentQuantity(items[index]);
            if (quantity >= pickup_amount_condition) {
                return ModeTransition.transition(this.pickup_mode, `chest has ${quantity} of ${items[index]} to pickup`);
            }
        }
        return ModeTransition.NONE;
    }
}