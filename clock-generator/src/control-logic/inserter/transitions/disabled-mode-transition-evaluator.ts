import { InserterStatus } from "../../../state";
import { EnableControl } from "../../enable-control";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterMode } from "../modes/inserter-mode";

export class DisabledModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {
    constructor(
        private readonly enable_control: EnableControl,
        private readonly idle_mode: InserterMode,
        private readonly idle_mode_transition_evaluator: ModeTransitionEvaluator<InserterMode>,
    ) { }

    public onEnter(fromMode: InserterMode): void {}

    public onExit(toMode: InserterMode): void {}

    public evaluateTransition(): ModeTransition<InserterMode> {
        if (!this.enable_control.is_game_clock) {
            return this.enable_control.isEnabled() ? ModeTransition.transition(this.idle_mode, "inserter enabled") : ModeTransition.NONE;
        }
        // on a clock of the game an inserter acts in the first tick it is enabled: what it would do from idle, it
        // does now. The idle evaluator asks the clock.
        const transition = this.idle_mode_transition_evaluator.evaluateTransition();
        if (transition === ModeTransition.NONE) {
            return ModeTransition.transition(this.idle_mode, "inserter enabled");
        }
        if (transition.toMode.status === InserterStatus.DISABLED) {
            return ModeTransition.NONE;
        }
        return transition;
    }
}
