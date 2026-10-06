import { ItemName } from "../../../data";
import { TICKS_PER_SECOND } from "../../../data-types";
import { BurnerEnergySource, Fuel } from "../fuel";

/** Factorio clamps the energy consumption effect at -80%. */
export const MIN_ENERGY_CONSUMPTION_BONUS_PERCENT = -80;

export interface FuelConsumption {
    readonly item: ItemName;
    /** Fuel items burned per second while the machine is crafting. */
    readonly rate_per_second: number;
    readonly rate_per_tick: number;
    /** Fuel items burned over one craft, including crafting speed. */
    readonly amount_per_craft: number;
}

/**
 * Burner machines burn fuel only while crafting. Energy usage scales with the
 * energy consumption bonus (speed modules raise it, efficiency modules lower it)
 * and is independent of productivity.
 *
 * @param source the machine's energy source
 * @param fuel the fuel being burned
 * @param craftingSpeed total crafting speed of the machine
 * @param craftingTime recipe energy_required in seconds
 * @param energyConsumptionBonusPercent total consumption effect, e.g. 50 for +50%
 */
function fromCraftingSpeed(
    source: BurnerEnergySource,
    fuel: Fuel,
    craftingSpeed: number,
    craftingTime: number,
    energyConsumptionBonusPercent: number = 0,
): FuelConsumption {
    const bonus = Math.max(energyConsumptionBonusPercent, MIN_ENERGY_CONSUMPTION_BONUS_PERCENT);
    // plain numbers: decimal crafting speeds and bonuses make fractions with numerators and denominators too big to keep exact
    const kw = source.energy_usage_kw * (100 + bonus) / 100;
    const itemsPerSecond = kw / (fuel.fuel_value_mj * 1000);
    const secondsPerCraft = craftingTime / craftingSpeed;
    return {
        item: fuel.item_name,
        rate_per_second: itemsPerSecond,
        rate_per_tick: itemsPerSecond / TICKS_PER_SECOND.toDecimal(),
        amount_per_craft: itemsPerSecond * secondsPerCraft,
    };
}

export const FuelConsumption = {
    fromCraftingSpeed,
}
