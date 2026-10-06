import { handSizeFor } from "../../../entities";
import { EntityState, InserterState } from "../../../state";
import { EnableControl } from "../../enable-control";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterIdleMode, InserterMode } from "../modes";
import { InserterDisabledMode } from "../modes/disabled-mode";
import { InserterSwingMode } from "../modes/swing-mode";

export class PickupModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {

    constructor(
        private readonly inserterState: InserterState,
        private readonly sinkEntityState: EntityState,
        private readonly swing_mode: InserterSwingMode,
        private readonly disabled_mode: InserterDisabledMode,
        private readonly idle_mode: InserterIdleMode,
        private readonly enable_control: EnableControl,
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

        return ModeTransition.NONE;
    }

    private heldItemQuantity(): number {
        return this.inserterState.held_item?.quantity ?? 0
    }

    private heldItemName(): string {
        return this.inserterState.held_item?.item_name ?? "nothing"
    }
}