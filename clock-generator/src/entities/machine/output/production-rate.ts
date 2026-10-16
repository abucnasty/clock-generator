import Fraction, { fraction } from "../../../data-types/fraction";
import { TICKS_PER_SECOND, Percentage } from "../../../data-types";
import { CraftingRate } from "../traits";
import { ItemName } from "../../../data";

export interface ProductionRate {
    readonly item: string;
    readonly amount_per_second: Fraction;
    readonly amount_per_tick: Fraction;
}


function limitTo(productionRate: ProductionRate, maxRatePerSecond: Fraction): ProductionRate {
    return {
        item: productionRate.item,
        amount_per_second: maxRatePerSecond,
        amount_per_tick: maxRatePerSecond.divide(60)
    };
}


function fromItemsPerSecond(item: ItemName, rate_per_second: Fraction): ProductionRate {
    const rate_per_tick = rate_per_second.divide(60);
    return {
        item,
        amount_per_second: rate_per_second,
        amount_per_tick: rate_per_tick
    };
}

function fromItemsPerTick(item: ItemName, rate_per_tick: Fraction): ProductionRate {
    const rate_per_second = rate_per_tick.multiply(TICKS_PER_SECOND);
    return {
        item,
        amount_per_second: rate_per_second,
        amount_per_tick: rate_per_tick
    };
}

function fromCraftingRate(item: ItemName, crafting_rate: CraftingRate, productivity: Percentage) {
    const rate_per_second = fraction(crafting_rate.amount_per_second)
        .multiply(
            fraction(1).add(
                fraction(productivity.value).divide(100)
            )
        );
    return fromItemsPerSecond(item, rate_per_second);
}

export const ProductionRate = {
    limitTo: limitTo,
    perSecond: fromItemsPerSecond,
    perTick: fromItemsPerTick,
    fromCraftingRate: fromCraftingRate
}