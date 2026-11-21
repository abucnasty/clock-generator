import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";
import { setpointOutputOf } from "../data/setpoint-output";
import { renameSetpointRecipeToItem } from "./migrate-setpoint";

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a setpoint that names a recipe, not an item, once: the site's setpoint picker once stored the recipe's name, but the
 * setpoint counts an item (the schema's `item`). The setpoint's former `recipe` is read as `item` first
 * ({@link renameRecipeToItem}). Where no machine of the build makes the name as its output, and a machine makes the output
 * the setpoint takes of the recipe of that name (`setpointOutputOf`), the setpoint loads with that item in place of the
 * name, at the same place in the object. Any other setpoint stays as it is: a name that a machine makes (an item that is
 * also the name of a recipe), a name that is no recipe or whose output no machine makes, and a setpoint that counts an item
 * destroyed. Share links and saved builds that hold a recipe's name load through this step of the schema.
 */
export function readRecipeSetpointAsItem(value: unknown): unknown {
    const config = renameSetpointRecipeToItem(value);
    if (!isRecord(config) || !isRecord(config.setpoint) || !Array.isArray(config.machines)) {
        return config;
    }
    const setpoint = config.setpoint;
    if (typeof setpoint.item !== "string" || (setpoint.counts ?? "made") !== "made") {
        return config;
    }
    const made = new Set(config.machines.flatMap(machine => isRecord(machine) && typeof machine.recipe === "string" ? [outputItemOf(machine.recipe)] : []));
    if (made.has(setpoint.item)) {
        return config;
    }
    const output = setpointOutputOf(setpoint.item);
    if (output?.kind !== "output" || !made.has(output.item)) {
        return config;
    }
    return { ...config, setpoint: { ...setpoint, item: output.item } };
}
