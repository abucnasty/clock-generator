import { MachineState } from "../../../state";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { MachineIngredientShortageMode, MachineMode, MachineOutputFullMode, MachineWorkingMode } from "../modes";

export class WorkingModeTransitionEvaluator implements ModeTransitionEvaluator<MachineMode> {

    constructor(
        private readonly ingredient_shortage_mode: MachineIngredientShortageMode,
        private readonly output_full_mode: MachineOutputFullMode,
        private readonly working_mode: MachineWorkingMode,
        private readonly machine_state: MachineState,
    ) { }

    public onEnter(fromMode: MachineMode): void { }
    public onExit(toMode: MachineMode): void { }
    public evaluateTransition(): ModeTransition<MachineMode> {
        if (this.working_mode.hasEnoughInputsForCraft()) {
            return ModeTransition.NONE
        }

        const output_item = this.working_mode.output_item;
        const output_block = this.machine_state.machine.output.outputBlock

        const number_of_inputs = this.machine_state.machine.inputs.size;

        // e.g. 99/100 plastic bars with 2 per craft: no room for another craft
        const amount_per_craft = this.machine_state.machine.output.ingredient.amount;
        if (output_item.quantity + amount_per_craft > output_block.max_stack_size) {
            return ModeTransition.transition(this.output_full_mode, `machine cannot fit another craft of ${amount_per_craft} ${output_item.item_name} under max stack size of ${output_block.max_stack_size}`);
        }

        if (!this.working_mode.byProductsHaveSpace()) {
            return ModeTransition.transition(this.output_full_mode, "a by-product has filled its stack");
        }

        if (output_item.quantity >= output_block.quantity) {
            return ModeTransition.transition(this.output_full_mode, `output item "${output_item.item_name}" = ${output_item.quantity} waiting to be removed`);
        }

        return ModeTransition.transition(this.ingredient_shortage_mode, "not enough inputs for craft");
    }
}