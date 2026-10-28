import { OutputFullCode } from "../../../simulation/components/yield";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { MachineIngredientShortageMode, MachineMode, MachineOutputFullMode, MachineWorkingMode } from "../modes";

/**
 * A machine out of fuel leaves this mode as soon as fuel arrives: it works when a craft can go on, and otherwise shows
 * what else stops it, a full output or a shortage of ingredients.
 */
export class NoFuelModeTransitionEvaluator implements ModeTransitionEvaluator<MachineMode> {

    constructor(
        private readonly working_mode: MachineWorkingMode,
        private readonly ingredient_shortage_mode: MachineIngredientShortageMode,
        private readonly output_full_mode: MachineOutputFullMode,
    ) {}

    public onEnter(fromMode: MachineMode): void {}

    public onExit(toMode: MachineMode): void {}

    public evaluateTransition(): ModeTransition<MachineMode> {
        if (this.working_mode.isOutOfFuel()) {
            return ModeTransition.NONE;
        }
        if (this.working_mode.hasEnoughInputsForCraft()) {
            return ModeTransition.transition(this.working_mode, "fuel arrived and the machine has enough inputs for craft");
        }
        const output_full = this.working_mode.outputFullCode();
        if (output_full !== OutputFullCode.NONE) {
            return ModeTransition.transition(this.output_full_mode, this.working_mode.outputFullText(output_full));
        }
        return ModeTransition.transition(this.ingredient_shortage_mode, "fuel arrived but not enough inputs for craft");
    }
}
