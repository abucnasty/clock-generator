import { assertMachineResultTargetsSupported } from "../../../config/output-transfer-generation";
import assert from "../../../common/assert";
import Fraction, { fraction } from "../../../data-types/fraction";
import { Duration } from "../../../data-types/duration";
import { TargetProductionRate } from "../../target-production-rate";
import { buildOutputInsertersOf, destroyedTargetCrafts, EntityTransferCountMap } from "./swing-counts";
import { Entity, handSizeFor, ReadableEntityRegistry } from "../../../entities";
import { ConfigOverrides } from "../../../config";
import type { Config } from "../../../config/schema";
import { destroyedTargetBalance, madeTargetBalance, transfersOfBalance } from "./cycle-transfers";
import { FractionalSwingsRefusedError, SwingDistribution, SwingDistributionMap } from "./swing-distribution";
import { returnedTargetRefusal } from "./target-ends";
import type { ExhaustPlan } from "../../exhaust";
import type { ExhaustDecision } from "../../../data-types/build-plan";
import { destroyedTargetBasisOf, exhaustDecisionOf } from "../../planner/exhaust";

export interface OutputCyclePlan {
    /** Duration of a single base cycle (before LCM multiplication) */
    readonly total_duration: Duration;
    /**
     * The same duration in ticks as the fraction it is: a hand over the rate, times the swings of a cycle. A whole
     * number of cycles is multiplied from this (see ticksOfCycles), not from the rounded `total_duration`.
     */
    readonly total_duration_ticks: Fraction;
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
     * Represents how many sub-cycles make up the full extended window cycle.
     * Only set when fractional_swings_enabled is true.
     */
    readonly cycle_multiplier?: number;
    /**
     * Whether the user explicitly set terminal_swing_count in the config overrides.
     * When true and a multi-filter belt→machine inserter has fractional per-item transfers,
     * AlwaysEnabledControl is used instead of the normal latched control.
     */
    readonly terminal_swing_count_overridden: boolean;
    /**
     * A target that counts an item destroyed whose results come too rarely for their takers' hands to come out whole in
     * a window cycle the container they are placed into holds: the windows of those takers by arithmetic, one plan a machine
     * (see exhaust.ts). The cycle is then the whole window cycle, and the takers' hands a cycle are not whole: they are
     * carried from one window to the next. Absent for every other plan.
     */
    readonly exhaust?: readonly ExhaustPlan[];
}

export const OutputCyclePlan = {
    create: createPlan,
    print: print,
    ticksOfCycles: ticksOfCycles,
}

// Internal arithmetic provenance, separate from final-taker aggregate reporting. It adds no serialized plan/API field.
const planned_terminal_counts = new WeakMap<OutputCyclePlan, number>();

export function plannedTerminalSwingCount(plan: OutputCyclePlan): number | undefined {
    return planned_terminal_counts.get(plan);
}

// The plans made with fractional swings asked for, whether or not a swing came out fractional; no serialized field either
const planned_with_fractional_swings = new WeakSet<OutputCyclePlan>();

/**
 * Whether the plan was made with fractional swings asked for (the "Euclidean Swings" alternative): a run of its clock is
 * planned so too. True also where every swing came out whole (`fractional_swings_enabled` false).
 */
export function plannedWithFractionalSwings(plan: OutputCyclePlan): boolean {
    return planned_with_fractional_swings.has(plan);
}

function withPlannedTerminalCount(plan: OutputCyclePlan, count: Fraction): OutputCyclePlan {
    planned_terminal_counts.set(plan, count.toDecimal());
    return plan;
}

/**
 * Ticks that a whole number of base cycles last, which is how a window cycle is made (the cycles of the ingredient
 * LCM). Multiplied as a fraction: 25 cycles of 115.2 ticks are 2880 ticks, where 19.2 * 6 * 25 in floating point is
 * 2879.9999999999995, which is no whole number of ticks to anything that asks.
 */
function ticksOfCycles(plan: Pick<OutputCyclePlan, "total_duration_ticks">, cycles: number): number {
    return plan.total_duration_ticks.multiply(cycles).toDecimal();
}

/**
 * The plan of a target that counts an item destroyed, by plain arithmetic (destroyedTargetBalance): a cycle is
 * the fewest hands of the item brought into each machine that last a whole number of ticks at the target rate (an
 * overridden output swing count sets them instead), and the transfers of every inserter follow from them. Whether the
 * results get windows of their own is the decision `exhaustDecisionOf` makes (planner/exhaust.ts): the one
 * given, as the build plan records it, or made here.
 */
function createDestroyedPlan(
    target_production_rate: TargetProductionRate,
    entity_registry: ReadableEntityRegistry,
    config: Config,
    config_overrides: Partial<ConfigOverrides>,
    decided: ExhaustDecision | undefined,
): OutputCyclePlan {
    const basis = destroyedTargetBasisOf(target_production_rate, entity_registry, config_overrides);
    const { item, machines, ticks_per_hand, forced } = basis;
    const planOf = (hands: number, exhaust?: readonly ExhaustPlan[]): OutputCyclePlan => {
        const window_cycle_ticks = ticks_per_hand.multiply(hands);
        return {
            total_duration: Duration.ofTicks(window_cycle_ticks.toDecimal()),
            total_duration_ticks: window_cycle_ticks,
            entity_transfer_map: transfersOfBalance(destroyedTargetBalance([...machines], entity_registry, config, item, fraction(hands),
                (machine, brought) => destroyedTargetCrafts(machine, entity_registry, item, brought)), entity_registry),
            production_rate: target_production_rate,
            fractional_swings_enabled: false,
            terminal_swing_count_overridden: forced !== undefined,
            ...(exhaust !== undefined && { exhaust }),
        };
    };
    const decision = decided ?? exhaustDecisionOf(target_production_rate, entity_registry, config, config_overrides, basis);
    return decision.kind === "result-windows" ? planOf(decision.hands, decision.plans) : planOf(decision.hands);
}

/**
 * The crafting cycle of a build: for a target that counts an item made, `max_possible_swings` output swings a cycle (whole
 * unless `fractional_swings` asks for the fraction itself); for one that counts an item destroyed, the hands its
 * arithmetic gives, and `exhaust` is the decision of its results' windows where the build plan has made it. The
 * transfers are the balance of the config's planner graph (cycle-transfers.ts); the registry is the one made from it.
 */
function createPlan(
    target_production_rate: TargetProductionRate,
    entity_registry: ReadableEntityRegistry,
    config: Config,
    max_possible_swings: Fraction,
    config_overrides: Partial<ConfigOverrides> = {},
    exhaust?: ExhaustDecision,
    /** The "Euclidean Swings" alternative's planning: swings a cycle as the fraction the machines make, alternated over sub-cycles */
    fractional_swings: boolean = false,
): OutputCyclePlan {
    assertMachineResultTargetsSupported(entity_registry);
    if (target_production_rate.counts === "destroyed") {
        return createDestroyedPlan(target_production_rate, entity_registry, config, config_overrides, exhaust);
    }
    const plan = createMadePlan(target_production_rate, entity_registry, config, max_possible_swings, config_overrides, fractional_swings);
    if (fractional_swings) {
        planned_with_fractional_swings.add(plan);
    }
    return plan;
}

function createMadePlan(
    target_production_rate: TargetProductionRate,
    entity_registry: ReadableEntityRegistry,
    config: Config,
    max_possible_swings: Fraction,
    config_overrides: Partial<ConfigOverrides>,
    fractional_swings: boolean,
): OutputCyclePlan {
    const returned = returnedTargetRefusal({ item: target_production_rate.machine_production_rate.item, counts: "made" },
        target_production_rate.total_production_rate.amount_per_second.toDecimal(), entity_registry);
    if (returned !== null) {
        throw new Error(returned);
    }

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
        const inserter = buildOutputInsertersOf(machine, entity_registry)[0];
        assert(
            inserter !== undefined, 
            `No inserter found that takes output from machine ${machine.entity_id.id}`
        );
        return inserter;
    });

    // All output inserters should have the same stack size for consistent cycle timing
    const output_item = target_production_rate.machine_production_rate.item;
    const output_stack_size = handSizeFor(output_inserters[0], output_item);
    for (const inserter of output_inserters) {
        assert(
            handSizeFor(inserter, output_item) === output_stack_size,
            `All output inserters must have the same stack size. ` +
            `Expected ${output_stack_size} but found ${handSizeFor(inserter, output_item)} on inserter for machine ${inserter.source.entity_id.id}`
        );
    }

    // Calculate the single swing window cycle based on the actual machine production rate.
    // With multiple output machines, each machine produces at its own rate, and we need
    // the cycle duration to be based on how long it takes ONE machine to produce a stack.
    // 
    // The target_production_rate.machine_production_rate is the target for the whole setup,
    // so we need to divide by the number of output machines to get the per-machine rate.
    const num_output_machines = output_machines.length;
    const per_machine_rate = target_production_rate.machine_production_rate.amount_per_tick
        .divide(num_output_machines);
    
    const single_swing_window_cycle_ticks = fraction(output_stack_size).divide(per_machine_rate);

    // Determine swings per cycle - either fractional or integer
    let swings_per_cycle: Fraction;
    
    if (fractional_swings) { // fractional swing strategy
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

        assert(Number.isInteger(swings_per_single_cycle), `Swings per single output cycle must be an integer but got ${swings_per_single_cycle}`);
        swings_per_cycle = fraction(swings_per_single_cycle);
    }

    // kept as a fraction: the product of the two as floating point numbers can miss a whole number of ticks
    const final_window_cycle_ticks = single_swing_window_cycle_ticks.multiply(swings_per_cycle);
    const final_window_cycle_duration = Duration.ofTicks(final_window_cycle_ticks.toDecimal())

    // Compute swing counts for all output machines
    // Each output machine handles the same swing count per machine
    const swing_counts = transfersOfBalance(madeTargetBalance(
        output_machines,
        entity_registry,
        config,
        swings_per_cycle,
        output_stack_size,
        final_window_cycle_duration.ticks
    ), entity_registry)

    // Compute swing distributions if fractional swings are enabled
    if (fractional_swings) {
        const cycle_multiplier = EntityTransferCountMap.lcm(swing_counts);
        
        // Only compute distributions if there are actual fractional swings (LCM > 1)
        if (cycle_multiplier > 1) {
            const swing_distribution = distributionsAt(swings_per_cycle, () => SwingDistribution.computeSwingDistributions(
                swing_counts,
                entity_registry,
                cycle_multiplier
            ));

            return withPlannedTerminalCount({
                total_duration: final_window_cycle_duration,
                total_duration_ticks: final_window_cycle_ticks,
                entity_transfer_map: swing_counts.clone(),
                production_rate: target_production_rate,
                fractional_swings_enabled: true,
                swing_distribution,
                cycle_multiplier,
                terminal_swing_count_overridden: config_overrides.terminal_swing_count !== undefined
            }, swings_per_cycle);
        }
    }

    return withPlannedTerminalCount({
        total_duration: final_window_cycle_duration,
        total_duration_ticks: final_window_cycle_ticks,
        entity_transfer_map: swing_counts.clone(),
        production_rate: target_production_rate,
        fractional_swings_enabled: false,
        terminal_swing_count_overridden: config_overrides.terminal_swing_count !== undefined
    }, swings_per_cycle);
}

/** The swing distributions, a refusal of the insertion limits rethrown with the output swings a cycle it was planned at */
function distributionsAt(swings_per_cycle: Fraction, distributions: () => SwingDistributionMap): SwingDistributionMap {
    try {
        return distributions();
    } catch (error) {
        if (error instanceof FractionalSwingsRefusedError) {
            throw new FractionalSwingsRefusedError(error.message, swings_per_cycle);
        }
        throw error;
    }
}

function print(plan: OutputCyclePlan): void {
    console.log("----------------------")
    console.log(`Output Cycle Plan:`)
    console.log(`- Total Duration: ${plan.total_duration.ticks} ticks`)
    console.log(`- Entity Swing Counts:`)
    plan.entity_transfer_map.entries_array().forEach(([entityId, transfer]) => {
        const items = transfer.item_transfers.map(it => `${it.item_name} (${it.transfer_count})`).join(", ");
        console.log(`  - ${entityId}: ${transfer.total_transfer_count} total swings [${items}] (stack size: ${transfer.stack_size})`)
    })
    console.log("----------------------")
}
