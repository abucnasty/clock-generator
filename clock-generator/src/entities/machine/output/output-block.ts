import { EnrichedIngredient, ItemName } from "../../../data";
import { RecipeMetadata } from "../recipe";
import { OverloadMultiplier } from "../traits/overload-multiplier";

export interface OutputBlock {
    readonly item_name: ItemName;
    /**
     * The lesser of the block and a stack: the most of the product the machine gathers before it either takes no more
     * ingredients or has no room for another craft. Not the point where inputs stop: that is `ingredients_blocked_at`.
     */
    readonly held_limit: number;
    readonly max_stack_size: number;
    /**
     * The amount of the product from which the machine takes no more ingredients. For a machine with a recipe this is
     * the overload multiplier times the amount a craft makes, also where that is more than a stack: such a machine
     * stops crafting when its stack is full, and goes on taking ingredients up to their insertion limits. Recorded in
     * Factorio 2.1.21 on three builds: a cryogenic plant that makes plastic (multiplier 73, 2 a craft, block 146)
     * takes coal while it holds a full stack of 100 plastic bars.
     */
    readonly ingredients_blocked_at: number;
}

/**
 * A machine that picks its recipe by input (a furnace prototype, the recycler too): its output blocks at a full stack.
 * The OutputBlock trait (entities/traits/output-block.ts) picks this rule or forMachine by the machine's RecipeSelection
 * trait, from its prototype's class.
 */
function forFurnace(recipe: RecipeMetadata): OutputBlock {
    return itemStackSize(recipe);
}

/** A machine set to its recipe: overload multiplier times a craft's amount, the stack for a recipe with no item ingredients */
function forMachine(recipe: RecipeMetadata, overloadMultiplier: OverloadMultiplier): OutputBlock {
    const stack_size = recipe.output.item.stack_size
    const overload_quantity = overloadMultiplier.overload_multiplier * recipe.output.amount
    if (recipe.inputsPerCraft.size === 0) {
        // no output block condition since no item inputs
        return itemStackSize(recipe);
    }
    return {
        item_name: recipe.output.name,
        held_limit: Math.min(stack_size, overload_quantity),
        max_stack_size: stack_size,
        ingredients_blocked_at: overload_quantity,
    };
}

function itemStackSize(recipe: RecipeMetadata): OutputBlock {
    const stack_size = recipe.output.item.stack_size
    return {
        item_name: recipe.output.name,
        held_limit: stack_size,
        max_stack_size: stack_size,
        ingredients_blocked_at: stack_size,
    };
}

/** A by-product only blocks the machine once its stack is full. */
function forByProduct(output: EnrichedIngredient): OutputBlock {
    const stack_size = output.item.stack_size;
    return {
        item_name: output.name,
        held_limit: stack_size,
        max_stack_size: stack_size,
        ingredients_blocked_at: stack_size,
    };
}

export const OutputBlock = {
    forFurnace: forFurnace,
    forMachine: forMachine,
    forByProduct: forByProduct,
};