import { MachineState } from "../../../state";
import { ModeTransitionEvaluator, ModeTransition } from "../../mode";
import { MachineIngredientShortageMode, MachineMode, MachineWorkingMode } from "../modes";

/**
 * Full output is only the status of a machine that cannot craft: it works again as soon as a craft can start,
 * even with its output still at the output block, and waits for ingredients once the output drops under it.
 */
export class OutputFullModeTransitionEvaluator implements ModeTransitionEvaluator<MachineMode> {

    constructor(
        private readonly machine_state: MachineState,
        private readonly working_mode: MachineWorkingMode,
        private readonly ingredient_shortage_mode: MachineIngredientShortageMode,
    ) {}

    public onEnter(fromMode: MachineMode): void {}

    public onExit(toMode: MachineMode): void {}

    public evaluateTransition(): ModeTransition<MachineMode> {
        if (this.working_mode.hasEnoughInputsForCraft()) {
            return ModeTransition.transition(this.working_mode, "machine has enough inputs and room for a craft");
        }

        if (this.working_mode.outputFullReason() === null) {
            const output_item = this.working_mode.output_item;
            const output_block = this.machine_state.machine.output.outputBlock;
            return ModeTransition.transition(this.ingredient_shortage_mode, `output "${output_item.item_name}" ${output_item.quantity} < ${output_block.quantity} and not enough inputs for craft`);
        }
        return ModeTransition.NONE;
    }
}
