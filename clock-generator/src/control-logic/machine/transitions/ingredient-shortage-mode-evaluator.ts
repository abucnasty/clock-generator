import { MachineState } from "../../../state";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { MachineMode, MachineNoFuelMode, MachineOutputFullMode, MachineWorkingMode } from "../modes";

export class IngredientShortageModeTransitionEvaluator implements ModeTransitionEvaluator<MachineMode> {

    constructor(
        private readonly machine_state: MachineState,
        private readonly working_mode: MachineWorkingMode,
        private readonly output_full_mode: MachineOutputFullMode,
        private readonly no_fuel_mode: MachineNoFuelMode,
    ) {}

    public onEnter(fromMode: MachineMode): void {}

    public onExit(toMode: MachineMode): void {}

    public evaluateTransition(): ModeTransition<MachineMode> {
        // a burner with nothing to burn is out of fuel before it is short of ingredients, as in the game
        if (this.working_mode.isOutOfFuel()) {
            return ModeTransition.transition(this.no_fuel_mode, "machine has no fuel to burn");
        }
        if (this.working_mode.hasEnoughInputsForCraft()) {
            return ModeTransition.transition(this.working_mode, 'machine has enough inputs for craft');
        }
        // an idle machine whose output is at its block shows full output, as in the game
        const output_full_reason = this.working_mode.outputFullReason();
        if (output_full_reason !== null) {
            return ModeTransition.transition(this.output_full_mode, output_full_reason);
        }
        return ModeTransition.NONE;
    }
}
