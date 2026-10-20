import { Config } from "../../config";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { validateCopies } from "../../config/copies-validator";
import { SimulationContext } from "../sequence/simulation-context";
import { SerializableTransferPlan } from "../sequence/cycle/swing-counts";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { PrepareStep } from "../runner/steps/prepare-step";
import { Logger } from "../../common/logger";
import { planCraftingCycle, transferPlanOf } from "../plan/plan-run";

/** What validating a config finds out before any clock is generated */
export interface ConfigValidation {
    /** Hands each inserter and drill moves per crafting cycle */
    transfer_plan: SerializableTransferPlan;
    /** Crafting cycles in one clock period: the computed LCM, or the config's override */
    used_lcm: number;
    /** Hands each output inserter takes per crafting cycle, before any backoff a generation may apply */
    output_swings_per_cycle: number;
    cycle_ticks: number;
    period_ticks: number;
}

/**
 * Checks that a clock can be planned for the config and returns that plan, without generating any clock: every
 * ingredient and output has an inserter, the machines can reach the target rate, and every belt that is filled is
 * planned for. Costs one prepare run (the machines crafting until output blocked; a second with the belts backed up
 * where they move, which the output swings are counted on) instead of the hundreds of simulations a generation does. Throws with the reason when the config is not valid.
 *
 * A generation can still end up with another plan than this one: it lowers the output swings when the planned
 * count is unstable, and offers other counts as potential clocks.
 */
export function validateConfig(config: Config, options: { logger?: Logger } = {}): ConfigValidation {
    const logger = options.logger ?? { log: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
    assertInserterCoverage(config);
    validateCopies(config);

    const simulation_context = SimulationContext.fromConfig(config);
    new PrepareStep(simulation_context).execute();

    const { crafting_cycle_plan, output_inserters, all_output_inserters } = planCraftingCycle(config, simulation_context, logger);
    const { recipe_lcm, serializable_transfer_plan } = transferPlanOf(config, crafting_cycle_plan, simulation_context);
    const cycle_ticks = crafting_cycle_plan.total_duration.ticks;
    // the hands one output machine gives up a cycle, over all the inserters that take from it
    const first_output_machine_id = output_inserters[0].inserter.source.entity_id.id;
    const output_ids = new Set(all_output_inserters
        .filter(it => it.inserter.source.entity_id.id === first_output_machine_id)
        .map(it => it.inserter.entity_id.id));
    const output_swings_per_cycle = crafting_cycle_plan.entity_transfer_map.entries_array()
        .filter(([entity_id]) => output_ids.has(entity_id.id))
        .reduce((sum, [, planned]) => sum + planned.total_transfer_count.toDecimal(), 0) || 1;
    return {
        transfer_plan: serializable_transfer_plan,
        used_lcm: recipe_lcm,
        output_swings_per_cycle,
        cycle_ticks,
        period_ticks: CraftingCyclePlan.ticksOfCycles(crafting_cycle_plan, recipe_lcm),
    };
}
