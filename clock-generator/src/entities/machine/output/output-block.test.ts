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
        expect(state.ingress.outputBlocked()).toBe(true);
        expect(state.ingress.blocked("coal")).toBe(true);
    });

    // ceil(1.166 / (1 / 42.5)) + 1 = 51
    it("takes coal up to its insertion limit at overload multiplier 51, where the block of 102 is never reached", () => {
        const state = plasticPlant(42.5);
        expect(state.machine.output.outputBlock.ingredients_blocked_at).toBe(102);
        expect(state.ingress.outputBlocked()).toBe(false);
        expect(state.ingress.blocked("coal")).toBe(false);
        const limit = state.machine.inputs.getOrThrow("coal").automated_insertion_limit.quantity;
        state.inventoryState.setQuantity("coal", limit);
        expect(state.ingress.blocked("coal")).toBe(true);
    });
});

// The rule follows the prototype's class (the RecipeSelection trait): a furnace prototype picks its recipe by what it is
// brought and blocks at the stack; a machine set to its recipe, or one without a prototype, at the overload multiplier
describe("the output block rule of a machine, by its prototype's class", () => {
    const blockOf = (prototype?: string, recipe = "stone-brick") => Machine.fromConfig({ id: 1, recipe, crafting_speed: 10, productivity: 0,
        ...(prototype === undefined ? {} : { prototype }) }).output.outputBlock.ingredients_blocked_at;

    it("is a full stack of 100 bricks for a furnace", () => {
        for (const prototype of ["stone-furnace", "steel-furnace", "electric-furnace"]) {
            expect(blockOf(prototype), prototype).toBe(100);
        }
    });

    // the recycler is a furnace-class prototype: its main result blocks at a stack of 50 iron ore, where the same recipe
    // on a machine set to it would block at the overload multiplier
    it("is a full stack of 50 iron ore for the recycler, the furnace class", () => {
        expect(blockOf("recycler", "iron-ore-recycling")).toBe(50);
        expect(blockOf(undefined, "iron-ore-recycling")).not.toBe(50);
    });

    // 3.2 s at speed 10: ceil(1.166 / (3.2 / 10)) + 1 = 5, one brick a craft
    it("is the overload multiplier times a craft for an assembling machine and a machine without a prototype", () => {
        expect(blockOf("assembling-machine-3")).toBe(5);
        expect(blockOf()).toBe(5);
    });
});
