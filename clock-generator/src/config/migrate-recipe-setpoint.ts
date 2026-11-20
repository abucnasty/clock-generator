import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";

/**
 * The item that a machine on a recipe counts as its output: the item result with the largest expected amount per craft
 * (the first on a tie). Null where the recipe is not in the game data or makes no item (a recipe of a fluid only).
 */
export function outputItemOf(recipe: string): string | null {
    try {
        return RecipeMetadata.fromRecipeName(recipe).output.name;
    } catch {
        return null;
    }
}

/**
 * The main product of a recipe, the one item of it that a setpoint can count: the item that the game data names as the
 * recipe's `main_product` (iron-bacteria, whose spoilage is a byproduct), where it names one of the item results, else the
 * item result with the largest expected amount per craft. Null where the recipe is not in the game data or makes no item.
 */
export function mainProductOf(recipe: string): string | null {
    try {
        const metadata = RecipeMetadata.fromRecipeName(recipe);
        const named: unknown = metadata.raw.main_product;
        return typeof named === "string" && metadata.outputs.some(result => result.name === named) ? named : metadata.output.name;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a setpoint that names a recipe, not an item, once: the site's setpoint picker lists recipes and stores the recipe's
 * name, but the setpoint counts an item (the schema's `recipe`). Where no machine of the build makes the name as its output,
 * and the main product of the recipe of that name is made by one, the setpoint loads with that item in place of
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
    const made = new Set(value.machines.flatMap(machine => isRecord(machine) && typeof machine.recipe === "string" ? [outputItemOf(machine.recipe)] : []));
    if (made.has(setpoint.recipe)) {
        return value;
    }
    const product = mainProductOf(setpoint.recipe);
    if (product === null || !made.has(product)) {
        return value;
    }
    return { ...value, setpoint: { ...setpoint, recipe: product } };
}
