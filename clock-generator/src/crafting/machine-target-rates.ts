import assert from "../common/assert";
import { Config } from "../config";
import { assertInserterCoverage } from "../config/inserter-coverage-validator";
import { validateCopies } from "../config/copies-validator";
import { fraction } from "../data-types/fraction";
import { Entity, handSizeFor } from "../entities";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";

export interface MachineTargetRate {
    machine_id: number;
    /** Planned main-product rate for one machine in one copy of the build. */
    output_rate_per_second: number;
    /** Demand / capacity; may exceed 1 when the requested target is too high. */
    crafting_share: number;
}

/**
 * Steady-state demand at the requested target, using the clock planner's routing, productivity,
 * fuel and recipe-loop accounting. A single output swing fixes the units; its size cancels when
 * converted to items/second. No prepare simulation or clock search is needed for this preview.
 */
export function computeMachineTargetRates(config: Config): MachineTargetRate[] {
    validateCopies(config);
    assert(Number.isFinite(config.target_output.items_per_second) && config.target_output.items_per_second > 0,
        "Set a positive target output rate to see at-target rates.");
    assertInserterCoverage(config);
    const registry = createEntityRegistryFromConfig(config);
    const target = TargetProductionRate.fromConfig(config.target_output);
    const cycle = CraftingCyclePlan.create(target, registry, fraction(1));
    const seconds = cycle.total_duration_ticks.divide(60);
    const taken = new Map<string, number>();
    for (const transfer of cycle.entity_transfer_map.values()) {
        if (!Entity.isInserter(transfer.entity)) continue;
        const source = registry.getEntityByIdOrThrow(transfer.entity.source.entity_id);
        if (!Entity.isMachine(source)) continue;
        const product = transfer.item_transfers.find(item => item.item_name === source.output.item_name);
        if (!product) continue;
        const rate = product.transfer_count.multiply(handSizeFor(transfer.entity, source.output.item_name))
            .divide(seconds).toDecimal();
        taken.set(source.entity_id.id, (taken.get(source.entity_id.id) ?? 0) + rate);
    }
    return registry.getAll().filter(Entity.isMachine).map(machine => {
        const rate = taken.get(machine.entity_id.id) ?? 0;
        const capacity = machine.output.production_rate.amount_per_second.toDecimal();
        assert(Number.isFinite(rate) && rate >= 0 && capacity > 0,
            `Cannot calculate at-target rates for Machine ${machine.entity_id.number}.`);
        return { machine_id: machine.entity_id.number, output_rate_per_second: rate, crafting_share: rate / capacity };
    });
}
