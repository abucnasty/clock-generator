import {fraction} from "../data-types/fraction";
import { ProductionRate } from "../entities";
import { TICKS_PER_SECOND } from "../data-types";
import { TargetProductionRateConfig } from "../config";
import type { TargetCounts } from "../config/schema";

export interface TargetProductionRate {
    /**
     * The rate per copy of the build. Its item is the target item, made by the machines of the target or, where the
     * target counts the item destroyed, taken in from outside the build and destroyed by them
     */
    machine_production_rate: ProductionRate;
    /** What the rate counts: the item made and taken out, or the item taken in and destroyed */
    counts: TargetCounts;
    /** Number of duplicate setups being modeled (multiplier for ratio calculations) */
    copies: number;
    total_production_rate: ProductionRate;
}


function fromConfig(config: TargetProductionRateConfig): TargetProductionRate {

    const recipe = config.recipe;

    const target_output_per_tick = fraction(config.items_per_second)
        .divide(TICKS_PER_SECOND)

    const target_output_per_machine_per_tick = target_output_per_tick
        .divide(config.copies);

    return {
        machine_production_rate: ProductionRate.perTick(recipe, target_output_per_machine_per_tick),
        counts: config.counts ?? "made",
        copies: config.copies,
        total_production_rate: ProductionRate.perTick(recipe, target_output_per_tick),
    };
}

export const TargetProductionRate = {
    fromConfig: fromConfig
}