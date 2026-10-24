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
 * its own; recycling iron ore gives the ore back at 0.25) or `shared_probability`, a slice {min, max} of one roll shared
 * by the recipe's results (uranium processing: uranium-235 takes 0 to 0.007 of it, uranium-238 the rest; the asteroid
 * reprocessing recipes' results the same way), whose chance is max less min. `extra_count_fraction` is the chance of
 * one item more when the result comes: recycling an item made by a recipe gives each ingredient's amount / 4 that way,
 * an amount of 0 and a chance of one (recycling a gear gives an iron plate at 0.5).
 */
type ResultExtras = {
    probability?: number,
    independent_probability?: number,
    shared_probability?: { min: number, max: number },
    extra_count_fraction?: number,
    ignored_by_productivity?: number,
};

/** The chance that a craft yields the result at all */
function chanceOf(extras: ResultExtras): number {
    return extras.shared_probability !== undefined
        ? extras.shared_probability.max - extras.shared_probability.min
        : extras.independent_probability ?? extras.probability ?? 1;
}

/** The amount a result yields per craft on average, before productivity */
export function expectedAmount(result: Ingredient): number {
    const extras = result as Ingredient & ResultExtras;
    return (result.amount + (extras.extra_count_fraction ?? 0)) * chanceOf(extras);
}

/**
 * The variance of what one craft yields of a result, before productivity: 0 for a result that always comes in the same
 * amount. A craft yields the amount, and one more at `extra_count_fraction`, all with the result's chance, each roll on
 * its own (recorded on the recycler: the returns of a tick follow a binomial of its crafts).
 */
export function amountVariance(result: Ingredient): number {
    const extras = result as Ingredient & ResultExtras;
    const chance = chanceOf(extras);
    const extra = extras.extra_count_fraction ?? 0;
    const amount = result.amount;
    // E[X²] of amount + Bernoulli(extra), times the chance, less the square of the mean
    const mean_square = chance * (amount * amount + 2 * amount * extra + extra);
    const mean = chance * (amount + extra);
    return Math.max(0, mean_square - mean * mean);
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
    // a recycling recipe's main product comes in an amount of 0 and a chance of one: its ratios go by what a craft gives on average
    const output_per_craft = fraction(expectedAmount(output_item));

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
            fraction: fraction(input.amount).divide(output_per_craft),
        });
        outputToInputRatios.set(input.name, {
            input: {
                name: input.name,
                amount: input.amount,
                type: input.type,
                item: input.item,
            },
            output: output_item,
            fraction: output_per_craft.divide(input.amount),
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