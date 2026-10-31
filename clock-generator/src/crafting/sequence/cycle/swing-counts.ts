import Fraction, { fraction } from "../../../data-types/fraction";
import { Chest, Entity, EntityId, Inserter, Machine, MiningDrill, ReadableEntityRegistry } from "../../../entities";
import assert from "../../../common/assert";
import { MapExtended } from "../../../data-types";
import { Logger, defaultLogger } from "../../../common/logger";
import { CONTAINER_OUTPUT_PATH_REFUSAL } from "../../../config/errors";

export interface ItemTransfer {
    item_name: string;
    transfer_count: Fraction;
}

export interface EntityTransferCount {
    entity: Inserter | MiningDrill;
    item_transfers: ItemTransfer[];
    total_transfer_count: Fraction;
    /**
     * Hands a cycle the machine needs, ingredients and fuel together, before the fuel is rounded up to the fractions of a
     * hand the ingredients come in. Set on every inserter that loads a machine (it equals `total_transfer_count` where no
     * fuel is rounded); absent on the inserters that take the target output.
     */
    needed_transfer_count?: Fraction;
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
    /** The id of the inserter or drill in the config */
    entity_number: number;
    item_transfers: SerializableItemTransfer[];
    stack_size: number;
}

export interface SerializableTransferPlan {
    entities: SerializableEntityTransferCount[];
    /** The computed LCM before any manual override from config.overrides.lcm */
    computed_lcm: number;
}

export class EntityTransferCountMap extends MapExtended<EntityId, EntityTransferCount> {

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
 * The inserters that take a machine's product out of the build: onto a belt or into a chest. One that hands it to
 * another machine is planned by what that machine uses. When every inserter hands it to a machine, they all count.
 */
export function outputInsertersOf(machine: Machine, entity_registry: Pick<ReadableEntityRegistry, "getAll">): Inserter[] {
    const machine_ids = new Set(entity_registry.getAll().filter(Entity.isMachine).map(it => it.entity_id.id));
    const taking_from_it = entity_registry.getAll()
        .filter(Entity.isInserter)
        .filter(inserter => inserter.source.entity_id.id === machine.entity_id.id);
    const out_of_the_build = taking_from_it
        .filter(inserter => !machine_ids.has(inserter.sink.entity_id.id))
        .filter(inserter => inserter.filtered_items.size === 0 || inserter.filtered_items.has(machine.output.item_name));
    return out_of_the_build.length > 0 ? out_of_the_build : taking_from_it;
}

/**
 * How a machine's product leaves the build: through the inserters that take it out of the machine (`feeders`), and,
 * where those all put it into one finite container from which other inserters take it on to a belt or a chest
 * (`takers`), through that container. The takers are then the build's output inserters, as the feeders are otherwise.
 * The item is the machine's output, compared by equality; the kinds are the entities' types.
 */
export interface OutputPath {
    feeders: Inserter[];
    container: Chest | null;
    takers: Inserter[];
}

export function outputPathOf(machine: Machine, entity_registry: Pick<ReadableEntityRegistry, "getAll">): OutputPath {
    const feeders = outputInsertersOf(machine, entity_registry);
    const item = machine.output.item_name;
    const all = entity_registry.getAll();
    const machine_ids = new Set(all.filter(Entity.isMachine).map(it => it.entity_id.id));
    const finite_chests = new Map(all.filter(Entity.isChest).filter(Chest.isFinite).map(it => [it.entity_id.id, it] as const));
    const takersOf = (chest_id: string) => all.filter(Entity.isInserter)
        .filter(inserter => inserter.source.entity_id.id === chest_id && !machine_ids.has(inserter.sink.entity_id.id))
        .filter(inserter => inserter.filtered_items.size === 0 || inserter.filtered_items.has(item));
    const containers = Array.from(new Set(feeders.map(it => it.sink.entity_id.id)))
        .filter(id => finite_chests.has(id) && takersOf(id).length > 0);
    if (containers.length === 0) {
        return { feeders, container: null, takers: [] };
    }
    const takers = takersOf(containers[0]);
    const onward = takers.some(taker => finite_chests.has(taker.sink.entity_id.id) && takersOf(taker.sink.entity_id.id).length > 0);
    if (containers.length > 1 || feeders.some(it => it.sink.entity_id.id !== containers[0]) || onward) {
        throw new Error(`Machine ${machine.entity_id.number}: ${CONTAINER_OUTPUT_PATH_REFUSAL}`);
    }
    return { feeders, container: finite_chests.get(containers[0])!, takers };
}

/** The inserters whose drops are a machine's output of the build: the takers out of its container, or its feeders */
export function buildOutputInsertersOf(machine: Machine, entity_registry: Pick<ReadableEntityRegistry, "getAll">): Inserter[] {
    const path = outputPathOf(machine, entity_registry);
    return path.container === null ? path.feeders : path.takers;
}

/** The inserters that take a result out of the container a machine places its results into */
export function resultTakersOf(machine: Machine, item: string, entity_registry: Pick<ReadableEntityRegistry, "getAll">): Inserter[] {
    const target_id = machine.result_target;
    return target_id === undefined ? [] : entity_registry.getAll().filter(Entity.isInserter)
        .filter(inserter => inserter.source.entity_id.id === target_id.id && inserter.filtered_items.has(item));
}

/**
 * The crafts of a machine that destroys an item it is brought from outside, `brought` of it: what it is brought over
 * what a craft uses of it less what a craft gives back of it into the machine, through its result target where the
 * inserters that take it out of there all bring it back (a recycler voiding iron ore uses 1 and gets 1/4 back: 4/3
 * crafts an ore brought)
 */
export function destroyedTargetCrafts(machine: Machine, entity_registry: Pick<ReadableEntityRegistry, "getAll">, item: string, brought: Fraction): Fraction {
    const name = `Machine ${machine.entity_id.number}`;
    const takers = resultTakersOf(machine, item, entity_registry);
    const returns_into_machine = takers.filter(inserter => inserter.sink.entity_id.id === machine.entity_id.id);
    assert(returns_into_machine.length === 0 || returns_into_machine.length === takers.length,
        `${name}: of the inserters that take ${item} out of ${machine.result_target}, some bring it back and some take it elsewhere, which is not planned yet`);
    const returned = returns_into_machine.length === 0 ? fraction(0)
        : machine.outputs.find(output => output.item_name === item)?.amount_per_craft ?? fraction(0);
    const used = fraction(machine.inputs.getOrThrow(item).ingredient.amount);
    assert(used.toDecimal() > returned.toDecimal(), `${name} gives back as much ${item} as it uses: it destroys none`);
    return brought.divide(used.subtract(returned));
}

/**
 * The inserters that bring an item into a machine from outside the build: from a chest or a belt the build puts nothing
 * into (no inserter puts into it, no drill drops into it, no machine places its results into it), an infinity chest
 * among them. A machine is always inside the build.
 */
export function insertersBringingIn(machine: Machine, item: string, entity_registry: Pick<ReadableEntityRegistry, "getAll">): Inserter[] {
    const all = entity_registry.getAll();
    const filled = new Set([
        ...all.filter(Entity.isInserter).map(inserter => inserter.sink.entity_id.id),
        ...all.filter(Entity.isDrill).map(drill => drill.sink_id.id),
        ...all.filter(Entity.isMachine).flatMap(it => it.result_target === undefined ? [] : [it.result_target.id]),
    ]);
    return all.filter(Entity.isInserter).filter(inserter => inserter.sink.entity_id.id === machine.entity_id.id
        && inserter.filtered_items.has(item) && !EntityId.isMachine(inserter.source.entity_id) && !filled.has(inserter.source.entity_id.id));
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
                needed_transfer_count: value.needed_transfer_count?.divide(crafting_cycles),
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

    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    return denominators.reduce((lcm, denominator) => lcm / gcd(lcm, denominator) * denominator, 1);
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
            entity_number: entityId.number,
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