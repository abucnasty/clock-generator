import { assertOutputTransferGenerationSupported } from "../config/output-transfer-generation";
import assert from "../common/assert";
import { Config } from "../config";
import { assertInserterCoverage } from "../config/inserter-coverage-validator";
import { validateCopies } from "../config/copies-validator";
import { assertFeasible } from "./feasibility/assert-feasible";
import { fraction } from "../data-types/fraction";
import { Entity, handSizeFor } from "../entities";
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
    const taken = new Map<string, number>();
    // a machine that places its results itself into a container: what is taken out of the container is what it made
    const placing = new Map(registry.getAll().filter(Entity.isMachine).flatMap(machine =>
        machine.result_target === undefined ? [] : [[machine.result_target.id, machine] as const]));
    for (const transfer of cycle.entity_transfer_map.values()) {
        if (!Entity.isInserter(transfer.entity)) continue;
        const from = registry.getEntityByIdOrThrow(transfer.entity.source.entity_id);
        const source = Entity.isMachine(from) ? from : placing.get(from.entity_id.id);
        if (source === undefined) continue;
        const product = transfer.item_transfers.find(item => item.item_name === source.output.item_name);
        if (!product) continue;
        const rate = product.transfer_count.multiply(handSizeFor(transfer.entity, source.output.item_name))
            .divide(seconds).toDecimal();
        taken.set(source.entity_id.id, (taken.get(source.entity_id.id) ?? 0) + rate);
    }
    const machines = registry.getAll().filter(Entity.isMachine);
    const counted = new Set<string>();
    const countPlaced = (machine: typeof machines[number]): void => {
        if (counted.has(machine.entity_id.id)) return;
        counted.add(machine.entity_id.id);
        const sink = machines.find(target => target.entity_id.id === machine.result_target?.id);
        if (!sink) return;
        countPlaced(sink);
        const output = machine.outputs.find(result => sink.inputs.has(result.item_name))!;
        const needed = sink.inputs.getOrThrow(output.item_name).ingredient.amount;
        const crafts = (taken.get(sink.entity_id.id) ?? 0) / sink.output.amount_per_craft.toDecimal();
        taken.set(machine.entity_id.id, crafts * needed / output.amount_per_craft.toDecimal() * machine.output.amount_per_craft.toDecimal());
    };
    machines.forEach(countPlaced);
    return machines.map(machine => {
        const rate = taken.get(machine.entity_id.id) ?? 0;
        const capacity = machine.output.production_rate.amount_per_second.toDecimal();
        assert(Number.isFinite(rate) && rate >= 0 && capacity > 0,
            `Cannot calculate at-target rates for Machine ${machine.entity_id.number}.`);
        return { machine_id: machine.entity_id.number, output_rate_per_second: rate, crafting_share: rate / capacity,
            outputs: machine.outputs.map(output => ({ item_name: output.item_name,
                rate_per_second: output.production_rate.amount_per_second.toDecimal() * rate / capacity })) };
    });
}
