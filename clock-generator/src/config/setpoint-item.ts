import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";
import { setpointOutputOf } from "../data/setpoint-output";

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
 * Read a setpoint whose `item` names a recipe, not an item: the site's setpoint picker names a recipe, but the setpoint
 * counts an item (the schema's `item`). Where no machine of the build makes the name as its output, and a machine makes
 * the output the setpoint takes of the recipe of that name (`setpointOutputOf`), the setpoint loads with that item in
 * place of the name, at the same place in the object. Any other setpoint stays as it is: a name that a machine makes (an
 * item that is also the name of a recipe), a name that is no recipe or whose output no machine makes, and a setpoint that
 * counts an item destroyed.
 */
export function readRecipeSetpointAsItem(value: unknown): unknown {
    if (!isRecord(value) || !isRecord(value.setpoint) || !Array.isArray(value.machines)) {
        return value;
    }
    const setpoint = value.setpoint;
    if (typeof setpoint.item !== "string" || (setpoint.counts ?? "made") !== "made") {
        return value;
    }
    const made = new Set(value.machines.flatMap(machine => isRecord(machine) && typeof machine.recipe === "string" ? [outputItemOf(machine.recipe)] : []));
    if (made.has(setpoint.item)) {
        return value;
    }
    const output = setpointOutputOf(setpoint.item);
    if (output?.kind !== "output" || !made.has(output.item)) {
        return value;
    }
    return { ...value, setpoint: { ...setpoint, item: output.item } };
}

/**
 * A setpoint of the Sidecar mod's suggested target, which names the item as `recipe`: given back with `item` in its
 * place and no `recipe`; one that holds both keeps its `item` and drops `recipe`. The name stays as it is: no recipe's
 * name is read as its product here. Anything else is given back as it was.
 */
export function renameRecipeToItem(setpoint: unknown): unknown {
    if (!isRecord(setpoint) || !("recipe" in setpoint)) {
        return setpoint;
    }
    if ("item" in setpoint) {
        const { recipe: _former, ...kept } = setpoint;
        return kept;
    }
    return Object.fromEntries(Object.entries(setpoint).map(([key, entry]) => [key === "recipe" ? "item" : key, entry]));
}
