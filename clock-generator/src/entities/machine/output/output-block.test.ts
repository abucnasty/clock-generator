import { describe, expect, it } from "vitest";
import { Machine } from "../machine";
import { MachineState } from "../../../state/machine-state";

/**
 * The cryogenic plant that makes plastic (1 s, 2 bars a craft, a stack of 100), at the two crafting speeds either side
 * of a block of a full stack. Seen in Factorio 2.1.21: at multiplier 50 the block is 100, a full stack, and the
 * plant takes no coal; at 51 the block is 102 and is never reached: the status says full output, and coal is taken up
 * to its insertion limit.
 */
function plasticPlant(crafting_speed: number): MachineState {
    const machine = Machine.fromConfig({ id: 1, recipe: "plastic-bar", crafting_speed, productivity: 0 });
    const state = MachineState.forMachine(machine);
    state.inventoryState.setQuantity("plastic-bar", 100);
    return state;
}

describe("the cryogenic plant that makes plastic with a full stack of 100 plastic bars", () => {
    // ceil(1.166 / (1 / 42)) + 1 = 50
    it("takes no coal at overload multiplier 50, where the block of 100 is the stack", () => {
        const state = plasticPlant(42);
        expect(state.machine.output.outputBlock.ingredients_blocked_at).toBe(100);
        expect(MachineState.machineIsOutputBlocked(state)).toBe(true);
        expect(MachineState.machineInputIsBlocked(state, "coal")).toBe(true);
    });

    // ceil(1.166 / (1 / 42.5)) + 1 = 51
    it("takes coal up to its insertion limit at overload multiplier 51, where the block of 102 is never reached", () => {
        const state = plasticPlant(42.5);
        expect(state.machine.output.outputBlock.ingredients_blocked_at).toBe(102);
        expect(MachineState.machineIsOutputBlocked(state)).toBe(false);
        expect(MachineState.machineInputIsBlocked(state, "coal")).toBe(false);
        const limit = state.machine.inputs.getOrThrow("coal").automated_insertion_limit.quantity;
        state.inventoryState.setQuantity("coal", limit);
        expect(MachineState.machineInputIsBlocked(state, "coal")).toBe(true);
    });
});
