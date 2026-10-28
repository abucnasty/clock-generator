import { InserterState } from "../../../state";
import { HandDropPort } from "../../../simulation/components/hand";
import { EnableControl } from "../../enable-control";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterMode, InserterPickupMode } from "../modes";
import { InserterDisabledMode } from "../modes/disabled-mode";

/** Back to filling the hand once the machine takes its item again; disabled when the window closes meanwhile */
export class WaitForSinkModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {

    constructor(
        private readonly inserter_state: InserterState,
        /** The sink's drop port as the hand reaches it: whether the sink takes the item in the hand again */
        private readonly sink_port: HandDropPort,
        private readonly pickup_mode: InserterPickupMode,
        private readonly disabled_mode: InserterDisabledMode,
        private readonly enable_control: EnableControl,
    ) { }

    public onEnter(fromMode: InserterMode): void { }

    public onExit(toMode: InserterMode): void { }

    public evaluateTransition(): ModeTransition<InserterMode> {
        if (!this.enable_control.isEnabled()) {
            return ModeTransition.transition(this.disabled_mode, "inserter disabled while waiting for the machine to take its hand");
        }
        const held_item = this.inserter_state.held_item;
        if (held_item === null) {
            return ModeTransition.transition(this.pickup_mode, "nothing in hand to wait with");
        }
        if (this.sink_port.takes(held_item.item_name)) {
            return ModeTransition.transition(this.pickup_mode, `machine takes ${held_item.item_name} again`);
        }
        return ModeTransition.NONE;
    }
}
