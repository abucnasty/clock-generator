import Fraction, { fraction } from "../../../data-types/fraction";
import assert from "../../../common/assert"
import { Ingredient, ItemName, EnrichedIngredient, EnrichedRecipe, FactorioDataService } from "../../../data";
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

/**
 * A result's chance: `probability` before Factorio 2.1; since 2.1 `independent_probability` (the jellynut seed, rolled on
 * its own) or `shared_probability`, a slice {min, max} of one roll shared by the recipe's results (uranium processing:
 * uranium-235 takes 0 to 0.007 of it, uranium-238 the rest; the recycler's and the asteroid reprocessing recipes'
 * results the same way), whose chance is max less min.
 */
type ResultExtras = {
    probability?: number,
    independent_probability?: number,
    shared_probability?: { min: number, max: number },
    ignored_by_productivity?: number,
};

/** The amount a result yields per craft on average, before productivity */
export function expectedAmount(result: Ingredient): number {
    const extras = result as Ingredient & ResultExtras;
    const chance = extras.shared_probability !== undefined
        ? extras.shared_probability.max - extras.shared_probability.min
        : extras.independent_probability ?? extras.probability ?? 1;
    return result.amount * chance;
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


    // the fluids are not simulated (GOALS.md, "Game Data and What Is Not Modelled Yet")
    assert(results.length >= 1, recipe.fluid_results.length > 0
        ? `Recipe ${name} makes only fluids (${recipe.fluid_results.map(it => it.name).join(", ")}): fluid products are not supported (roadmap follow-up F1).`
        : `Recipe ${name} has no products.`);

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