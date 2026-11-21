import { expectedAmount } from "../entities/machine/recipe/recipe-metadata";
import { FactorioDataService } from "./factorio-data-service";
import type { Ingredient, Recipe } from "./factorio-data-types";

/**
 * The item that a setpoint counts for a recipe, and the items the user can choose it from.
 * - `item`: the output the engine counts, which the setpoint's item is set to when the recipe is picked.
 * - `choices`: the outputs the recipe offers to choose from, in the game data's order; empty for a recipe with several item
 *   results of which none can be chosen (the asteroid reprocessings, the kovarex process), where `item` is what a machine
 *   on the recipe counts as it does today.
 * A recipe with no item result (a fluid only, or none) has no output.
 */
export type SetpointOutput =
    | { kind: "output"; item: string; choices: string[] }
    | { kind: "none" };

/**
 * The output of a recipe as the setpoint takes it, from the game data alone (no name table):
 * 1. a recipe with no item result has none;
 * 2. with one item result, that result, a recipe that returns its own ingredient included;
 * 3. else the user chooses among the choosable results: the item results that the data does not leave out of the stats
 *    (`ignored_by_stats`) and that are not the recipe's own ingredients, the one with the largest expected amount per craft
 *    preselected (the first on a tie); a recipe whose results share one roll that gives back an ingredient (the asteroid
 *    reprocessings) has none, and nor has a recipe whose results are all its ingredients (the kovarex process). Those count
 *    what a machine on the recipe counts, the largest expected amount.
 * The recipe's `main_product` is not read: the two bacteria recipes name the bacterium, which comes by chance at 0.1,
 * while their machines count spoilage, the largest result; the output is spoilage, with the bacterium to choose.
 */
export function setpointOutputOfRecipe(recipe: Recipe): SetpointOutput {
    // a recipe without results is an empty Lua table in the dump, which is {} in JSON
    const results = (Array.isArray(recipe.results) ? recipe.results : []).filter(result => result.type !== "fluid");
    if (results.length === 0) {
        return { kind: "none" };
    }
    if (results.length === 1) {
        return { kind: "output", item: results[0].name, choices: [results[0].name] };
    }
    const ingredients = new Set((Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map(ingredient => ingredient.name));
    const givesBackIngredient = results.some(result => result.shared_probability !== undefined && ingredients.has(result.name));
    const choosable = givesBackIngredient ? [] : results.filter(result => !((result.ignored_by_stats ?? 0) > 0) && !ingredients.has(result.name));
    if (choosable.length === 0) {
        return { kind: "output", item: largestOf(results).name, choices: [] };
    }
    return { kind: "output", item: largestOf(choosable).name, choices: choosable.map(result => result.name) };
}

/** The result with the largest expected amount per craft, the first on a tie: what a machine on the recipe counts */
function largestOf(results: readonly Ingredient[]): Ingredient {
    return results.reduce((best, result) => expectedAmount(result) > expectedAmount(best) ? result : best);
}

/** The output of the recipe of that name; null where the game data has no such recipe, or is not loaded (a page before its data) */
export function setpointOutputOf(recipe: string): SetpointOutput | null {
    try {
        const found = FactorioDataService.findRecipe(recipe);
        return found === null ? null : setpointOutputOfRecipe(found);
    } catch {
        return null;
    }
}
