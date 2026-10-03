import assert from "../../../common/assert";
import Fraction, { fraction } from "fractionability";
import { Duration } from "../../../data-types/duration";
import { TargetProductionRate } from "../../target-production-rate";
import { EntityTransferCountMap } from "./swing-counts";
import { Entity, ReadableEntityRegistry } from "../../../entities";
import { ConfigOverrides } from "../../../config";
import { SwingDistribution, SwingDistributionMap } from "./swing-distribution";

export interface CraftingCyclePlan {
    /** Duration of a single base cycle (before LCM multiplication) */
    readonly total_duration: Duration;
    /** Map of entity IDs to their transfer counts per base cycle */
    readonly entity_transfer_map: EntityTransferCountMap;
    /** Target production rate configuration */
    readonly production_rate: TargetProductionRate;
    /** 
     * Whether fractional swings are enabled.
     * When true, swing_distribution will contain per-sub-cycle swing counts.
     */
    readonly fractional_swings_enabled: boolean;
    /**
     * Swing distribution map for fractional swings.
     * Only populated when fractional_swings_enabled is true.
     * Maps entity ID string to SwingDistribution containing per-sub-cycle counts.
     */
    readonly swing_distribution?: SwingDistributionMap;
    /**
     * The cycle multiplier (LCM of swing denominators) for fractional swings.
     * Represents how many sub-cycles make up the full extended period.
     * Only set when fractional_swings_enabled is true.
     */
    readonly cycle_multiplier?: number;
    /**
     * Whether the user explicitly set terminal_swing_count in the config overrides.
     * When true and a multi-filter belt→machine inserter has fractional per-item transfers,
     * AlwaysEnabledControl is used instead of the normal latched control.
     */
    readonly terminal_swing_count_overridden: boolean;
}

export const CraftingCyclePlan = {
    create: createPlan,
    print: print,
}

function createPlan(
    target_production_rate: TargetProductionRate,
    entity_registry: ReadableEntityRegistry,
    max_possible_swings: Fraction,
    config_overrides: Partial<ConfigOverrides> = {}
): CraftingCyclePlan {

    const output_machines = entity_registry
        .getAll()
        .filter(Entity.isMachine)
        .filter(it => it.output.item_name === target_production_rate.machine_production_rate.item)

    assert(
        output_machines.length > 0, 
        `No machine found that produces item ${target_production_rate.machine_production_rate.item}`
    );

    // Find output inserters for each output machine
    const output_inserters = output_machines.map(machine => {
        const inserter = entity_registry
            .getAll()
            .filter(Entity.isInserter)
            .find(inserter => inserter.source.entity_id.id === machine.entity_id.id);
        assert(
            inserter !== undefined, 
            `No inserter found that takes output from machine ${machine.entity_id.id}`
        );
        return inserter;
    });

    // All output inserters should have the same stack size for consistent cycle timing
    const output_stack_size = output_inserters[0].metadata.stack_size;
    for (const inserter of output_inserters) {
        assert(
            inserter.metadata.stack_size === output_stack_size,
            `All output inserters must have the same stack size. ` +
            `Expected ${output_stack_size} but found ${inserter.metadata.stack_size} on inserter for machine ${inserter.source.entity_id.id}`
        );
    }

    // Calculate the single swing period based on the actual machine production rate.
    // With multiple output machines, each machine produces at its own rate, and we need
    // the cycle duration to be based on how long it takes ONE machine to produce a stack.
    // 
    // The target_production_rate.machine_production_rate is the target for the whole setup,
    // so we need to divide by the number of output machines to get the per-machine rate.
    const num_output_machines = output_machines.length;
    const per_machine_rate = target_production_rate.machine_production_rate.amount_per_tick
        .divide(num_output_machines);
    
    const single_swing_period_duration = Duration.ofTicks(
        fraction(output_stack_size)
            .divide(per_machine_rate)
            .toDecimal()
    )

    const use_fractional_swings = config_overrides.use_fractional_swings ?? false;
    
    // Determine swings per cycle - either fractional or integer
    let swings_per_cycle: Fraction;
    
    if (use_fractional_swings) { // fractional swing strategy
        // Fractional mode: use the raw fraction without rounding
        if (config_overrides.terminal_swing_count !== undefined) {
            swings_per_cycle = fraction(config_overrides.terminal_swing_count);
        } else {
            swings_per_cycle = max_possible_swings;
        }
    } else { // integer swing strategy        
        let swings_per_single_cycle = 1;

        if (max_possible_swings.toDecimal() >= 2) {
            swings_per_single_cycle = Math.floor(max_possible_swings.toDecimal());
        } else {
            // only single swing outputs are supported when max swings are less than 2
            // in order to support fractional swings, the timing is going to have to be scheduled based on the crafting
            // speed of the machine in order for it to be fully stable
            swings_per_single_cycle = 1;
        }

        if (config_overrides.terminal_swing_count !== undefined) {
            swings_per_single_cycle = config_overrides.terminal_swing_count;
        }

        assert(Number.isInteger(swings_per_single_cycle), `Swings per single cycle must be an integer but got ${swings_per_single_cycle}`);
        swings_per_cycle = fraction(swings_per_single_cycle);
    }

    const final_period_duration = Duration.ofTicks(single_swing_period_duration.ticks * swings_per_cycle.toDecimal())

    // Compute swing counts for all output machines
    // Each output machine handles the same swing count per machine
    const swing_counts = EntityTransferCountMap.create(
        output_machines,
        entity_registry,
        swings_per_cycle,
        output_stack_size,
        final_period_duration.ticks
    )

    // Compute swing distributions if fractional swings are enabled
    if (use_fractional_swings) {
        const cycle_multiplier = EntityTransferCountMap.lcm(swing_counts);
        
        // Only compute distributions if there are actual fractional swings (LCM > 1)
        if (cycle_multiplier > 1) {
            const swing_distribution = SwingDistribution.computeSwingDistributions(
                swing_counts,
                entity_registry,
                cycle_multiplier
            );

            return {
                total_duration: final_period_duration,
                entity_transfer_map: swing_counts.clone(),
                production_rate: target_production_rate,
                fractional_swings_enabled: true,
                swing_distribution,
                cycle_multiplier,
                terminal_swing_count_overridden: config_overrides.terminal_swing_count !== undefined
            }
        }
    }

    return {
        total_duration: final_period_duration,
        entity_transfer_map: swing_counts.clone(),
        production_rate: target_production_rate,
        fractional_swings_enabled: false,
        terminal_swing_count_overridden: config_overrides.terminal_swing_count !== undefined
    }
}

function print(plan: CraftingCyclePlan): void {
    console.log("----------------------")
    console.log(`Crafting Cycle Plan:`)
    console.log(`- Total Duration: ${plan.total_duration.ticks} ticks`)
    console.log(`- Entity Transfer Counts:`)
    plan.entity_transfer_map.entries_array().forEach(([entityId, transfer]) => {
        const items = transfer.item_transfers.map(it => `${it.item_name} (${it.transfer_count})`).join(", ");
        console.log(`  - ${entityId}: ${transfer.total_transfer_count} total transfers [${items}] (stack size: ${transfer.stack_size})`)
    })
    console.log("----------------------")
}