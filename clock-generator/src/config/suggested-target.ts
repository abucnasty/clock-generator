import { Option } from "../data-types/option";
import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";
import { computeMachineFacts } from "../entities/traits/machine-facts-of";
import { MachineConfiguration, TargetProductionRateConfig, TargetProductionRateConfigSchema } from "./schema";

/**
 * The target output a paste from the sidecar mod suggests: the product that leaves the selection and what the selected
 * machines make of it together at their maximum. A ceiling, not a recommendation: a clock that runs the machines at their
 * maximum has nothing to switch off.
 */
export interface SuggestedTarget {
    target: TargetProductionRateConfig;
    /** "mod": the export carried it; "inferred": worked out from the pasted machines */
    source: "mod" | "inferred";
}

const SuggestedTargetSchema = TargetProductionRateConfigSchema.extend({
    recipe: TargetProductionRateConfigSchema.shape.recipe.min(1),
});

/** The `suggested_target` of a sidecar export, None when it is missing or not a valid target. Never throws. */
export function parseSuggestedTarget(raw: unknown): Option<TargetProductionRateConfig> {
    const result = SuggestedTargetSchema.safeParse(raw);
    return result.success ? Option.some(result.data) : Option.none();
}

/** One recipe of the selection: its main product, what its machines make of it per second and what it consumes */
interface RecipeGroup {
    readonly recipe: string;
    readonly product: string;
    readonly ingredients: ReadonlySet<string>;
    readonly items_per_second: number;
}

function outputRateOf(machine: MachineConfiguration): number | null {
    try {
        return computeMachineFacts({
            recipe: machine.recipe,
            productivity: machine.productivity,
            crafting_speed: machine.crafting_speed,
            prototype: machine.prototype,
            energy_consumption_bonus: machine.energy_consumption_bonus,
            fuel: machine.fuel,
        }).output_rate_per_second;
    } catch {
        return null;
    }
}

/** The recipe of these machines with its main product and their total rate, or null when there is nothing to count */
function recipeGroupOf(recipe: string, machines: readonly MachineConfiguration[]): RecipeGroup | null {
    let metadata: RecipeMetadata;
    try {
        metadata = RecipeMetadata.fromRecipeName(recipe);
    } catch {
        // an unknown recipe, or one with no item product (a pure fluid recipe)
        return null;
    }
    const rates = machines.map(outputRateOf).filter((rate): rate is number => rate !== null && Number.isFinite(rate) && rate > 0);
    if (rates.length === 0) {
        return null;
    }
    return {
        recipe,
        product: metadata.output.name,
        ingredients: new Set(metadata.raw.ingredients.map(ingredient => ingredient.name)),
        items_per_second: rates.reduce((sum, rate) => sum + rate, 0),
    };
}

/**
 * The final product of these machines and what they make of it at their maximum, as a target output. The rule is
 * mirrored in the sidecar mod (`clock-generator-sidecar/scripts/suggested-target.lua`); change both together.
 *
 * 1. The machines are grouped by recipe; an unknown recipe, or one without an item product, is skipped.
 * 2. A recipe's product is its main product (`RecipeMetadata.output`).
 * 3. A recipe is intermediate when another recipe of the selection has its product as an ingredient. By-products do
 *    not count, nor does a recipe consuming its own product.
 * 4. The others are final; when every recipe is intermediate (a circle) there is no suggestion.
 * 5. Of several final recipes, the one whose machines make the most per second; on an exact tie, the one whose product
 *    name sorts first, then the one whose recipe name does.
 * 6. Its rate is the sum of the output rates of its machines, as the machine facts give them; copies is 1.
 */
export function inferSuggestedTarget(machines: readonly MachineConfiguration[]): Option<TargetProductionRateConfig> {
    const by_recipe = new Map<string, MachineConfiguration[]>();
    for (const machine of machines) {
        by_recipe.set(machine.recipe, [...(by_recipe.get(machine.recipe) ?? []), machine]);
    }
    const groups = [...by_recipe.entries()]
        .map(([recipe, of_recipe]) => recipeGroupOf(recipe, of_recipe))
        .filter((group): group is RecipeGroup => group !== null);

    const final = groups.filter(group =>
        !groups.some(other => other.recipe !== group.recipe && other.ingredients.has(group.product)),
    );
    if (final.length === 0) {
        return Option.none();
    }
    const best = final.reduce((best, group) => {
        if (group.items_per_second !== best.items_per_second) {
            return group.items_per_second > best.items_per_second ? group : best;
        }
        if (group.product !== best.product) {
            return group.product < best.product ? group : best;
        }
        return group.recipe < best.recipe ? group : best;
    });
    return Option.some({ recipe: best.product, items_per_second: best.items_per_second, copies: 1 });
}

/**
 * The target output to suggest for a paste from the sidecar mod: the export's own `suggested_target` when it is valid,
 * else the one worked out from the machines (an export from a mod before 0.8.0), else None.
 */
export function suggestedTargetOf(raw: unknown, machines: readonly MachineConfiguration[]): Option<SuggestedTarget> {
    return Option.orElse(
        Option.map(parseSuggestedTarget(raw), (target): SuggestedTarget => ({ target, source: "mod" })),
        () => Option.map(inferSuggestedTarget(machines), (target): SuggestedTarget => ({ target, source: "inferred" })),
    );
}
