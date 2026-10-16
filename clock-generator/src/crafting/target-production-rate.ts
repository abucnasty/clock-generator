import {fraction} from "../data-types/fraction";
import { ProductionRate } from "../entities";
import { TICKS_PER_SECOND } from "../data-types";
import { TargetProductionRateConfig } from "../config";

export interface TargetProductionRate {
    machine_production_rate: ProductionRate;
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
        copies: config.copies,
        total_production_rate: ProductionRate.perTick(recipe, target_output_per_tick),
    };
}

export const TargetProductionRate = {
    fromConfig: fromConfig
}