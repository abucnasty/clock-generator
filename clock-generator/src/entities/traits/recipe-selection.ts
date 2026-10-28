/** The game's class of the prototypes that pick their recipe from what they are brought (FurnacePrototype, the recycler too) */
const FURNACE_CLASS = "furnace";

/**
 * How a machine comes to its recipe, by its prototype's class: "by-input" for a furnace (it switches recipe when brought
 * another item, so an edge bringing a non-input is refused, and its output blocks at the stack); "fixed" for an
 * assembling machine and for a machine whose prototype the data does not hold
 */
export interface RecipeSelectionTrait {
    readonly mode: "fixed" | "by-input";
}

export function recipeSelectionOf(prototype_type: string | null): RecipeSelectionTrait {
    return { mode: prototype_type === FURNACE_CLASS ? "by-input" : "fixed" };
}
