import { CraftingRate } from "./crafting-rate";
import { Percentage } from "../../../data-types";

export interface BonusProductivityRate {
    readonly progress_per_second: number;
    readonly progress_per_tick: number;
    readonly bonus_crafts_per_tick: number;
    readonly bonus_per_craft: number;
    readonly ticks_per_bonus: number;
    readonly amount_per_bonus: number;
}

function createEmpty(): BonusProductivityRate {
    return {
        progress_per_second: 0,
        progress_per_tick: 0,
        bonus_crafts_per_tick: 0,
        bonus_per_craft: 0,
        ticks_per_bonus: 0,
        amount_per_bonus: 0
    };
}

function fromCraftingRate(
    craftingRate: CraftingRate,
    productivityPercent: Percentage
): BonusProductivityRate {
    // if the productivity percent is 0, there is no bonus productivity and thus no need to calculate further
    if (productivityPercent.value === 0) {
        return createEmpty();
    }

    // if the productivity percent is greater than 0, calculate the bonus productivity 
    // rate for example, if the productivity is 50%, then the bonus productivity will
    // occur every 2 crafts.
    // if the productivity is 100%, then the bonus productivity will occur every craft.
    // if the crafting rate is 120 ticks per craft, and the productivity is 50%, then
    // the bonus productivity will occur every 240 ticks.
    const productivity = productivityPercent.normalized;
    const progressPerTick = craftingRate.crafts_per_tick * productivity;
    const progressPerSecond = progressPerTick * 60;

    const bonusCraftsPerTick = craftingRate.crafts_per_tick * productivity;
    const amountPerBonus = craftingRate.amount_per_craft

    const ticksPerBonus = craftingRate.ticks_per_craft * productivity

    const bonus_per_craft = productivity;

    return {
        progress_per_second: progressPerSecond,
        progress_per_tick: progressPerTick,
        bonus_crafts_per_tick: bonusCraftsPerTick,
        bonus_per_craft: bonus_per_craft,
        ticks_per_bonus: ticksPerBonus,
        amount_per_bonus: amountPerBonus
    };
}

export const BonusProductivityRate = { 
    fromCraftingRate: fromCraftingRate,
    createEmpty: createEmpty,
}