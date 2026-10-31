import { Ingredient } from "../../data";
import { Percentage } from "../../data-types";
import type Fraction from "../../data-types/fraction";
import { amountPerCraftOf, byProductOf, mainProductOf } from "../machine/machine";
import { ProductionRate } from "../machine/output/production-rate";
import { amountIgnoredByProductivity, isStochastic, RecipeMetadata, yieldOf } from "../machine/recipe";
import { CraftingRate } from "../machine/traits";
import { Ratio, ratioOf } from "./ratio";

/** One result of a craft, the main product first */
export interface YieldResult {
    readonly item: string;
    readonly amount: number;
    /** The chance a craft yields it at all (`independent_probability`, or the slice of a shared roll) */
    readonly probability: number;
    readonly extra_count_fraction: number;
    readonly ignored_by_productivity: number;
    /** What a craft makes of it on average, productivity included on the part it multiplies */
    readonly expected_per_craft: number;
    /** The same amount as the exact fraction it is made as (`amountPerCraftOf`); `expected_per_craft` is its decimal */
    readonly per_craft: Ratio;
    /** What the machine or drill makes of it a second at full speed */
    readonly per_second: Ratio;
    readonly main: boolean;
    readonly stochastic: boolean;
}

export interface YieldTrait {
    readonly results: readonly YieldResult[];
    /**
     * How a result that comes by chance is made: at its expected amount, the fraction carried to the next craft (a
     * machine), or one whole item a craft (a drill)
     */
    readonly carry: "expected-with-carry" | "whole-items";
    /** Whether a productivity bar's payout counts as a finished craft, which wakes the takers; null for a drill */
    readonly payouts_count_as_finishes: boolean | null;
}

function resultOf(result: Ingredient, main: boolean, per_craft: Fraction, per_second: Ratio): YieldResult {
    const roll = yieldOf(result);
    return {
        item: result.name,
        amount: roll.amount,
        probability: roll.chance,
        extra_count_fraction: roll.extra,
        ignored_by_productivity: amountIgnoredByProductivity(result),
        expected_per_craft: per_craft.toDecimal(),
        per_craft: ratioOf(per_craft),
        per_second,
        main,
        stochastic: isStochastic(result),
    };
}

/** What a machine's craft yields, each result as the machine makes it (machine.ts: the main product, then the by-products) */
export function machineYield(recipe: RecipeMetadata, crafting_rate: CraftingRate, productivity: number): YieldTrait {
    return {
        results: recipe.outputs.map((result, index) => {
            const made = index === 0
                ? mainProductOf(recipe, crafting_rate, productivity)
                : byProductOf(result, crafting_rate.crafts_per_tick, productivity);
            return resultOf(result, index === 0, made.amount_per_craft, ratioOf(made.production_rate.amount_per_second));
        }),
        carry: "expected-with-carry",
        payouts_count_as_finishes: true,
    };
}

/** What a drill mines: one item a craft, productivity on top (mining-drill.ts) */
export function drillYield(item: string, crafting_rate: CraftingRate, productivity: number): YieldTrait {
    const result: Ingredient = { type: "item", name: item, amount: crafting_rate.amount_per_craft };
    const rate = ProductionRate.fromCraftingRate(item, crafting_rate, new Percentage(productivity));
    return {
        results: [resultOf(result, true, amountPerCraftOf(result, productivity), ratioOf(rate.amount_per_second))],
        carry: "whole-items",
        payouts_count_as_finishes: null,
    };
}
