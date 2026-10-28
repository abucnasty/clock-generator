import { MiningDrillConfig } from "../../config";
import { MachineConfiguration } from "../../config/schema";
import { MiningDrillSpec, Resource } from "../../data";
import { Percentage } from "../../data-types";
import { drillMiningSpeed } from "../drill/mining-drill";
import { MachineInput } from "../machine/input/machine-input";
import { ProductionRate } from "../machine/output/production-rate";
import { RecipeMetadata } from "../machine/recipe";
import { BonusProductivityRate, CraftingRate, InsertionDuration } from "../machine/traits";
import { OverloadMultiplier } from "../machine/traits/overload-multiplier";

/** What a craft takes of an ingredient, and what the machine takes of it at full speed */
export interface ProductionInput {
    readonly item: string;
    readonly per_craft: number;
    readonly per_second: number;
    readonly per_tick: number;
}

/** What a machine crafts or a drill mines, and how fast: a crafting machine never crafts faster than this */
export interface ProductionTrait {
    readonly kind: "recipe" | "resource";
    /** The recipe, or the resource mined; for labels and the yield lookup, never branched on */
    readonly recipe_or_resource: string;
    /** The prototype as the config names it; null for a machine that names none */
    readonly prototype: string | null;
    /** The prototype's class in the game data ("assembling-machine", "furnace", "mining-drill"); null when the data has no such prototype */
    readonly prototype_type: string | null;
    /** The crafting speed as configured (modules, beacons and quality folded in), or the drill's mining speed with its bonus */
    readonly speed: number;
    /** The recipe's time, or the resource's mining time, in seconds */
    readonly energy_required: number;
    readonly ticks_per_craft: number;
    readonly crafts_per_tick: number;
    /** In percent, as configured; not capped */
    readonly productivity: number;
    /** The productivity bar's fill a craft; null for a drill, whose bonus bar is its mining progress */
    readonly bonus_per_craft: number | null;
    readonly ticks_per_bonus: number | null;
    /** The item ingredients; none for a drill */
    readonly inputs: readonly ProductionInput[];
    /** Ticks to the overload lockout of the main product; null for a drill */
    readonly insertion_duration_ticks: number | null;
}

/** A machine's production on its recipe, with the figures the machine itself works from (machine.ts) */
export function machineProduction(
    config: MachineConfiguration,
    prototype_type: string | null,
    recipe: RecipeMetadata,
    crafting_rate: CraftingRate,
    inputs: readonly MachineInput[],
    main_rate: ProductionRate,
    overload_multiplier: OverloadMultiplier,
): ProductionTrait {
    const bonus = BonusProductivityRate.fromCraftingRate(crafting_rate, new Percentage(config.productivity));
    return {
        kind: "recipe",
        recipe_or_resource: recipe.name,
        prototype: config.prototype ?? null,
        prototype_type,
        speed: config.crafting_speed,
        energy_required: recipe.energy_required,
        ticks_per_craft: crafting_rate.ticks_per_craft,
        crafts_per_tick: crafting_rate.crafts_per_tick,
        productivity: config.productivity,
        bonus_per_craft: bonus.bonus_per_craft,
        ticks_per_bonus: bonus.ticks_per_bonus,
        inputs: inputs.map(input => ({
            item: input.item_name,
            per_craft: input.ingredient.amount,
            per_second: input.consumption_rate.rate_per_second,
            per_tick: input.consumption_rate.rate_per_tick,
        })),
        insertion_duration_ticks: InsertionDuration.create(main_rate, overload_multiplier).tick_duration.toDecimal(),
    };
}

/** A drill's production on its resource: one item a craft, at its mining speed (mining-drill.ts) */
export function drillProduction(config: MiningDrillConfig, spec: MiningDrillSpec, resource: Resource, crafting_rate: CraftingRate): ProductionTrait {
    return {
        kind: "resource",
        recipe_or_resource: config.mined_item_name,
        prototype: config.type,
        prototype_type: spec.type,
        speed: drillMiningSpeed(spec, config.speed_bonus),
        energy_required: resource.minable.mining_time,
        ticks_per_craft: crafting_rate.ticks_per_craft,
        crafts_per_tick: crafting_rate.crafts_per_tick,
        productivity: config.productivity,
        bonus_per_craft: null,
        ticks_per_bonus: null,
        inputs: [],
        insertion_duration_ticks: null,
    };
}
