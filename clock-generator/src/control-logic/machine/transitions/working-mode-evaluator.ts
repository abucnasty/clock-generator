import { MachineState } from "../../../state";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { MachineIngredientShortageMode, MachineMode, MachineNoFuelMode, MachineOutputFullMode, MachineWorkingMode } from "../modes";

export class WorkingModeTransitionEvaluator implements ModeTransitionEvaluator<MachineMode> {

    constructor(
        private readonly ingredient_shortage_mode: MachineIngredientShortageMode,
        private readonly output_full_mode: MachineOutputFullMode,
        private readonly working_mode: MachineWorkingMode,
        private readonly machine_state: MachineState,
        private readonly no_fuel_mode: MachineNoFuelMode,
    ) { }

    public onEnter(fromMode: MachineMode): void { }
    public onExit(toMode: MachineMode): void { }
    public evaluateTransition(): ModeTransition<MachineMode> {
        // a burner with nothing to burn is out of fuel before it is short of ingredients or full, as in the game
        if (this.working_mode.isOutOfFuel()) {
            return ModeTransition.transition(this.no_fuel_mode, "machine has no fuel to burn");
        }

        // a machine with its ingredients keeps crafting whatever its output holds, up to the stack size
        if (this.working_mode.hasEnoughInputsForCraft()) {
            return ModeTransition.NONE
        }

        const output_full_reason = this.working_mode.outputFullReason();
        if (output_full_reason !== null) {
            return ModeTransition.transition(this.output_full_mode, output_full_reason);
        }

        return ModeTransition.transition(this.ingredient_shortage_mode, "not enough inputs for craft");
    }
}
