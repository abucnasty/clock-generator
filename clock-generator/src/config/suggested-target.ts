import { pipe } from "fp-ts/function";
import * as O from "fp-ts/Option";
import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";
import { computeMachineFacts } from "../entities/traits/machine-facts-of";
import { targetRateMaxOf } from "../crafting/feasibility/max-rate";
import { dropLanesOf, lanesCapacityOf } from "./lane-capacity-validator";
import { BeltConfig, ChestConfig, Config, ConfigSchema, InserterConfig, MachineConfiguration, MiningDrillConfig, TargetProductionRateConfig, TargetProductionRateConfigSchema } from "./schema";

/**
 * The setpoint a paste from the sidecar mod suggests: the product that leaves the selection and what the selected
 * machines make of it together at their maximum, or less where the belt the product is put on carries less, or the
 * build can hold less. A ceiling, not a recommendation: a clock that runs the machines at their maximum has nothing to
 * switch off.
 */
export interface SuggestedTarget {
    target: TargetProductionRateConfig;
    /** "mod": the export carried it; "inferred": worked out from the pasted machines */
    source: "mod" | "inferred";
    /**
     * Set where the belt the product is put on carries less than the machines make, and is what decides the rate: that
     * belt, and what the machines make. The target's rate is then what the belt carries.
     */
    belt_limit?: { belt_id: number; machines_per_second: number };
    /**
     * Set where the engine's most for the pasted build (`targetRateMaxOf`) is below both what the machines make and what
     * the output belt carries: what the machines make, and the engine's words for the limit at that rate (its `limit`,
     * null where it has none). The target's rate is then that most.
     */
    build_limit?: { machines_per_second: number; text: string | null };
}

/** The inserters and belts of a paste, for the belt the product is put on */
export interface PastedOutputs {
    inserters: readonly InserterConfig[];
    belts: readonly BeltConfig[];
}

/** The rest of a paste, for the engine's most for the whole build */
export interface PastedRest {
    chests: readonly ChestConfig[];
    drills: readonly MiningDrillConfig[];
}

const SuggestedTargetSchema = TargetProductionRateConfigSchema.extend({
    recipe: TargetProductionRateConfigSchema.shape.recipe.min(1),
});

/** The `suggested_target` of a sidecar export, None when it is missing or not a valid target. Never throws. */
export function parseSuggestedTarget(raw: unknown): O.Option<TargetProductionRateConfig> {
    const result = SuggestedTargetSchema.safeParse(raw);
    return result.success ? O.some(result.data) : O.none;
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
export function inferSuggestedTarget(machines: readonly MachineConfiguration[]): O.Option<TargetProductionRateConfig> {
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
        return O.none;
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
    return O.some({ recipe: best.product, items_per_second: best.items_per_second, copies: 1 });
}

/** The main product of a recipe, null for an unknown recipe or one with no item product */
function mainProductOf(recipe: string): string | null {
    try {
        return RecipeMetadata.fromRecipeName(recipe).output.name;
    } catch {
        return null;
    }
}

/**
 * The belt that every machine making the product puts it on, and what the lanes the product can land on carry at
 * most; null where the product does not all go onto one belt of the paste. The machines making it are the pasted
 * machines whose main product it is. Each must have an output inserter that carries the product, and every such
 * inserter drops onto the same belt: a machine that places its results itself, an inserter into a chest or a machine,
 * or a second belt leaves the product off this belt. The lanes are those of the lane rule of one unit's drops
 * (`dropLanesOf`), each at its own stack size.
 *
 * The rule is mirrored in the sidecar mod (`clock-generator-sidecar/scripts/suggested-target.lua`); change both together.
 */
function outputBeltOf(product: string, machines: readonly MachineConfiguration[], outputs: PastedOutputs): { belt_id: number; items_per_second: number } | null {
    const making = machines.filter(machine => mainProductOf(machine.recipe) === product);
    if (making.length === 0 || making.some(machine => machine.result_target !== undefined)) return null;
    const ids = new Set(making.map(machine => machine.id));
    const carrying = outputs.inserters.filter(inserter => inserter.source.type === "machine" && ids.has(inserter.source.id)
        && (inserter.filters === undefined || inserter.filters.length === 0 || inserter.filters.includes(product)));
    const fed = new Set(carrying.map(inserter => inserter.source.id));
    if (making.some(machine => !fed.has(machine.id))) return null;
    const belt_ids = new Set(carrying.map(inserter => inserter.sink.type === "belt" ? inserter.sink.id : null));
    if (belt_ids.size !== 1 || belt_ids.has(null)) return null;
    const belt = outputs.belts.find(it => belt_ids.has(it.id));
    if (belt === undefined) return null;
    const lanes = [...new Set(carrying.flatMap(inserter => inserter.sink.type === "belt" ? dropLanesOf(belt, inserter.sink, product) : []))];
    if (lanes.length === 0) return null;
    try {
        return { belt_id: belt.id, items_per_second: lanesCapacityOf(belt, lanes).toDecimal() };
    } catch {
        // a belt the engine has no speed for
        return null;
    }
}

/**
 * A suggestion held to the belt its product is put on: the lower of what the machines make and what that belt carries.
 * The rate is the total for all the copies (the setpoint's `items_per_second`); a suggestion is always for copies 1 with
 * every selected machine in it, and the conversion to copies keeps the rate, so the total is what the belt takes.
 */
function heldToOutputBelt(suggestion: SuggestedTarget, machines: readonly MachineConfiguration[], outputs: PastedOutputs): SuggestedTarget {
    const product = suggestion.target.recipe;
    const belt = outputBeltOf(product, machines, outputs);
    // what the machines make, from their facts too: a sidecar that holds its suggestion to the belt exports the belt's rate
    const made = Math.max(suggestion.target.items_per_second, machinesRateOf(product, machines));
    // a suggestion below the belt's rate is not the belt's doing, and stays as it is
    if (belt === null || !(made > belt.items_per_second) || suggestion.target.items_per_second < belt.items_per_second) return suggestion;
    return {
        ...suggestion,
        target: { ...suggestion.target, items_per_second: belt.items_per_second },
        belt_limit: { belt_id: belt.belt_id, machines_per_second: made },
    };
}

/** What the pasted machines whose main product it is make of a product together at their maximum (rule 6 above) */
function machinesRateOf(product: string, machines: readonly MachineConfiguration[]): number {
    const by_recipe = new Map<string, MachineConfiguration[]>();
    for (const machine of machines.filter(it => mainProductOf(it.recipe) === product)) {
        by_recipe.set(machine.recipe, [...(by_recipe.get(machine.recipe) ?? []), machine]);
    }
    return [...by_recipe.entries()].reduce((sum, [recipe, of_recipe]) => sum + (recipeGroupOf(recipe, of_recipe)?.items_per_second ?? 0), 0);
}

/**
 * A suggestion held to the engine's most for the pasted build (`targetRateMaxOf`: the cuts of the feasibility pass and
 * the lanes the copies share, the same figure as the page's "At most N/s"), where that is below the suggestion. The
 * build is the paste with the machines' rate as its setpoint, so the engine's words say what stops that rate. A paste
 * with no belts, or one the schema or the engine cannot read, is left as it is.
 */
function heldToBuild(suggestion: SuggestedTarget, machines: readonly MachineConfiguration[], outputs: PastedOutputs, rest: PastedRest): SuggestedTarget {
    if (outputs.belts.length === 0) return suggestion;
    const product = suggestion.target.recipe;
    const made = suggestion.belt_limit?.machines_per_second ?? Math.max(suggestion.target.items_per_second, machinesRateOf(product, machines));
    const parsed = ConfigSchema.safeParse({
        setpoint: { recipe: product, items_per_second: made, copies: suggestion.target.copies }, overrides: {},
        machines, inserters: outputs.inserters, belts: outputs.belts, chests: rest.chests,
        ...(rest.drills.length > 0 && { drills: { configs: rest.drills } }),
    });
    if (!parsed.success) return suggestion;
    const most = targetRateMaxOf(parsed.data as Config);
    // the most is for one copy; a suggestion is for copies 1, so it is the total
    if (most === null || !(most.per_copy_per_second < suggestion.target.items_per_second)) return suggestion;
    const { belt_limit: _belt, ...rest_of } = suggestion;
    return {
        ...rest_of,
        target: { ...suggestion.target, items_per_second: most.per_copy_per_second },
        build_limit: { machines_per_second: made, text: most.limit },
    };
}

/**
 * The setpoint to suggest for a paste from the sidecar mod: the export's own `suggested_target` when it is valid, else
 * the one worked out from the machines (an export from a mod before 0.8.0), else None. With the paste's inserters and
 * belts, it is held to the belt the product is put on; with the rest of the paste too, to the engine's most for the
 * whole build. The lowest of the three is the suggestion, and the one that decides it is named.
 */
export function suggestedTargetOf(raw: unknown, machines: readonly MachineConfiguration[], outputs?: PastedOutputs, rest?: PastedRest): O.Option<SuggestedTarget> {
    return pipe(
        parseSuggestedTarget(raw),
        O.map((target): SuggestedTarget => ({ target, source: "mod" })),
        O.alt(() => pipe(
            inferSuggestedTarget(machines),
            O.map((target): SuggestedTarget => ({ target, source: "inferred" })),
        )),
        O.map(suggestion => outputs === undefined ? suggestion : heldToOutputBelt(suggestion, machines, outputs)),
        O.map(suggestion => outputs === undefined || rest === undefined ? suggestion : heldToBuild(suggestion, machines, outputs, rest)),
    );
}
