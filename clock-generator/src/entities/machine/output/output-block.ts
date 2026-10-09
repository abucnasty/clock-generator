import { EnrichedIngredient, ItemName } from "../../../data";
import { MachineType } from "../machine-metadata";
import { RecipeMetadata } from "../recipe";
import { OverloadMultiplier } from "../traits/overload-multiplier";

export interface OutputBlock {
    readonly item_name: ItemName;
    readonly quantity: number;
    readonly max_stack_size: number;
}


function fromRecipe(machine_type: MachineType, recipe: RecipeMetadata, overloadMultiplier: OverloadMultiplier): OutputBlock {
    if (machine_type === MachineType.FURNACE) {
        return forFurnace(recipe);
    }

    if (machine_type === MachineType.MACHINE || machine_type === MachineType.BIOCHAMBER) {
        return forMachine(recipe, overloadMultiplier);
    }

    throw new Error(`Unsupported machine type: ${machine_type}`);
}

function forFurnace(recipe: RecipeMetadata): OutputBlock {
    return itemStackSize(recipe);
}

function forMachine(recipe: RecipeMetadata, overloadMultiplier: OverloadMultiplier): OutputBlock {
    const stack_size = recipe.output.item.stack_size
    const overload_quantity = overloadMultiplier.overload_multiplier * recipe.output.amount
    if (recipe.inputsPerCraft.size === 0) {
        // no output block condition since no item inputs
        return itemStackSize(recipe);
    }
    return {
        item_name: recipe.output.name,
        quantity: Math.min(stack_size, overload_quantity),
        max_stack_size: stack_size,
    };
}

function itemStackSize(recipe: RecipeMetadata): OutputBlock {
    const stack_size = recipe.output.item.stack_size
    return {
        item_name: recipe.output.name,
        quantity: stack_size,
        max_stack_size: stack_size,
    };
}

/** A by-product only blocks the machine once its stack is full. */
function forByProduct(output: EnrichedIngredient): OutputBlock {
    const stack_size = output.item.stack_size;
    return {
        item_name: output.name,
        quantity: stack_size,
        max_stack_size: stack_size,
    };
}

export const OutputBlock = {
    fromRecipe: fromRecipe,
    forByProduct: forByProduct,
};