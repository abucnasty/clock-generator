import { assertOutputTransferGenerationSupported } from "../config/output-transfer-generation";
import assert from "../common/assert";
import { Config } from "../config";
import { assertInserterCoverage } from "../config/inserter-coverage-validator";
import { validateCopies } from "../config/copies-validator";
import { assertFeasible } from "./feasibility/assert-feasible";
import { fraction } from "../data-types/fraction";
import { Entity } from "../entities";
import { decimalOf } from "../entities/traits/ratio";
import { handOfItem, traitsOf, traitsOfMachine } from "../entities/traits/traits-of";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";

export interface MachineTargetRate {
    machine_id: number;
    /** Expected rates of every correlated result at the same planned crafting share. */
    outputs: { item_name: string; rate_per_second: number }[];
    /** Planned main-product rate for one machine in one copy of the build. */
    output_rate_per_second: number;
    /** Demand / capacity; may exceed 1 when the requested target is too high. */
    crafting_share: number;
}

/**
 * Steady-state demand at the requested target, using the clock planner's routing, productivity,
 * fuel and recipe-loop accounting. A machine that places its results itself into a container (a recycler with a
 * result target) makes what its plan takes out of that container. A single output swing fixes the units; its size cancels when
 * converted to items/second. No prepare simulation or clock search is needed for this preview.
 *
 * The plan is the entity registry's; what each machine makes, uses and places, and each inserter's hand, are read from
 * the config's traits: the Yield (rates a second, amounts a craft), the Production (amounts a craft of the ingredients),
 * the Placement (a placer's target and where each result lands in it: placements as edges) and the Hand.
 */
export function computeMachineTargetRates(config: Config): MachineTargetRate[] {
    assertOutputTransferGenerationSupported(config);
    validateCopies(config);
    assert(Number.isFinite(config.target_output.items_per_second) && config.target_output.items_per_second > 0,
        "Set a positive target output rate to see at-target rates.");
    assertInserterCoverage(config);
    assertFeasible(config);
    const registry = createEntityRegistryFromConfig(config);
    const target = TargetProductionRate.fromConfig(config.target_output);
    const cycle = CraftingCyclePlan.create(target, registry, fraction(1));
    const seconds = cycle.total_duration_ticks.divide(60);
    const traits = traitsOf(config);
    // the machines in the registry's order, each with its traits
    const machines = registry.getAll().filter(Entity.isMachine).map(machine => ({ id: machine.entity_id, traits: traitsOfMachine(traits, machine.entity_id.id) }));
    type PlannedMachine = typeof machines[number];
    const machine_by_id = new Map(machines.map(machine => [machine.id.id, machine]));
    const taken = new Map<string, number>();
    // a machine that places its results itself into a container: what is taken out of the container is what it made
    const placing = new Map(machines.flatMap(machine => {
        const placed_into = machine.traits.placement?.target ?? null;
        return placed_into === null ? [] : [[placed_into, machine] as const];
    }));
    for (const transfer of cycle.entity_transfer_map.values()) {
        if (!Entity.isInserter(transfer.entity)) continue;
        const from = registry.getEntityByIdOrThrow(transfer.entity.source.entity_id);
        const source = Entity.isMachine(from) ? machine_by_id.get(from.entity_id.id) : placing.get(from.entity_id.id);
        if (source === undefined) continue;
        const main = source.traits.yield.results[0];
        const product = transfer.item_transfers.find(item => item.item_name === main.item);
        if (!product) continue;
        const rate = product.transfer_count.multiply(handOfItem(traits, transfer.entity.entity_id.id, main.item))
            .divide(seconds).toDecimal();
        taken.set(source.id.id, (taken.get(source.id.id) ?? 0) + rate);
    }
    const counted = new Set<string>();
    // a machine placing into a machine (a placement edge into its ingredients) makes what that machine's crafts take
    const countPlaced = (machine: PlannedMachine): void => {
        if (counted.has(machine.id.id)) return;
        counted.add(machine.id.id);
        const placement = machine.traits.placement;
        const sink = placement?.target == null ? undefined : machine_by_id.get(placement.target);
        if (!sink) return;
        countPlaced(sink);
        const placed = placement!.per_result.findIndex(result => result.lands_in === "ingredients");
        assert(placed >= 0, `Machine ${machine.id.number} places none of its results into the ingredients of Machine ${sink.id.number}.`);
        const output = machine.traits.yield.results[placed];
        const needed = sink.traits.production.inputs.find(input => input.item === output.item)!.per_craft;
        const crafts = (taken.get(sink.id.id) ?? 0) / sink.traits.yield.results[0].expected_per_craft;
        taken.set(machine.id.id, crafts * needed / output.expected_per_craft * machine.traits.yield.results[0].expected_per_craft);
    };
    machines.forEach(countPlaced);
    return machines.map(machine => {
        const rate = taken.get(machine.id.id) ?? 0;
        const results = machine.traits.yield.results;
        const capacity = decimalOf(results[0].per_second);
        assert(Number.isFinite(rate) && rate >= 0 && capacity > 0,
            `Cannot calculate at-target rates for Machine ${machine.id.number}.`);
        return { machine_id: machine.id.number, output_rate_per_second: rate, crafting_share: rate / capacity,
            outputs: results.map(result => ({ item_name: result.item,
                rate_per_second: decimalOf(result.per_second) * rate / capacity })) };
    });
}
