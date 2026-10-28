import { MachineInput } from "../machine/input/machine-input";
import { recipeLoopOf } from "../machine/machine";
import { YieldResult } from "./yield";

/** A machine whose recipe makes its own ingredients (machine.ts); the loop of machines itself is a graph fact */
export interface LoopTrait {
    /** Ingredients the recipe also makes (the pentapod egg): the machine keeps those it is given apart from those it makes */
    readonly self_ingredients: readonly string[];
    /** The ingredients it makes at least as much of as a craft uses: a loop that cannot start from nothing */
    readonly looping_ingredients: readonly string[];
    /** Whether a run seeds it with its looping ingredients, as a player seeds a loop by hand (cold-start.ts, prepare-step.ts) */
    readonly seeded: boolean;
}

/** A machine's loop, from its results as it makes them (the yield) and its ingredients */
export function machineLoop(results: readonly YieldResult[], inputs: readonly MachineInput[]): LoopTrait {
    // by item, the last of a name kept, as MachineInputs keeps them
    const ingredients = new Map(inputs.map(input => [input.item_name, input.ingredient.amount]));
    const loop = recipeLoopOf(results.map(result => ({ item_name: result.item, amount_per_craft: result.expected_per_craft })),
        item => ingredients.get(item));
    return {
        self_ingredients: [...loop.self_ingredients],
        looping_ingredients: [...loop.looping_ingredients],
        seeded: loop.looping_ingredients.size > 0,
    };
}
