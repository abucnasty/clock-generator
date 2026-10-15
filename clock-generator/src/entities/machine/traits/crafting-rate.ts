import Fraction, { fraction } from "../../../data-types/fraction";
import { TICKS_PER_SECOND } from "../../../data-types";

export interface CraftingRate {
    readonly ticks_per_craft: number;
    readonly crafts_per_tick: number;
    readonly amount_per_craft: number;
    readonly amount_per_tick: number;
    readonly amount_per_second: number;
}


function fromCraftingSpeed(
    amountPerCraft: Fraction,
    craftingSpeed: number,
    energyRequired: number
): CraftingRate {
    const recipeTimeInSeconds = energyRequired;
    const ticksPerCraft = fraction(recipeTimeInSeconds).divide(craftingSpeed).multiply(60);
    const craftsPerTick = fraction(1).divide(ticksPerCraft);
    const amountPerTick = amountPerCraft.multiply(craftsPerTick);
    return {
        ticks_per_craft: ticksPerCraft.toDecimal(),
        crafts_per_tick: craftsPerTick.toDecimal(),
        amount_per_craft: amountPerCraft.toDecimal(),
        amount_per_tick: amountPerTick.toDecimal(),
        amount_per_second: amountPerTick.multiply(TICKS_PER_SECOND).toDecimal()
    };
}

export const CraftingRate = {
    fromCraftingSpeed: fromCraftingSpeed,
}