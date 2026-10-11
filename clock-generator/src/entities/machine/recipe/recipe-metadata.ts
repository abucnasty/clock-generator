import Fraction, { fraction } from "fractionability";
import assert from "../../../common/assert"
import { Ingredient, ItemName, Recipe, EnrichedIngredient, EnrichedRecipe, FactorioDataService } from "../../../data";
import { MapExtended } from "../../../data-types";

export interface IngredientRatio {
    input: EnrichedIngredient;
    output: EnrichedIngredient;
    fraction: Fraction;
}

export interface RecipeMetadata {
    readonly name: string;
    readonly energy_required: number;
    /** The main product: the result with the largest expected amount per craft */
    readonly output: EnrichedIngredient;
    /** Every item result, with the main product first */
    readonly outputs: readonly EnrichedIngredient[];
    readonly inputToOutputRatios: MapExtended<ItemName, IngredientRatio>;
    readonly outputToInputRatios: MapExtended<ItemName, IngredientRatio>;
    readonly inputsPerCraft: MapExtended<ItemName, EnrichedIngredient>;
    readonly raw: EnrichedRecipe;
}

type ResultExtras = { probability?: number, ignored_by_productivity?: number };

/** The amount a result yields per craft on average, before productivity */
export function expectedAmount(result: Ingredient): number {
    return result.amount * ((result as Ingredient & ResultExtras).probability ?? 1);
}

/** How much of the amount productivity does not multiply */
export function amountIgnoredByProductivity(result: Ingredient): number {
    return (result as Ingredient & ResultExtras).ignored_by_productivity ?? 0;
}

function toOutput(result: EnrichedIngredient): EnrichedIngredient {
    return { ...result };
}

function fromRecipe(recipe: EnrichedRecipe): RecipeMetadata {
    const {
        name,
        energy_required,
        ingredients,
        results
    } = recipe;


    assert(results.length >= 1, `Recipe ${name} has no item outputs.`);

    const main_product_index = results.reduce(
        (best, result, index) => expectedAmount(result) > expectedAmount(results[best]) ? index : best,
        0,
    );
    const output = results[main_product_index];
    const outputs = [output, ...results.filter((_, index) => index !== main_product_index)].map(toOutput);

    const output_item = outputs[0];

    const inputToOutputRatios: MapExtended<ItemName, IngredientRatio> = new MapExtended();
    const outputToInputRatios: MapExtended<ItemName, IngredientRatio> = new MapExtended();
    const inputsPerCraft: MapExtended<ItemName, EnrichedIngredient> = new MapExtended();

    ingredients.forEach(input => {
        inputToOutputRatios.set(input.name, {
            input: {
                name: input.name,
                amount: input.amount,
                type: input.type,
                item: input.item,
            },
            output: output_item,
            fraction: fraction(input.amount).divide(output_item.amount),
        });
        outputToInputRatios.set(input.name, {
            input: {
                name: input.name,
                amount: input.amount,
                type: input.type,
                item: input.item,
            },
            output: output_item,
            fraction: fraction(output_item.amount).divide(input.amount),
        });

        inputsPerCraft.set(input.name, {
            name: input.name,
            amount: input.amount,
            type: input.type,
            item: input.item,
        })
    })


    return {
        name,
        energy_required,
        output: output_item,
        outputs,
        inputToOutputRatios,
        outputToInputRatios,
        inputsPerCraft,
        raw: recipe,
    };
}

function fromRecipeName(recipeName: string): RecipeMetadata {
    const recipe = FactorioDataService.findRecipeOrThrow(recipeName);
    return fromRecipe(recipe);
}

export const RecipeMetadata = {
    fromRecipe,
    fromRecipeName,
}