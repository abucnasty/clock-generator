import Fraction, { fraction } from "fractionability";
import { Belt, Chest, Entity, EntityId, handSizeFor, Inserter, InserterStackSize, Machine, MiningDrill, ReadableEntityRegistry } from "../../../entities";
import assert from "../../../common/assert";
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

/** Items per cycle asked of machines while the transfers downstream of them are worked out, by machine id */
type MachineDemand = Map<string, Fraction>;

function addDemand(demand: MachineDemand, machine: Machine, items: Fraction): void {
    demand.set(machine.entity_id.id, (demand.get(machine.entity_id.id) ?? fraction(0)).add(items));
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
    output_stack_size: number,
    cycle_ticks?: number
): EntityTransferCountMap {
    const result = new EntityTransferCountMap();
    const asked_directly: MachineDemand = new Map();
    planOutputInserters(output_machines, entity_registry, output_swing_count_per_machine, output_stack_size, result, asked_directly);
    if (cycle_ticks !== undefined) {
        addBeltLaneConsumption(entity_registry, cycle_ticks, new Set(output_machines.map(it => it.entity_id.id)), result, asked_directly);
    }
    planMachines(entity_registry, asked_directly, result);
    return result;
}

/**
 * Belt lanes with a consumption rate are emptied by consumers outside the config, so the inserters
 * filling them must supply that rate on top of everything the target output needs.
 */
function addBeltLaneConsumption(
    entity_registry: ReadableEntityRegistry,
    cycle_ticks: number,
    output_machine_ids: Set<string>,
    result: EntityTransferCountMap,
    demand: MachineDemand
): void {
    for (const belt of entity_registry.getAll().filter(Entity.isBelt)) {
        const consumed: ItemTransfer[] = belt.lanes
            .filter(lane => (lane.consumption_per_second ?? 0) > 0)
            .map(lane => ({
                item_name: lane.ingredient_name,
                transfer_count: fraction(lane.consumption_per_second!).multiply(cycle_ticks).divide(60),
            }));
        if (consumed.length > 0) {
            // the target output inserters are already planned
            computeSwingCountsThroughBelt(belt, entity_registry, () => 1, consumed, result, demand,
                filler => !output_machine_ids.has(filler.source.entity_id.id));
        }
    }
}

/** The inserters that take the target output: each machine's swings are split among the inserters taking from it */
function planOutputInserters(
    output_machines: Machine[],
    entity_registry: ReadableEntityRegistry,
    output_swing_count_per_machine: Fraction,
    output_stack_size: number,
    result: EntityTransferCountMap,
    demand: MachineDemand
): void {
    assert(output_machines.length > 0, "At least one output machine is required");

    for (const machine of output_machines) {
        const inserters = entity_registry.getAll()
            .filter(Entity.isInserter)
            .filter(inserter => inserter.source.entity_id.id === machine.entity_id.id);
        assert(
            inserters.length >= 1,
            `Output machine ${machine.entity_id.id} must have at least one dedicated output inserter, ` +
            `but found ${inserters.length}.`
        );

        // Validate all output inserters have the same stack size
        const first_stack_size = handSizeFor(inserters[0], machine.output.item_name);
        for (const inserter of inserters) {
            const hand_size = handSizeFor(inserter, machine.output.item_name);
            assert(
                hand_size === first_stack_size,
                `All output inserters from machine ${machine.entity_id.id} must have the same stack size. ` +
                `Found ${hand_size} but expected ${first_stack_size}.`
            );
        }

        // Divide the swing count among multiple output inserters (they should work in parallel)
        const swing_count_per_inserter = output_swing_count_per_machine.divide(inserters.length);
        for (const output_inserter of inserters) {
            addTransfers(result, {
                entity: output_inserter,
                item_transfers: [{ item_name: machine.output.item_name, transfer_count: swing_count_per_inserter }],
                total_transfer_count: swing_count_per_inserter,
                stack_size: handSizeFor(output_inserter, machine.output.item_name)
            });
        }
        addDemand(demand, machine, output_swing_count_per_machine.multiply(output_stack_size));
    }
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
 * Computes the number of swings required per inserter for a machine whose output inserter swings
 * `output_swing_count` times a cycle, and for every machine upstream of it.
 *
 * @param machine - The target machine receiving items
 * @param entity_registry - Registry containing all entities
 * @param output_swing_count - The number of swings for the output inserter
 * @param output_stack_size - The stack size of the output inserter
 * @param existing_results - Results to add to
 * @param known_output_inserter - Optional: the specific output inserter to use
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

    // Use the known output inserter if provided, otherwise find the first one
    const output_inserter = known_output_inserter ?? entity_registry.getAll()
        .filter(Entity.isInserter)
        .find(inserter => inserter.source.entity_id.id === machine.entity_id.id);

    assert(output_inserter !== undefined, `No inserter found that takes output from machine ${machine.entity_id}`);

    if (!result.has(output_inserter.entity_id)) {
        result.set(output_inserter.entity_id, {
            entity: output_inserter,
            item_transfers: [{
                item_name: machine.output.item_name,
                transfer_count: output_swing_count
            }],
            total_transfer_count: output_swing_count,
            stack_size: handSizeFor(output_inserter, machine.output.item_name)
        })
    }

    const asked_directly: MachineDemand = new Map();
    addDemand(asked_directly, machine, output_swing_count.multiply(output_stack_size));
    planMachines(entity_registry, asked_directly, result);
    return result;
}

/**
 * Plans the inserters that load every machine, given the items a cycle asked of some machines directly.
 *
 * What a machine is asked for it asks of the machines its ingredients come from, following the inserters that
 * connect them. Machines can feed each other in a loop (a pentapod egg biochamber crafts from the eggs of its
 * neighbour and gives eggs back), so the items each machine makes in a cycle are solved for together: a machine
 * makes what is asked of it directly plus what the machines downstream of it ask for.
 */
function planMachines(
    entity_registry: ReadableEntityRegistry,
    asked_directly: MachineDemand,
    result: EntityTransferCountMap
): void {
    const without_fuel = new EntityTransferCountMap();
    planMachinesFor(entity_registry, asked_directly, without_fuel, false);
    const with_fuel = new EntityTransferCountMap();
    planMachinesFor(entity_registry, asked_directly, with_fuel, true);

    for (const planned of with_fuel.values()) {
        addTransfers(result, withFuelRoundedUp(planned, without_fuel.get(planned.entity.entity_id)));
    }
}

/**
 * Fuel is burned at a rate that has nothing to do with the hands of the plan, so counted exactly it would stretch
 * the clock period to fit it. What an inserter carries on top of its ingredients is rounded up to the fractions of
 * a hand its ingredients already come in: a little more room than the fuel needs, in a period that stays the same.
 */
function withFuelRoundedUp(with_fuel: EntityTransferCount, without_fuel: EntityTransferCount | undefined): EntityTransferCount {
    const cycles = without_fuel?.total_transfer_count.getDenominator ?? 1;
    const item_transfers = with_fuel.item_transfers.map(transfer => {
        const exact = without_fuel?.item_transfers.find(it => it.item_name === transfer.item_name)?.transfer_count ?? fraction(0);
        const for_fuel = transfer.transfer_count.toDecimal() - exact.toDecimal();
        if (for_fuel <= 1e-9) {
            return { item_name: transfer.item_name, transfer_count: exact };
        }
        const parts = Math.max(cycles, exact.getDenominator);
        return { item_name: transfer.item_name, transfer_count: exact.add(fraction(Math.ceil(for_fuel * parts - 1e-9), parts)) };
    }).filter(it => it.transfer_count.toDecimal() > 0);
    return {
        entity: with_fuel.entity,
        item_transfers,
        total_transfer_count: item_transfers.reduce((sum, it) => sum.add(it.transfer_count), fraction(0)),
        stack_size: with_fuel.stack_size,
    };
}

function planMachinesFor(
    entity_registry: ReadableEntityRegistry,
    asked_directly: MachineDemand,
    result: EntityTransferCountMap,
    include_fuel: boolean
): void {
    const machines = entity_registry.getAll().filter(Entity.isMachine);

    // what one item asked of a machine asks of the machines upstream of it
    const asked_upstream_per_item = new Map<string, MachineDemand>();
    for (const machine of machines) {
        const asked_upstream: MachineDemand = new Map();
        planMachineLoaders(machine, entity_registry, fraction(1), new EntityTransferCountMap(), asked_upstream, include_fuel);
        asked_upstream_per_item.set(machine.entity_id.id, asked_upstream);
    }

    const made_per_cycle = solveItemsMadePerCycle(machines.map(it => it.entity_id.id), asked_directly, asked_upstream_per_item);

    // downstream machines first, so the transfers are listed from the output back to the inputs
    const planned = new Set<string>();
    const plan = (machine_id: string): void => {
        if (planned.has(machine_id)) {
            return;
        }
        planned.add(machine_id);
        const machine = machines.find(it => it.entity_id.id === machine_id)!;
        const items = made_per_cycle.get(machine_id) ?? fraction(0);
        if (items.toDecimal() <= 0) {
            return;
        }
        planMachineLoaders(machine, entity_registry, items, result, new Map(), include_fuel);
        Array.from(asked_upstream_per_item.get(machine_id)!.keys()).forEach(plan);
    };
    Array.from(asked_directly.keys()).forEach(plan);
}

/**
 * Solves `made = asked directly + what the machines downstream ask for` for every machine at once, by Gaussian
 * elimination on exact fractions.
 */
function solveItemsMadePerCycle(
    machine_ids: string[],
    asked_directly: MachineDemand,
    asked_upstream_per_item: Map<string, MachineDemand>
): MachineDemand {
    const n = machine_ids.length;
    const isZero = (value: Fraction) => value.toDecimal() === 0;
    // row i: made[i] - sum over j of (what an item of j asks of i) * made[j] = asked directly of i
    const rows: Fraction[][] = machine_ids.map((row_id, i) => [
        ...machine_ids.map((column_id, j) =>
            fraction(i === j ? 1 : 0).subtract(asked_upstream_per_item.get(column_id)?.get(row_id) ?? fraction(0))),
        asked_directly.get(row_id) ?? fraction(0),
    ]);
    for (let column = 0; column < n; column++) {
        const pivot = rows.findIndex((row, index) => index >= column && !isZero(row[column]));
        assert(pivot !== -1,
            `Machine ${machine_ids[column]} is in a loop of machines that uses up everything it makes, so no amount of crafting meets the target.`);
        [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
        const pivot_row = rows[column].map(value => value.divide(rows[column][column]));
        rows[column] = pivot_row;
        for (let index = 0; index < n; index++) {
            if (index !== column && !isZero(rows[index][column])) {
                const factor = rows[index][column];
                rows[index] = rows[index].map((value, k) => value.subtract(pivot_row[k].multiply(factor)));
            }
        }
    }
    return new Map(machine_ids.map((id, i) => [id, rows[i][n]]));
}

/** Fuel burned per craft is counted in parts of an item this small, rounded up, to keep its fraction simple */
const FUEL_PARTS_PER_ITEM = 1000;

function hasFuelOnlyInserter(machine: Machine, entity_registry: ReadableEntityRegistry): boolean {
    return entity_registry.getAll().filter(Entity.isInserter)
        .some(inserter => inserter.sink.entity_id.id === machine.entity_id.id && machine.isFuelOnly(inserter.filtered_items));
}

/**
 * Plans the inserters and drills that load one machine making `output_items` a cycle, and the inserters filling
 * the chests and belts they take from. If multiple inserters feed the same item to the machine, it is divided
 * equally among them. What they take from other machines is added to `demand`.
 */
function planMachineLoaders(
    machine: Machine,
    entity_registry: ReadableEntityRegistry,
    output_items: Fraction,
    result: EntityTransferCountMap,
    demand: MachineDemand,
    include_fuel: boolean = false
): void {
    // the ratio of each ingredient to the output, productivity included: 3 of A for 6 made is 1/2
    const ratios = new Map<string, Fraction>();
    for (const input of machine.inputs.values()) {
        ratios.set(input.item_name, fraction(input.ingredient.amount).divide(machine.output.amount_per_craft));
    }
    // fuel that comes on the inserters of the plan is one more thing they carry; a fuel-only inserter has a clock of its own
    const fuel_item = machine.fuel_slot?.fuel.item_name;
    if (include_fuel && fuel_item !== undefined && machine.fuel_consumption && !hasFuelOnlyInserter(machine, entity_registry)) {
        const fuel_per_craft = fraction(Math.ceil(machine.fuel_consumption.amount_per_craft * FUEL_PARTS_PER_ITEM), FUEL_PARTS_PER_ITEM);
        ratios.set(fuel_item, (ratios.get(fuel_item) ?? fraction(0)).add(fuel_per_craft.divide(machine.output.amount_per_craft)));
    }

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
            const ratio = ratios.get(item_name);

            if (ratio) {
                // Calculate the amount of this item needed per production cycle
                const amount_needed = ratio.multiply(output_items);

                // Divide by the number of inserters feeding this item type
                const num_inserters = inserters_per_item.get(item_name)?.length ?? 1;
                const amount_per_inserter = amount_needed.divide(num_inserters);

                // Calculate the number of swings needed to deliver this amount
                // swing_count = amount_per_inserter / stack_size
                const swing_count = amount_per_inserter.divide(handSizeFor(inserter, item_name));

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
                stack_size: handSizeFor(inserter, item_transfers[0].item_name)
            });
            computeUpstreamOfFiller(inserter, total_transfer_count, item_transfers, entity_registry, result, demand);
        }
    }

    // For each drill, calculate the swing count based on the item ratios and stack size
    for (const drill of loader_entities.filter(Entity.isDrill)) {
        const item_name = drill.item.name;
        const ratio = ratios.get(item_name);

        if (ratio) {
            // Calculate the amount of this item needed per production cycle
            const amount_needed = ratio.multiply(output_items);

            // Divide by the number of drills mining this item type
            const num_drills = drill_per_item.get(item_name)?.length ?? 1;
            const amount_per_drill = amount_needed.divide(num_drills);
            // Calculate the number of swings needed to deliver this amount
            // swing_count = amount_per_drill / stack_size
            const drill_stack_size = InserterStackSize.SIZE_16
            const swing_count = amount_per_drill.divide(drill_stack_size);

            addTransfers(result, {
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
 * @param downstream_hand_size - Items per hand of the downstream inserter, for an item
 * @param downstream_item_transfers - The item transfers from the downstream inserter
 * @param result - Accumulated results to add to
 */
function computeSwingCountsThroughChest(
    chest: Chest,
    entity_registry: ReadableEntityRegistry,
    downstream_transfer_count: Fraction,
    downstream_hand_size: (item_name: string) => number,
    downstream_item_transfers: ItemTransfer[],
    result: EntityTransferCountMap,
    demand: MachineDemand
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
                const stack_size_ratio = downstream_hand_size(downstream_transfer.item_name) / handSizeFor(filler_inserter, downstream_transfer.item_name);
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
                stack_size: handSizeFor(filler_inserter, filler_item_transfers[0].item_name)
            });
            computeUpstreamOfFiller(filler_inserter, filler_total_transfer_count, filler_item_transfers, entity_registry, result, demand);
        }
    }
}

/**
 * Continues from an inserter to whatever it takes from: the inserters filling a chest or a belt, or a machine,
 * which is asked for the items and planned once everything asked of it is known
 */
function computeUpstreamOfFiller(
    filler_inserter: Inserter,
    filler_total_transfer_count: Fraction,
    filler_item_transfers: ItemTransfer[],
    entity_registry: ReadableEntityRegistry,
    result: EntityTransferCountMap,
    demand: MachineDemand
): void {
    const filler_source = entity_registry.getAll()
        .find(e => e.entity_id.id === filler_inserter.source.entity_id.id);

    if (filler_source && Entity.isMachine(filler_source)) {
        addDemand(demand, filler_source,
            filler_total_transfer_count.multiply(handSizeFor(filler_inserter, filler_item_transfers[0].item_name)));
    } else if (filler_source && Entity.isChest(filler_source)) {
        computeSwingCountsThroughChest(
            filler_source,
            entity_registry,
            filler_total_transfer_count,
            item_name => handSizeFor(filler_inserter, item_name),
            filler_item_transfers,
            result,
            demand
        );
    } else if (filler_source && Entity.isBelt(filler_source)) {
        computeSwingCountsThroughBelt(
            filler_source,
            entity_registry,
            item_name => handSizeFor(filler_inserter, item_name),
            filler_item_transfers,
            result,
            demand
        );
    }
}

/**
 * Computes swing counts for inserters filling a belt used as a buffer between machines. Like a chest,
 * the fillers supply what is taken off the belt, but lanes are item specific, so an item's count is
 * split only among the fillers carrying it. A belt nothing fills is an external input.
 */
function computeSwingCountsThroughBelt(
    belt: Belt,
    entity_registry: ReadableEntityRegistry,
    downstream_hand_size: (item_name: string) => number,
    downstream_item_transfers: ItemTransfer[],
    result: EntityTransferCountMap,
    demand: MachineDemand,
    include_filler: (filler: Inserter) => boolean = () => true
): void {
    const fillers = entity_registry.getAll()
        .filter(Entity.isInserter)
        .filter(inserter => inserter.sink.entity_id.id === belt.entity_id.id)
        .filter(include_filler);

    for (const filler_inserter of fillers) {
        const filler_item_transfers: ItemTransfer[] = [];
        let filler_total_transfer_count = new Fraction(0);

        for (const downstream_transfer of downstream_item_transfers) {
            if (!filler_inserter.filtered_items.has(downstream_transfer.item_name)) {
                continue;
            }
            const fillers_for_item = fillers.filter(it => it.filtered_items.has(downstream_transfer.item_name)).length;
            const transfer_count = downstream_transfer.transfer_count
                .divide(fillers_for_item)
                .multiply(downstream_hand_size(downstream_transfer.item_name))
                .divide(handSizeFor(filler_inserter, downstream_transfer.item_name));
            filler_item_transfers.push({ item_name: downstream_transfer.item_name, transfer_count });
            filler_total_transfer_count = filler_total_transfer_count.add(transfer_count);
        }

        if (filler_item_transfers.length > 0) {
            addTransfers(result, {
                entity: filler_inserter,
                item_transfers: filler_item_transfers,
                total_transfer_count: filler_total_transfer_count,
                stack_size: handSizeFor(filler_inserter, filler_item_transfers[0].item_name)
            });
            computeUpstreamOfFiller(filler_inserter, filler_total_transfer_count, filler_item_transfers, entity_registry, result, demand);
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