import { fraction } from "fractionability";
import { TICKS_PER_SECOND } from "../../../data-types";

export const NUTRIENT_ITEM_NAME = "nutrients";

/** Biochamber base energy usage in kW. */
export const BIOCHAMBER_ENERGY_USAGE_KW = 500;

/** Fuel value of one nutrients item in MJ. */
export const NUTRIENT_FUEL_VALUE_MJ = 2;

/** Factorio clamps the energy consumption effect at -80%. */
export const MIN_ENERGY_CONSUMPTION_BONUS_PERCENT = -80;

export interface NutrientConsumption {
    readonly item: typeof NUTRIENT_ITEM_NAME;
    /** Nutrients burned per second while the machine is crafting. */
    readonly rate_per_second: number;
    readonly rate_per_tick: number;
    /** Nutrients burned over one craft, including crafting speed. */
    readonly amount_per_craft: number;
}

/**
 * Biochambers burn nutrients only while crafting. Energy usage scales with the
 * energy consumption bonus (speed modules raise it, efficiency modules lower it)
 * and is independent of productivity.
 *
 * @param craftingSpeed total crafting speed of the machine
 * @param craftingTime recipe energy_required in seconds
 * @param energyConsumptionBonusPercent total consumption effect, e.g. 50 for +50%
 */
function fromCraftingSpeed(
    craftingSpeed: number,
    craftingTime: number,
    energyConsumptionBonusPercent: number = 0,
): NutrientConsumption {
    const bonus = Math.max(energyConsumptionBonusPercent, MIN_ENERGY_CONSUMPTION_BONUS_PERCENT);
    const kw = fraction(BIOCHAMBER_ENERGY_USAGE_KW).multiply(fraction(100).add(fraction(bonus)).divide(100));
    const nutrientsPerSecond = kw.divide(NUTRIENT_FUEL_VALUE_MJ * 1000);
    const secondsPerCraft = fraction(craftingTime).divide(craftingSpeed);
    return {
        item: NUTRIENT_ITEM_NAME,
        rate_per_second: nutrientsPerSecond.toDecimal(),
        rate_per_tick: nutrientsPerSecond.divide(TICKS_PER_SECOND).toDecimal(),
        amount_per_craft: nutrientsPerSecond.multiply(secondsPerCraft).toDecimal(),
    };
}

export const NutrientConsumption = {
    fromCraftingSpeed,
}
