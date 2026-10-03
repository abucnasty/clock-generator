import Fraction from "fractionability";
import { Chest, Entity, EntityId, Inserter, InserterStackSize, Machine, MiningDrill, ReadableEntityRegistry } from "../../../entities";
import assert from "../../../common/assert";
import { MachineIngredientRatios } from "./machine-ratios";
import * as math from "mathjs"
import { MapExtended } from "../../../data-types";
import { Logger, defaultLogger } from "../../../common/logger";

export interface ItemTransfer {
    item_name: string;
    transfer_count: Fraction;
}

export interface EntityTransferCount {
    entity: Inserter | MiningDrill;
    item_transfers: ItemTransfer[];
    total_transfer_count: Fraction;
    stack_size: number;
}

// ============================================================================
// Serializable transfer plan types (for UI)
// ============================================================================

export interface SerializableItemTransfer {
    item_name: string;
    /** Numerator of the transfer count fraction */
    numerator: number;
    /** Denominator of the transfer count fraction */
    denominator: number;
}

export interface SerializableEntityTransferCount {
    entity_id: string;
    entity_type: 'inserter' | 'drill';
    item_transfers: SerializableItemTransfer[];
    stack_size: number;
}

export interface SerializableTransferPlan {
    entities: SerializableEntityTransferCount[];
    /** The computed LCM before any manual override from config.overrides.lcm */
    computed_lcm: number;
}

export class EntityTransferCountMap extends MapExtended<EntityId, EntityTransferCount> {

    public static create = computeInserterSwingCountsForMultipleMachines
    public static createForSingleMachine = computeInserterSwingCounts
    public static lcm = computeLCM
    public static print = printInserterSwingCounts
    public static divide = divideTransfers
    public static serialize = serializeTransferPlan

    public static fromEntries(entries: [EntityId, EntityTransferCount][]): EntityTransferCountMap {
        return new EntityTransferCountMap(entries);
    }

    constructor(entries?: readonly (readonly [EntityId, EntityTransferCount])[] | null) {
        super(entries);
    }
}

/**
 * Computes swing counts for multiple output machines producing the same item.
 * Each output machine is assumed to handle an equal share of the total production.
 * Each output machine must have its own dedicated output inserter.
 * 
 * @param output_machines - Array of machines that produce the target output item
 * @param entity_registry - Registry containing all entities
 * @param output_swing_count_per_machine - The number of swings for each output inserter (per machine)
 * @param output_stack_size - The stack size of the output inserters
 * @returns Combined map of entity IDs to their swing count information
 * @throws Error if any output machine lacks a dedicated output inserter
 */
function computeInserterSwingCountsForMultipleMachines(
    output_machines: Machine[],
    entity_registry: ReadableEntityRegistry,
    output_swing_count_per_machine: Fraction,
    output_stack_size: number
): EntityTransferCountMap {
    assert(output_machines.length > 0, "At least one output machine is required");

    // Find all output inserters for each machine
    const output_inserters_by_machine = new Map<string, Inserter[]>();
    for (const machine of output_machines) {
        const inserters = entity_registry.getAll()
            .filter(Entity.isInserter)
            .filter(inserter => inserter.source.entity_id.id === machine.entity_id.id);
        output_inserters_by_machine.set(machine.entity_id.id, inserters);
    }

    // Validate each machine has at least one output inserter and all have the same stack size
    for (const machine of output_machines) {
        const inserters = output_inserters_by_machine.get(machine.entity_id.id) ?? [];
        assert(
            inserters.length >= 1,
            `Output machine ${machine.entity_id.id} must have at least one dedicated output inserter, ` +
            `but found ${inserters.length}.`
        );

        // Validate all output inserters have the same stack size
        const first_stack_size = inserters[0].metadata.stack_size;
        for (const inserter of inserters) {
            assert(
                inserter.metadata.stack_size === first_stack_size,
                `All output inserters from machine ${machine.entity_id.id} must have the same stack size. ` +
                `Found ${inserter.metadata.stack_size} but expected ${first_stack_size}.`
            );
        }
    }

    // If only one output machine with one inserter, use the original function directly
    const first_machine_inserters = output_inserters_by_machine.get(output_machines[0].entity_id.id) ?? [];
    if (output_machines.length === 1 && first_machine_inserters.length === 1) {
        return computeInserterSwingCounts(
            output_machines[0],
            entity_registry,
            output_swing_count_per_machine,
            output_stack_size
        );
    }

    // For multiple output machines (or multiple inserters), compute swing counts for each and merge
    const combined_result = new EntityTransferCountMap();

    for (const machine of output_machines) {
        const inserters = output_inserters_by_machine.get(machine.entity_id.id) ?? [];
        const num_output_inserters = inserters.length;

        // Divide the swing count among multiple output inserters (they should work in parallel)
        const swing_count_per_inserter = output_swing_count_per_machine.divide(num_output_inserters);

        // Compute swing counts for each output inserter
        for (const output_inserter of inserters) {
            const machine_swing_counts = computeInserterSwingCounts(
                machine,
                entity_registry,
                swing_count_per_inserter,
                output_stack_size,
                new EntityTransferCountMap(),
                output_inserter
            );

            // Merge into combined result
            for (const transfer_count of machine_swing_counts.values()) {
                addTransfers(combined_result, transfer_count);
            }
        }
    }

    return combined_result;
}

/** Adds to an entity's transfers, since a machine reached through several inserter paths must supply all of them */
function addTransfers(result: EntityTransferCountMap, transfer_count: EntityTransferCount): void {
    const entity_id = transfer_count.entity.entity_id;
    const existing = result.get(entity_id);
    if (!existing) {
        result.set(entity_id, transfer_count);
        return;
    }
    const item_transfers = existing.item_transfers.map(it => ({ ...it }));
    for (const new_transfer of transfer_count.item_transfers) {
        const existing_item = item_transfers.find(it => it.item_name === new_transfer.item_name);
        if (existing_item) {
            existing_item.transfer_count = existing_item.transfer_count.add(new_transfer.transfer_count);
        } else {
            item_transfers.push({ ...new_transfer });
        }
    }
    result.set(entity_id, {
        entity: existing.entity,
        item_transfers,
        total_transfer_count: existing.total_transfer_count.add(transfer_count.total_transfer_count),
        stack_size: existing.stack_size
    });
}

/**
 * Computes the number of swings required per inserter based on the recursive ratios
 * of ingredients needed by the target machine and the inserter's stack size.
 * 
 * For each inserter feeding into a machine, this calculates how many swings are needed
 * to deliver the correct ratio of items per production cycle.
 * 
 * If multiple inserters feed the same item to the machine, the swing count is divided
 * equally among them.
 * 
 * For daisy-chained machines (where the source of an inserter is another machine),
 * this function recursively computes swing counts for all upstream machines.
 * 
 * @param machine - The target machine receiving items
 * @param entity_registry - Registry containing all entities
 * @param output_swing_count - The number of swings for the output inserter
 * @param output_stack_size - The stack size of the output inserter
 * @param existing_results - Accumulated results from recursive calls (used internally)
 * @param known_output_inserter - Optional: the specific output inserter to use (for recursive calls 
 *                                where we already know which inserter triggered the recursion)
 * @returns Map of inserter entity IDs to their swing count information
 */
function computeInserterSwingCounts(
    machine: Machine,
    entity_registry: ReadableEntityRegistry,
    output_swing_count: Fraction,
    output_stack_size: number,
    existing_results: EntityTransferCountMap = new EntityTransferCountMap(),
    known_output_inserter?: Inserter
): EntityTransferCountMap {
    const result: EntityTransferCountMap = existing_results;

    const base_production_amount: Fraction = output_swing_count.multiply(output_stack_size);

    // Use the known output inserter if provided, otherwise find the first one
    const output_inserter = known_output_inserter ?? entity_registry.getAll()
        .filter(Entity.isInserter)
        .find(inserter => inserter.source.entity_id.id === machine.entity_id.id);

    assert(output_inserter !== undefined, `No inserter found that takes output from machine ${machine.entity_id}`);

    // in recursive calls the caller has already recorded (and accumulated) the output inserter
    if (!result.has(output_inserter.entity_id)) {
        result.set(output_inserter.entity_id, {
            entity: output_inserter,
            item_transfers: [{
                item_name: machine.output.item_name,
                transfer_count: output_swing_count
            }],
            total_transfer_count: output_swing_count,
            stack_size: output_inserter.metadata.stack_size
        })
    }

    // Get the recursive ratios for this machine
    const ratios = MachineIngredientRatios.forMachine(machine, entity_registry);

    // Find all inserters that feed into this machine
    const loader_entities = entity_registry.getAll()
        .filter(e => Entity.isInserter(e) || Entity.isDrill(e))
        .filter(e => {
            if (Entity.isInserter(e)) {
                return e.sink.entity_id.id === machine.entity_id.id;
            }
            if (Entity.isDrill(e)) {
                return e.sink_id.id === machine.entity_id.id;
            }
            return false;
        });

    // Count how many inserters feed each item type
    const inserters_per_item: Map<string, Inserter[]> = new Map();
    for (const inserter of loader_entities.filter(Entity.isInserter)) {
        for (const item_name of inserter.filtered_items) {
            const inserter_list = inserters_per_item.get(item_name) ?? [];
            inserter_list.push(inserter);
            inserters_per_item.set(item_name, inserter_list);
        }
    }

    const drill_per_item: Map<string, MiningDrill[]> = new Map();
    for (const drill of loader_entities.filter(Entity.isDrill)) {
        const item_name = drill.item.name;
        const drill_list = drill_per_item.get(item_name) ?? [];
        drill_list.push(drill);
        drill_per_item.set(item_name, drill_list);
    }

    // For each inserter, calculate the swing count based on the item ratios and stack size
    for (const inserter of loader_entities.filter(Entity.isInserter)) {
        const item_transfers: ItemTransfer[] = [];
        let total_transfer_count = new Fraction(0);

        // Determine which items this inserter transfers
        for (const item_name of inserter.filtered_items) {
            const ratio = ratios[item_name];

            if (ratio) {
                // Calculate the amount of this item needed per production cycle
                const amount_needed = ratio.multiply(base_production_amount);

                // Divide by the number of inserters feeding this item type
                const num_inserters = inserters_per_item.get(item_name)?.length ?? 1;
                const amount_per_inserter = amount_needed.divide(num_inserters);

                // Calculate the number of swings needed to deliver this amount
                // swing_count = amount_per_inserter / stack_size
                const swing_count = amount_per_inserter.divide(inserter.metadata.stack_size);

                item_transfers.push({
                    item_name,
                    transfer_count: swing_count
                });

                total_transfer_count = total_transfer_count.add(swing_count);
            }
        }

        // Only add to result if this inserter has item transfers
        if (item_transfers.length > 0) {
            addTransfers(result, {
                entity: inserter,
                item_transfers,
                total_transfer_count,
                stack_size: inserter.metadata.stack_size
            });

            // Check if the source is a machine or chest - if so, recursively compute its swing counts
            const source_entity = entity_registry.getAll()
                .find(e => e.entity_id.id === inserter.source.entity_id.id);

            if (source_entity && Entity.isMachine(source_entity)) {
                // Recursively compute swing counts for the source machine
                // Use total transfer count for upstream calculation
                // Pass the current inserter as the known output inserter for the source machine
                // This prevents the recursive call from finding the wrong output inserter
                // when a machine has multiple output inserters going to different downstream machines
                computeInserterSwingCounts(
                    source_entity,
                    entity_registry,
                    total_transfer_count,
                    inserter.metadata.stack_size,
                    result,
                    inserter  // Pass the inserter that triggered this recursion
                );
            } else if (source_entity && Entity.isChest(source_entity)) {
                // The source is a chest - find inserters that fill this chest and continue recursion
                // A chest acts as a passthrough buffer, so the upstream inserter(s) filling it
                // need the same transfer count as the downstream inserter pulling from it
                computeSwingCountsThroughChest(
                    source_entity,
                    entity_registry,
                    total_transfer_count,
                    inserter.metadata.stack_size,
                    item_transfers,
                    result
                );
            }
        }
    }

    // For each drill, calculate the swing count based on the item ratios and stack size
    for (const drill of loader_entities.filter(Entity.isDrill)) {
        const item_name = drill.item.name;
        const ratio = ratios[item_name];

        if (ratio) {
            // Calculate the amount of this item needed per production cycle
            const amount_needed = ratio.multiply(base_production_amount);

            // Divide by the number of drills mining this item type
            const num_drills = drill_per_item.get(item_name)?.length ?? 1;
            const amount_per_drill = amount_needed.divide(num_drills);
            // Calculate the number of swings needed to deliver this amount
            // swing_count = amount_per_drill / stack_size
            const drill_stack_size = InserterStackSize.SIZE_16
            const swing_count = amount_per_drill.divide(drill_stack_size);

            result.set(drill.entity_id, {
                entity: drill,
                item_transfers: [{
                    item_name,
                    transfer_count: swing_count
                }],
                total_transfer_count: swing_count,
                stack_size: drill_stack_size
            });
        }
    }

    return result;
}

/**
 * Computes swing counts for inserters that fill a chest.
 * A chest acts as a passthrough buffer, so the upstream inserter(s) filling it
 * need the same transfer count as the downstream inserter pulling from it.
 * 
 * This function finds all inserters that dump into the chest and:
 * 1. Adds them to the result with the appropriate transfer counts
 * 2. Continues the recursion if those inserters have machines as sources
 * 
 * @param chest - The chest being used as a buffer
 * @param entity_registry - Registry containing all entities
 * @param downstream_transfer_count - The total transfer count from the downstream inserter
 * @param downstream_stack_size - The stack size of the downstream inserter
 * @param downstream_item_transfers - The item transfers from the downstream inserter
 * @param result - Accumulated results to add to
 */
function computeSwingCountsThroughChest(
    chest: Chest,
    entity_registry: ReadableEntityRegistry,
    downstream_transfer_count: Fraction,
    downstream_stack_size: number,
    downstream_item_transfers: ItemTransfer[],
    result: EntityTransferCountMap
): void {
    // Find all inserters that fill this chest (sink is this chest)
    const chest_filling_inserters = entity_registry.getAll()
        .filter(Entity.isInserter)
        .filter(inserter => inserter.sink.entity_id.id === chest.entity_id.id);

    if (chest_filling_inserters.length === 0) {
        // No inserters fill this chest - it may be pre-filled or filled from an external source
        return;
    }

    // Calculate how to distribute the transfer count among the filling inserters
    const num_fillers = chest_filling_inserters.length;

    for (const filler_inserter of chest_filling_inserters) {
        // The filler inserter needs to provide the same items that the downstream inserter pulls
        // Calculate item transfers based on what the downstream inserter needs
        const filler_item_transfers: ItemTransfer[] = [];
        let filler_total_transfer_count = new Fraction(0);

        for (const downstream_transfer of downstream_item_transfers) {
            // Check if this filler inserter handles this item (via its filter)
            if (filler_inserter.filtered_items.has(downstream_transfer.item_name)) {
                // Divide the transfer count by the number of fillers for this item
                // For now, we assume all fillers can provide all items - more sophisticated
                // logic would track which fillers provide which items
                const transfer_per_filler = downstream_transfer.transfer_count.divide(num_fillers);
                
                // Adjust for stack size differences between filler and downstream inserters
                // If filler has different stack size, it needs proportionally different swings
                const stack_size_ratio = downstream_stack_size / filler_inserter.metadata.stack_size;
                const adjusted_transfer = transfer_per_filler.multiply(stack_size_ratio);

                filler_item_transfers.push({
                    item_name: downstream_transfer.item_name,
                    transfer_count: adjusted_transfer
                });
                filler_total_transfer_count = filler_total_transfer_count.add(adjusted_transfer);
            }
        }

        if (filler_item_transfers.length > 0) {
            addTransfers(result, {
                entity: filler_inserter,
                item_transfers: filler_item_transfers,
                total_transfer_count: filler_total_transfer_count,
                stack_size: filler_inserter.metadata.stack_size
            });

            // Continue recursion: check if the filler inserter's source is a machine
            const filler_source = entity_registry.getAll()
                .find(e => e.entity_id.id === filler_inserter.source.entity_id.id);

            if (filler_source && Entity.isMachine(filler_source)) {
                computeInserterSwingCounts(
                    filler_source,
                    entity_registry,
                    filler_total_transfer_count,
                    filler_inserter.metadata.stack_size,
                    result,
                    filler_inserter  // Pass the filler inserter as the known output inserter
                );
            } else if (filler_source && Entity.isChest(filler_source)) {
                // Handle chained chests (chest → chest → machine)
                computeSwingCountsThroughChest(
                    filler_source,
                    entity_registry,
                    filler_total_transfer_count,
                    filler_inserter.metadata.stack_size,
                    filler_item_transfers,
                    result
                );
            }
        }
    }
}

function divideTransfers(
    original: EntityTransferCountMap,
    crafting_cycles: Fraction
): EntityTransferCountMap {
    assert(crafting_cycles.getDenominator === 1, "Crafting cycles must be an integer");
    return EntityTransferCountMap.fromEntries(
        original.map((value) => {
            return {
                entity: value.entity,
                item_transfers: value.item_transfers.map(it => ({
                    item_name: it.item_name,
                    transfer_count: it.transfer_count.divide(crafting_cycles)
                })),
                total_transfer_count: value.total_transfer_count.divide(crafting_cycles),
                stack_size: value.stack_size
            }
        })
    );
}

function computeLCM(swing_counts: EntityTransferCountMap, ignored_items?: string[]): number {
    const allTransfers = swing_counts.mapValues(it => it.item_transfers).flat();
    const filtered = ignored_items && ignored_items.length > 0
        ? allTransfers.filter(it => !ignored_items.includes(it.item_name))
        : allTransfers;
    const ratios = filtered.map(it => it.transfer_count);

    const denominators = ratios.map(it => it.getDenominator);

    return denominators.reduce((lcm, denominator) => math.lcm(lcm, denominator), 1);
}

function serializeTransferPlan(
    swing_counts: EntityTransferCountMap,
    ignored_items?: string[]
): SerializableTransferPlan {
    const entities: SerializableEntityTransferCount[] = [];
    swing_counts.forEach((count, entityId) => {
        entities.push({
            entity_id: entityId.id,
            entity_type: Entity.isInserter(count.entity) ? 'inserter' : 'drill',
            item_transfers: count.item_transfers.map(it => ({
                item_name: it.item_name,
                numerator: it.transfer_count.getNumerator,
                denominator: it.transfer_count.getDenominator,
            })),
            stack_size: count.stack_size,
        });
    });
    return {
        entities,
        computed_lcm: computeLCM(swing_counts, ignored_items),
    };
}

function printInserterSwingCounts(transfers: EntityTransferCountMap, logger: Logger = defaultLogger) {
    logger.log("----------------------");
    logger.log("Transfer Counts:");
    transfers.forEach(it => {
        if (Entity.isInserter(it.entity)) {
            if (it.item_transfers.length === 1) {
                logger.log(`- Inserter ${it.entity.entity_id.id} for item ${it.item_transfers[0].item_name}: ${it.total_transfer_count} transfers (stack size: ${it.stack_size})`);
            } else {
                const items = it.item_transfers.map(t => `${t.item_name} (${t.transfer_count})`).join(", ");
                logger.log(`- Inserter ${it.entity.entity_id.id} for items [${items}]: ${it.total_transfer_count} total transfers (stack size: ${it.stack_size})`);
            }
        }

        if (Entity.isDrill(it.entity)) {
            logger.log(`- Drill ${it.entity.entity_id.id} for item ${it.item_transfers[0].item_name}: ${it.total_transfer_count} transfers`);
        }
    });
    logger.log("----------------------");
};