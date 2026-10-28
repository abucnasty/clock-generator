import { OutputBlock } from "../machine/output/output-block";
import { RecipeMetadata } from "../machine/recipe";
import { OverloadMultiplier } from "../machine/traits/overload-multiplier";
import { RecipeSelectionTrait } from "./recipe-selection";

/** When a machine stops taking ingredients for a result, and how much of it it gathers */
export interface OutputBlockResult {
    readonly item: string;
    /** "overload" for the main product of a machine set to its recipe, "stack" for a furnace's and for a by-product */
    readonly rule: "overload" | "stack";
    /** The amount of the result from which the machine takes no more ingredients; may be more than a stack */
    readonly ingredients_blocked_at: number;
    /** The lesser of the block and a stack: the most the machine gathers before it takes no more or cannot craft */
    readonly held_limit: number;
    readonly stack: number;
}

export interface OutputBlockTrait {
    /**
     * The main product's rule, from the recipe selection: the overload multiplier times a craft's amount for a machine set
     * to its recipe (the stack where the recipe has no item ingredients), the stack for one that picks it by input
     */
    readonly rule: "overload" | "stack";
    readonly per_result: readonly OutputBlockResult[];
}

function resultOf(block: OutputBlock, rule: OutputBlockResult["rule"]): OutputBlockResult {
    return {
        item: block.item_name,
        rule,
        ingredients_blocked_at: block.ingredients_blocked_at,
        held_limit: block.held_limit,
        stack: block.max_stack_size,
    };
}

/** The rule of a machine's main product, by how it comes to its recipe: a machine that picks it by input blocks at the stack */
function ruleOf(selection: RecipeSelectionTrait): OutputBlockTrait["rule"] {
    return selection.mode === "by-input" ? "stack" : "overload";
}

/** The output block of a machine's main product by its rule (output-block.ts); the machine (machine.ts) reads it from here */
export function mainOutputBlock(selection: RecipeSelectionTrait, recipe: RecipeMetadata, overload_multiplier: OverloadMultiplier): OutputBlock {
    return ruleOf(selection) === "stack" ? OutputBlock.forFurnace(recipe) : OutputBlock.forMachine(recipe, overload_multiplier);
}

/** A machine's output block, each result as output-block.ts gives it: the main product by the rule, the by-products at their stack */
export function machineOutputBlock(selection: RecipeSelectionTrait, recipe: RecipeMetadata, overload_multiplier: OverloadMultiplier): OutputBlockTrait {
    const rule = ruleOf(selection);
    const main = mainOutputBlock(selection, recipe, overload_multiplier);
    return {
        rule,
        per_result: [
            resultOf(main, rule),
            ...recipe.outputs.slice(1).map(result => resultOf(OutputBlock.forByProduct(result), "stack")),
        ],
    };
}
