import { assertOutputTransferGenerationSupported } from "../../config/output-transfer-generation";
import { Config } from "../../config";
import type { TargetCounts } from "../../config/schema";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { validateCopies } from "../../config/copies-validator";
import { assertLaneCapacity } from "../../config/lane-capacity-validator";
import { SimulationContext } from "../sequence/simulation-context";
import { SerializableTransferPlan } from "../sequence/cycle/swing-counts";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { PrepareStep } from "../runner/steps/prepare-step";
import { Logger } from "../../common/logger";
import { Inserter } from "../../entities";
import { planCraftingCycle, transferPlanOf } from "../plan/plan-run";

/** What validating a config finds out before any clock is generated */
export interface ConfigValidation {
    /** Hands each inserter and drill moves per crafting cycle */
    transfer_plan: SerializableTransferPlan;
    /** Crafting cycles in one clock period: the computed LCM, or the config's override */
    used_lcm: number;
    /**
     * Hands each output inserter takes per crafting cycle, before any backoff a generation may apply; for a target that
     * counts an item destroyed, the hands brought into the machine that destroys it
     */
    output_swings_per_cycle: number;
    /** What the target's rate counts: the item made and taken out, or the item brought in and destroyed */
    counts: TargetCounts;
    cycle_ticks: number;
    period_ticks: number;
}

/**
 * Checks that a clock can be planned for the config and returns that plan, without generating any clock: every
 * ingredient and output has an inserter, the machines can reach the target rate, no belt lane is asked for more than it
 * carries, and every belt that is filled is planned for. Costs one prepare run (the machines crafting until output blocked; a second with the belts backed up
 * where they move, which the output swings are counted on) instead of the hundreds of simulations a generation does. Throws with the reason when the config is not valid.
 *
 * A generation can still end up with another plan than this one: it lowers the output swings when the planned
 * count is unstable, and offers other counts as potential clocks.
 */
export function validateConfig(config: Config, options: { logger?: Logger } = {}): ConfigValidation {
    const logger = options.logger ?? { log: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
    assertOutputTransferGenerationSupported(config);
    assertInserterCoverage(config);
    validateCopies(config);

    const simulation_context = SimulationContext.fromConfig(config);
    // a target that counts an item destroyed is planned by arithmetic: nothing is counted from a run that fills the build
    if (config.target_output.counts !== "destroyed") {
        new PrepareStep(simulation_context).execute();
    }

    const { crafting_cycle_plan, output_inserters, all_output_inserters } = planCraftingCycle(config, simulation_context, logger);
    // the planner has accepted the target: now no belt lane may be asked for more than it carries
    assertLaneCapacity(config);
    const { recipe_lcm, serializable_transfer_plan } = transferPlanOf(config, crafting_cycle_plan, simulation_context);
    const cycle_ticks = crafting_cycle_plan.total_duration.ticks;
    // the hands one output machine gives up a cycle, over all the inserters that take from it; for a target that counts an
    // item destroyed, the hands brought into one machine that destroys it, over all the inserters that bring them (as the
    // clocks are named)
    const destroyed = crafting_cycle_plan.production_rate.counts === "destroyed";
    const machine_of = (it: { inserter: Inserter }) => (destroyed ? it.inserter.sink : it.inserter.source).entity_id.id;
    const first_output_machine_id = machine_of(output_inserters[0]);
    const output_ids = new Set(all_output_inserters
        .filter(it => machine_of(it) === first_output_machine_id)
        .map(it => it.inserter.entity_id.id));
    const output_swings_per_cycle = crafting_cycle_plan.entity_transfer_map.entries_array()
        .filter(([entity_id]) => output_ids.has(entity_id.id))
        .reduce((sum, [, planned]) => sum + planned.total_transfer_count.toDecimal(), 0) || 1;
    return {
        transfer_plan: serializable_transfer_plan,
        used_lcm: recipe_lcm,
        output_swings_per_cycle,
        counts: config.target_output.counts ?? "made",
        cycle_ticks,
        period_ticks: CraftingCyclePlan.ticksOfCycles(crafting_cycle_plan, recipe_lcm),
    };
}
