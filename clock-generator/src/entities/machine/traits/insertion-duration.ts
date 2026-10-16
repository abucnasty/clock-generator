import Fraction, { fraction } from "../../../data-types/fraction";
import { OverloadMultiplier, ProductionRate } from "../output";

/**
 * Represents a range of ticks during which an inserter can insert items.
 */
export interface InsertionDuration {
    readonly tick_duration: Fraction;
}

function create(productionRate: ProductionRate, overloadMultiplier: OverloadMultiplier): InsertionDuration {
    return {
        tick_duration: fraction(overloadMultiplier.overload_multiplier).divide(productionRate.amount_per_tick)
    }
}

export const InsertionDuration = {
    create: create
};
