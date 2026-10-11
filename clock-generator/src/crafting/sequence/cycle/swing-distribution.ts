import assert from "../../../common/assert";
import { assertIsInserter, assertIsMachine, Entity, EntityId, ReadableEntityRegistry } from "../../../entities";
import { EntityTransferCount, EntityTransferCountMap } from "./swing-counts";

/** Practical upper limit when swings are effectively unlimited */
const MAX_SWINGS_UNLIMITED = 100;

/**
 * Represents the distribution of swings across multiple sub-cycles.
 * For a fraction like 3/2, this would contain [1, 2] meaning:
 * - Sub-cycle 0: 1 swing
 * - Sub-cycle 1: 2 swings
 */
export interface SwingDistribution {
    /** The entity this distribution applies to */
    readonly entity_id: EntityId;
    /** Number of swings per sub-cycle (array length = cycle_multiplier) */
    readonly swings_per_subcycle: number[];
    /** Total swings across all sub-cycles (numerator of the fraction) */
    readonly total_swings: number;
    /** Number of sub-cycles (denominator of the fraction) */
    readonly cycle_multiplier: number;
}

/**
 * Capacity constraints for computing swing distribution.
 */
export interface SwingCapacityConstraints {
    /** Automated insertion limit for the target machine input */
    readonly automated_insertion_limit: number;
    /** Consumption rate per tick for the input item */
    readonly consumption_rate_per_tick: number;
    /** Inserter stack size */
    readonly stack_size: number;
    /** Inserter total animation ticks */
    readonly animation_total_ticks: number;
}

/**
 * Computes the maximum number of swings possible in a single sub-cycle,
 * accounting for automated_insertion_limit and consumption during swing animation.
 * 
 * The key insight is that during each swing animation, the machine consumes items,
 * freeing up inventory space for subsequent swings.
 * 
 * Peak inventory occurs right after a swing completes insertion, before consumption
 * during the next swing:
 * - After swing 1: effective_stack_size items (peak before any consumption)
 * - After swing N: N * effective_stack_size - (N-1) * items_consumed_per_swing
 * 
 * Note: effective_stack_size is min(stack_size, automated_insertion_limit) because
 * inserters will only transfer up to the available space in the machine.
 * 
 * @param constraints The capacity constraints for this inserter/machine pair
 * @returns Maximum swings that can occur in a single sub-cycle without overflow
 */
export function computeMaxSwingsPerSubCycle(constraints: SwingCapacityConstraints): number {
    const { 
        automated_insertion_limit, 
        consumption_rate_per_tick, 
        stack_size, 
        animation_total_ticks 
    } = constraints;

    // Inserters only transfer up to the available space, so effective stack size
    // is capped by the automated insertion limit
    const effective_stack_size = Math.min(stack_size, automated_insertion_limit);
    
    // If effective stack size is 0, no swings are possible
    if (effective_stack_size <= 0) {
        return 0;
    }

    // Items consumed during one full swing animation
    const items_consumed_per_swing = consumption_rate_per_tick * animation_total_ticks;
    
    // If consumption per swing >= effective_stack_size, inventory never accumulates
    if (items_consumed_per_swing >= effective_stack_size) {
        return MAX_SWINGS_UNLIMITED;
    }

    // Net inventory increase per swing after the first
    const net_items_per_swing = effective_stack_size - items_consumed_per_swing;
    
    // Peak inventory after N swings: effective_stack_size + (N-1) * net_items_per_swing
    // Constraint: effective_stack_size + (N-1) * net_items_per_swing <= automated_insertion_limit
    // Solving: N <= 1 + (automated_insertion_limit - effective_stack_size) / net_items_per_swing
    
    const additional_swings = Math.floor(
        (automated_insertion_limit - effective_stack_size) / net_items_per_swing
    );
    
    return 1 + additional_swings;
}

/**
 * Creates an alternating swing distribution for a fractional swing count.
 * 
 * Alternating means we distribute extra swings in a repeating pattern.
 * For 6 swings over 4 cycles, this produces [1, 2, 1, 2] instead of [1, 1, 2, 2].
 * For 3 swings over 2 cycles, this produces [1, 2].
 * 
 * The pattern repeats based on the remainder. If we have 6 swings over 4 cycles:
 * - Base: 6/4 = 1 swing per cycle
 * - Remainder: 6 % 4 = 2 extra swings to distribute
 * - Pattern period: 4 / gcd(4, 2) = 2
 * - Result: [1, 2, 1, 2] (alternates every cycle)
 * 
 * @param total_swings Total swings to distribute (numerator)
 * @param cycle_multiplier Number of sub-cycles to distribute across (denominator)
 * @param max_swings_per_subcycle Maximum swings allowed in any single sub-cycle
 * @returns Array of swing counts per sub-cycle
 * @throws Error if constraints cannot be satisfied
 */
export function createAlternatingDistribution(
    total_swings: number,
    cycle_multiplier: number,
    max_swings_per_subcycle: number
): number[] {
    assert(total_swings > 0, "Total swings must be positive");
    assert(cycle_multiplier > 0, "Cycle multiplier must be positive");
    assert(Number.isInteger(total_swings), "Total swings must be an integer");
    assert(Number.isInteger(cycle_multiplier), "Cycle multiplier must be an integer");

    const base_swings = Math.floor(total_swings / cycle_multiplier);
    const remainder = total_swings % cycle_multiplier;
    
    if (remainder === 0) {
        // Evenly divisible - all cycles get the same number
        const distribution = Array(cycle_multiplier).fill(base_swings);
        if (base_swings > max_swings_per_subcycle) {
            throw new Error(
                `Cannot satisfy fractional swing constraint: each sub-cycle requires ${base_swings} swings, ` +
                `but maximum allowed is ${max_swings_per_subcycle} due to insertion limits. ` +
                `Total swings: ${total_swings}, cycle multiplier: ${cycle_multiplier}.`
            );
        }
        return distribution;
    }
    
    // Use Bresenham-like distribution to spread extra swings evenly
    const distribution: number[] = [];
    let accumulator = 0;
    
    for (let i = 0; i < cycle_multiplier; i++) {
        accumulator += remainder;
        const extra = accumulator >= cycle_multiplier ? 1 : 0;
        if (extra) {
            accumulator -= cycle_multiplier;
        }
        const swings = base_swings + extra;
        
        if (swings > max_swings_per_subcycle) {
            throw new Error(
                `Cannot satisfy fractional swing constraint: sub-cycle ${i} requires ${swings} swings, ` +
                `but maximum allowed is ${max_swings_per_subcycle} due to insertion limits. ` +
                `Total swings: ${total_swings}, cycle multiplier: ${cycle_multiplier}.`
            );
        }
        
        distribution.push(swings);
    }
    
    return distribution;
}

/**
 * Computes swing distributions for all entities in the transfer map.
 * 
 * @param entity_transfer_map Map of entity IDs to transfer counts
 * @param entity_registry Registry to look up entity details
 * @param cycle_multiplier The LCM-derived multiplier for the number of sub-cycles
 * @returns Map of entity ID to swing distribution
 */
export function computeSwingDistributions(
    entity_transfer_map: EntityTransferCountMap,
    entity_registry: ReadableEntityRegistry,
    cycle_multiplier: number
): Map<string, SwingDistribution> {
    const distributions = new Map<string, SwingDistribution>();
    
    for (const [entity_id, transfer_count] of entity_transfer_map.entries()) {
        const distribution = computeSwingDistributionForEntity(
            entity_id,
            transfer_count,
            entity_registry,
            cycle_multiplier
        );
        distributions.set(entity_id.id, distribution);
    }
    
    return distributions;
}

/**
 * Computes swing distribution for a single entity.
 */
function computeSwingDistributionForEntity(
    entity_id: EntityId,
    transfer_count: EntityTransferCount,
    entity_registry: ReadableEntityRegistry,
    cycle_multiplier: number
): SwingDistribution {
    const entity = transfer_count.entity;
    
    // Calculate total swings across all sub-cycles
    // The transfer_count.total_transfer_count is the fractional count per base cycle
    // Multiply by cycle_multiplier to get total swings across the extended period
    const total_swings_fraction = transfer_count.total_transfer_count.multiply(cycle_multiplier);
    const total_swings = Math.round(total_swings_fraction.toDecimal());
    
    // For output inserters (belt sink), there's no insertion limit constraint
    if (Entity.isDrill(entity)) {
        // Mining drill - use simpler distribution without capacity constraints
        const distribution = createAlternatingDistribution(
            total_swings,
            cycle_multiplier,
            MAX_SWINGS_UNLIMITED // No practical limit for drills
        );
        
        return {
            entity_id,
            swings_per_subcycle: distribution,
            total_swings,
            cycle_multiplier
        };
    }
    
    const inserter = entity;
    assertIsInserter(inserter);
    
    // Check if sink is a machine (has insertion limits) or belt (no limits)
    const sink_entity = entity_registry.getEntityByIdOrThrow(inserter.sink.entity_id);
    
    if (Entity.isBelt(sink_entity) || Entity.isChest(sink_entity)) {
        // Sink is a belt or chest, no insertion limit constraints
        const distribution = createAlternatingDistribution(
            total_swings,
            cycle_multiplier,
            // No practical limit for belts or chests
            // Belts could in theory have a constraint but that depends on eventually
            // modellling the spacing between belts appropriately or take into account the speed of the belt
            MAX_SWINGS_UNLIMITED
        );
        
        return {
            entity_id,
            swings_per_subcycle: distribution,
            total_swings,
            cycle_multiplier
        };
    }
    
    // Sink is a machine - compute constraints
    const sink_machine = sink_entity;
    assertIsMachine(sink_machine);
    
    // Find the relevant input item (use first item transfer as primary)
    const primary_item = transfer_count.item_transfers[0]?.item_name;
    if (!primary_item) {
        throw new Error(`No item transfers found for entity ${entity_id.id}`);
    }
    
    const machine_input = sink_machine.getInsertableInput(primary_item);
    if (!machine_input) {
        throw new Error(`Machine ${sink_machine.entity_id.id} has no input for item ${primary_item}`);
    }
    
    const constraints: SwingCapacityConstraints = {
        automated_insertion_limit: machine_input.automated_insertion_limit.quantity,
        consumption_rate_per_tick: machine_input.consumption_rate.rate_per_tick,
        stack_size: inserter.metadata.stack_size,
        animation_total_ticks: inserter.animation.total.ticks
    };
    
    const max_swings = computeMaxSwingsPerSubCycle(constraints);
    
    const distribution = createAlternatingDistribution(
        total_swings,
        cycle_multiplier,
        max_swings
    );
    
    return {
        entity_id,
        swings_per_subcycle: distribution,
        total_swings,
        cycle_multiplier
    };
}

/**
 * Type guard for SwingDistribution map.
 */
export type SwingDistributionMap = Map<string, SwingDistribution>;

export const SwingDistribution = {
    computeMaxSwingsPerSubCycle,
    createAlternatingDistribution,
    computeSwingDistributions,
};
