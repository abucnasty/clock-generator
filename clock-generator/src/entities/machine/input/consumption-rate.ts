import Fraction from "../../../data-types/fraction";

export interface ConsumptionRate {
    readonly item: string;
    readonly rate_per_second: number;
    readonly rate_per_tick: number;
    readonly amount_per_craft: number;
}


function fromCraftingSpeed(item: string, craftingSpeed: number, craftingTime: number, ingredientAmount: number): ConsumptionRate {
    const items_per_second = new Fraction(ingredientAmount).multiply(craftingSpeed).divide(craftingTime);
    const items_per_tick = items_per_second.divide(60);
    return {
        item,
        rate_per_second: items_per_second.toDecimal(),
        rate_per_tick: items_per_tick.toDecimal(),
        amount_per_craft: ingredientAmount,
    };
}

export const ConsumptionRate = {
    fromCraftingSpeed: fromCraftingSpeed,
}