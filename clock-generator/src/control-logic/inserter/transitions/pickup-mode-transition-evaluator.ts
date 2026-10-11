import { handSizeFor } from "../../../entities";
import { EntityState, InserterState, MachineState } from "../../../state";
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
    ) { }

    public onEnter(fromMode: InserterMode): void { }

    public onExit(toMode: InserterMode): void { }

    public evaluateTransition(): ModeTransition<InserterMode> {

        const held_item = this.inserterState.held_item;
        if (held_item !== null && held_item.quantity === handSizeFor(this.inserterState.inserter, held_item.item_name)) {
            return ModeTransition.transition(this.swing_mode, `Picked up full stack of ${this.heldItemName()}`);
        }

        if (!this.enable_control.isEnabled()) {
            return ModeTransition.transition(this.disabled_mode, `Inserter disabled while picking up ${this.heldItemName()} (${this.heldItemQuantity()})`);
        }

        // a partly filled hand from a belt waits while the machine takes no more of its item
        if (held_item !== null && this.wait_for_sink_mode && this.source_state && EntityState.isBelt(this.source_state)
            && EntityState.isMachine(this.sinkEntityState) && MachineState.machineInputIsBlocked(this.sinkEntityState, held_item.item_name)) {
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