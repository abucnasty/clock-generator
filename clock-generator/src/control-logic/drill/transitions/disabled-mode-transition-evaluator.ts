import { EnableControl } from "../../enable-control";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { DrillMode } from "../modes/drill-mode";

export class DrillDisabledModeTransitionEvaluator implements ModeTransitionEvaluator<DrillMode> {
    constructor(
        private enable_control: EnableControl,
        private readonly working_mode: DrillMode,
    ) { }

    public onEnter(fromMode: DrillMode): void {}

    public onExit(toMode: DrillMode): void {}

    public evaluateTransition(): ModeTransition<DrillMode> {
        if (this.enable_control.isEnabled()) { 
            return ModeTransition.transition(this.working_mode, "drill enabled");
        }
        return ModeTransition.NONE;
    }
}