import type { SetpointOutput } from "../data/setpoint-output";

/**
 * Why the engine refuses what a setpoint names. The code and its data travel with the issue (`params.reason`); the page words
 * them, the engine's message is the technical string of {@link reasonString}.
 * - `not-counted-yet`: the item is an output of a recipe of the build that the engine does not count yet; `choice` is the
 *   output it counts, where there is one.
 * - `no-countable-output`: the name is a recipe with no item result, so no setpoint can count anything of it.
 */
export type SetpointReason =
    | { code: "not-counted-yet"; item: string; choice?: string }
    | { code: "no-countable-output"; recipe: string };

/** The reason as the engine's message gives it: `not-counted-yet: item=jellynut-seed choice=jelly` */
export function reasonString(reason: SetpointReason): string {
    return reason.code === "not-counted-yet"
        ? `not-counted-yet: item=${reason.item}${reason.choice === undefined ? "" : ` choice=${reason.choice}`}`
        : `no-countable-output: recipe=${reason.recipe}`;
}

/**
 * The refusal of an item that is picked as a recipe's output, from the outputs of the recipes (data only: the page calls it
 * with the outputs its lookups carry). It refuses an item that is a choice of one of the recipes, not that recipe's
 * preselected output, where no recipe of the list makes it as its own output; the recipe is the first of the list with the
 * item so, and `choice` is its preselected output.
 */
export function refusalOfPickIn(item: string, recipes: readonly string[], outputOf: (recipe: string) => SetpointOutput | null): SetpointReason | null {
    let choice: string | null = null;
    for (const recipe of recipes) {
        const output = outputOf(recipe);
        if (output?.kind !== "output") {
            continue;
        }
        if (output.item === item) {
            return null;
        }
        if (choice === null && output.choices.includes(item)) {
            choice = output.item;
        }
    }
    return choice === null ? null : { code: "not-counted-yet", item, choice };
}
