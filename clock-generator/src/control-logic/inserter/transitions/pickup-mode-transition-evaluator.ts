import { handSizeFor } from "../../../entities";
import { fullHandOf } from "../../../entities/traits/hand";
import { EntityState, InserterState } from "../../../state";
import { EnableControl } from "../../enable-control";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterIdleMode, InserterMode } from "../modes";
import { InserterDisabledMode } from "../modes/disabled-mode";
import { InserterSwingMode } from "../modes/swing-mode";
import { InserterWaitForSinkMode } from "../modes/wait-for-sink-mode";

export class PickupModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {

    constructor(
        private readonly inserterState: InserterState,
        private readonly sinkEntityState: EntityState,
        private readonly swing_mode: InserterSwingMode,
        private readonly disabled_mode: InserterDisabledMode,
        private readonly idle_mode: InserterIdleMode,
        private readonly enable_control: EnableControl,
        private readonly wait_for_sink_mode?: InserterWaitForSinkMode,
        private readonly source_state?: EntityState,
    ) {
        // at a machine that places its results itself, an inserter that does not wait for a full hand there (its Hand
        // trait, from the prototype's data: no bulk one) swings what it holds (rule 18)
        this.swings_part_hands = source_state !== undefined && EntityState.isMachine(source_state)
            && source_state.machine.metadata.places_results === true && !fullHandOf(inserterState.inserter.metadata.type).at_placing_source;
    }

    private readonly swings_part_hands: boolean;

    public onEnter(fromMode: InserterMode): void { }

    public onExit(toMode: InserterMode): void { }

    public evaluateTransition(): ModeTransition<InserterMode> {

        const held_item = this.inserterState.held_item;
        if (held_item !== null && held_item.quantity === handSizeFor(this.inserterState.inserter, held_item.item_name)) {
            return ModeTransition.transition(this.swing_mode, `Picked up full stack of ${this.heldItemName()}`);
        }

        if (held_item !== null && this.swings_part_hands) {
            return ModeTransition.transition(this.swing_mode, `Picked up ${held_item.quantity} ${held_item.item_name}, which it swings without waiting for a full hand`);
        }

        if (!this.enable_control.isEnabled()) {
            return ModeTransition.transition(this.disabled_mode, `Inserter disabled while picking up ${this.heldItemName()} (${this.heldItemQuantity()})`);
        }

        // a partly filled hand from a belt waits while the machine takes no more of its item
        if (held_item !== null && this.wait_for_sink_mode && this.source_state && EntityState.isBelt(this.source_state)
            && EntityState.isMachine(this.sinkEntityState) && this.sinkEntityState.ingress.blocked(held_item.item_name)) {
            return ModeTransition.transition(this.wait_for_sink_mode, `machine takes no more ${held_item.item_name} for now, ${held_item.quantity} in hand`);
        }

        return ModeTransition.NONE;
    }

    private heldItemQuantity(): number {
        return this.inserterState.held_item?.quantity ?? 0
    }

    private heldItemName(): string {
        return this.inserterState.held_item?.item_name ?? "nothing"
    }
}