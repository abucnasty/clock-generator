import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";

/**
 * The main product of a recipe: the result with the largest expected amount per craft (the item a machine of the recipe
 * counts as its output). Null where the recipe is not in the game data or makes no item (a recipe of a fluid only).
 */
export function mainProductOf(recipe: string): string | null {
    try {
        return RecipeMetadata.fromRecipeName(recipe).output.name;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a setpoint that names a recipe, not an item, once: the site's setpoint picker lists recipes and stores the recipe's
 * name, but the setpoint counts an item (the schema's `recipe`). Where no machine of the build makes the name as its main
 * product, and the main product of the recipe of that name is made by one, the setpoint loads with that item in place of
 * the name, at the same place in the object. Any other setpoint stays as it is: a name that a machine makes (an item that
 * is also the name of a recipe with another main product), a name that is no recipe or no machine makes the main product of,
 * and a setpoint that counts an item destroyed. Share links and saved builds that hold a recipe's name load through this
 * step of the schema.
 */
export function readRecipeSetpointAsItem(value: unknown): unknown {
    if (!isRecord(value) || !isRecord(value.setpoint) || !Array.isArray(value.machines)) {
        return value;
    }
    const setpoint = value.setpoint;
    if (typeof setpoint.recipe !== "string" || (setpoint.counts ?? "made") !== "made") {
        return value;
    }
    const made = new Set(value.machines.flatMap(machine => isRecord(machine) && typeof machine.recipe === "string" ? [mainProductOf(machine.recipe)] : []));
    if (made.has(setpoint.recipe)) {
        return value;
    }
    const product = mainProductOf(setpoint.recipe);
    if (product === null || !made.has(product)) {
        return value;
    }
    return { ...value, setpoint: { ...setpoint, recipe: product } };
}
