import { setpointOutputOf, SetpointOutput } from "../data/setpoint-output";
import { refusalOfPickIn, SetpointReason } from "./setpoint-refusal";

/** `setpointOutputOf`, read once for each recipe of one check */
function memoOutputOf(): (recipe: string) => SetpointOutput | null {
    const known = new Map<string, SetpointOutput | null>();
    return recipe => {
        if (!known.has(recipe)) {
            known.set(recipe, setpointOutputOf(recipe));
        }
        return known.get(recipe)!;
    };
}

/**
 * The refusal of an item picked among the outputs of the recipes of a build (in machine order): `not-counted-yet` with the
 * output the engine counts, or null. Applies to a setpoint that counts the item made.
 */
export function refusalOfPick(item: string, recipes: readonly string[]): SetpointReason | null {
    return refusalOfPickIn(item, recipes, memoOutputOf());
}

/**
 * The refusal of the item a setpoint names, for the recipes of the build's machines (in machine order): {@link refusalOfPick},
 * else `no-countable-output` where the name is a recipe with no item result and no machine of the build makes that name
 * as its output; null otherwise.
 */
export function refusalOfSetpoint(item: string, recipes: readonly string[]): SetpointReason | null {
    const outputOf = memoOutputOf();
    const pick = refusalOfPickIn(item, recipes, outputOf);
    if (pick !== null) {
        return pick;
    }
    const named = outputOf(item);
    const made = recipes.some(recipe => {
        const output = outputOf(recipe);
        return output?.kind === "output" && output.item === item;
    });
    return named?.kind === "none" && !made ? { code: "no-countable-output", recipe: item } : null;
}
