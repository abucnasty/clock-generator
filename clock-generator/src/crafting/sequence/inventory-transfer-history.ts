import { computeSimulationMode, SimulationMode } from "./simulation-mode";
import { InventoryTransfer } from "./inventory-transfer";
import { Duration, MapExtended, OpenRange } from "../../data-types";
import { assertIsMachine, Entity, EntityId, Inserter, ReadableEntityRegistry } from "../../entities";
import { Logger, defaultLogger } from "../../common/logger";
import { EntityTransferCount, EntityTransferCountMap } from "./cycle/swing-counts";

export class InventoryTransferHistory extends MapExtended<EntityId, InventoryTransfer[]> {

    public static mergeOverlappingRanges(history: InventoryTransferHistory, overlap_threshold: number = 1): InventoryTransferHistory {
        const merged = mergeOverlappingRanges(history.getAllTransfers(), overlap_threshold);
        return new InventoryTransferHistory(merged);
    }

    public static correctNegativeOffsets(history: InventoryTransferHistory): InventoryTransferHistory {
        const offset = correctNegativeOffsets(history.getAllTransfers());
        return new InventoryTransferHistory(offset);
    }

    public static removeDuplicateEntities(history: InventoryTransferHistory): InventoryTransferHistory {
        const deduplicated = deduplicateEntityTransfers(history.getAllTransfers());
        return new InventoryTransferHistory(deduplicated);
    }

    public static offsetHistory(
        history: InventoryTransferHistory,
        offset: number
    ): InventoryTransferHistory {
        const offset_transfers = offsetInventoryTransfers(history.getAllTransfers(), offset);
        return new InventoryTransferHistory(offset_transfers);
    }

    public static trimEndsToAvoidBackSwingWakeLists(
        history: InventoryTransferHistory,
        entity_registry: ReadableEntityRegistry,
        entity_transfer_count_map: EntityTransferCountMap
    ): InventoryTransferHistory {
        const trimmed: Map<EntityId, InventoryTransfer[]> = new Map();

        history.getAllTransfers().forEach((transfers, entityId) => {
            const entity = entity_registry.getEntityByIdOrThrow(entityId);
            if (!Entity.isInserter(entity)) {
                trimmed.set(entityId, transfers);
                return;
            }
            const source_entity = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
            if (Entity.isBelt(source_entity)) {
                trimmed.set(entityId, transfers);
                return;
            }

            // an inserter that is not in the plan (one that only takes by-products away) has no swing count to trim by
            if (!entity_transfer_count_map.has(entityId)) {
                trimmed.set(entityId, transfers);
                return;
            }

            // Skip trimming for inserters that drop to chests (not counted in entity_transfer_count_map)
            const sink_entity = entity_registry.getEntityByIdOrThrow(entity.sink.entity_id);
            if (Entity.isChest(sink_entity)) {
                trimmed.set(entityId, transfers);
                return;
            }

            const last_swing_offset = computeLastSwingOffsetDuration(
                source_entity,
                entity,
                entity_transfer_count_map.getOrThrow(entityId)
            );

            const trimmed_transfers: InventoryTransfer[] = transfers.map(transfer => {
                const original_range = transfer.tick_range;
                const trimmed_range = OpenRange.from(
                    original_range.start_inclusive,
                    original_range.end_inclusive + last_swing_offset.ticks
                );
                return {
                    item_name: transfer.item_name,
                    tick_range: trimmed_range,
                    amount: transfer.amount,
                }
            }).filter(transfer => transfer.tick_range.duration().ticks > 0);

            trimmed.set(entityId, trimmed_transfers);
        })
        return new InventoryTransferHistory(trimmed);
    }

    public static print(history: InventoryTransferHistory, logger: Logger = defaultLogger, relative_tick_mod: number = 0): void {
        printInventoryTransfers(history, logger, relative_tick_mod);
    }


    constructor(
        transfers: Map<EntityId, InventoryTransfer[]> = new Map()
    ) {
        super(Array.from(transfers.entries()));
    }

    /** Off during prepare and warmup, whose transfers are cleared before the measured run anyway */
    public recording = true;

    public recordTransfer(entity_id: EntityId, transfer: InventoryTransfer): void {
        if (!this.recording) {
            return;
        }
        const transfer_list = this.get(entity_id) ?? [];
        transfer_list.push(transfer);
        this.set(entity_id, transfer_list);
    }

    public getAllTransfers(): ReadonlyMap<EntityId, InventoryTransfer[]> {
        const copy = new Map();
        this.forEach((value, key) => {
            copy.set(key, [...value.map(it => ({ ...it }))]);
        });
        return copy;
    }
}

function mergeOverlappingRanges(original: ReadonlyMap<EntityId, InventoryTransfer[]>, overlap_threshold: number = 1): Map<EntityId, InventoryTransfer[]> {
    const result: Map<EntityId, InventoryTransfer[]> = new Map();

    original.forEach((ranges, entityId) => {

        const by_item: Map<string, InventoryTransfer[]> = new Map()

        ranges.forEach(it => {
            const transfers = by_item.get(it.item_name) ?? []
            by_item.set(it.item_name, transfers.concat(it))
        })

        by_item.forEach((ranges, itemName) => {
            const merged_ranges: InventoryTransfer[] = OpenRange.reduceRanges(ranges.map(it => it.tick_range), overlap_threshold).map(it => {
                return {
                    item_name: itemName,
                    tick_range: it,
                    amount: ranges.filter(r => it.overlaps(r.tick_range)).reduce((sum, r) => sum + r.amount, 0),
                }
            })
            const existing_ranges = result.get(entityId) ?? []
            result.set(entityId, existing_ranges.concat(merged_ranges))
        })
    })

    return result
}

function offsetInventoryTransfers(
    original: ReadonlyMap<EntityId, InventoryTransfer[]>,
    offset: number
): Map<EntityId, InventoryTransfer[]> {
    const result: Map<EntityId, InventoryTransfer[]> = new Map();

    original.forEach((ranges, entityId) => {
        const offset_ranges: InventoryTransfer[] = ranges.map(it => {
            return {
                item_name: it.item_name,
                tick_range: OpenRange.from(
                    it.tick_range.start_inclusive + offset,
                    it.tick_range.end_inclusive + offset
                ),
                amount: it.amount,
            }
        })
        result.set(entityId, offset_ranges)
    })
    return result;
}

function correctNegativeOffsets(original: ReadonlyMap<EntityId, InventoryTransfer[]>): Map<EntityId, InventoryTransfer[]> {
    const result: Map<EntityId, InventoryTransfer[]> = new Map();

    let minimum_tick = Infinity;
    Array.from(original.values()).flat().forEach(transfer => {
        minimum_tick = Math.min(minimum_tick, transfer.tick_range.start_inclusive);
    })

    const offset = minimum_tick - 1

    original.forEach((ranges, entityId) => {
        const corrected_ranges: InventoryTransfer[] = ranges.map(it => {
            return {
                item_name: it.item_name,
                tick_range: OpenRange.from(
                    it.tick_range.start_inclusive - offset,
                    it.tick_range.end_inclusive - offset,
                ),
                amount: it.amount,
            }
        })
        result.set(entityId, corrected_ranges)
    })
    return result;
}

function printInventoryTransfers(
    history: InventoryTransferHistory,
    logger: Logger = defaultLogger,
    relative_tick_mod: number = 0
): void {
    Array.from(history.entries_array())
        .sort(([entity_id, transfers], [entity_id2, transfers2]) => transfers[0]?.tick_range.start_inclusive - transfers2[0]?.tick_range.start_inclusive)
        .forEach(([entity_id, transfers]) => {
            logger.log(`Transfer Ranges for ${entity_id}`);
            transfers
                .sort((a, b) => a.tick_range.start_inclusive - b.tick_range.start_inclusive)
                .forEach((transfer) => {
                    const start_inclusive = transfer.tick_range.start_inclusive;
                    const end_inclusive = transfer.tick_range.end_inclusive;
                    const amount = transfer.amount;
                    if (relative_tick_mod > 0) {
                        const start_mod = start_inclusive % relative_tick_mod;
                        const end_mod = end_inclusive % relative_tick_mod;
                        
                        logger.log(`- [${start_inclusive} - ${end_inclusive}](${start_mod} - ${end_mod}) (${transfer.tick_range.duration().ticks} ticks) ${transfer.item_name} x${amount}`);
                        return;
                    }
                    logger.log(`- [${start_inclusive} - ${end_inclusive}] (${transfer.tick_range.duration().ticks} ticks) ${transfer.item_name} x${amount}`);
                })
        })
}

/**
 * if two entities have the exact same transfer ranges and items, we can reduce them to one entity
 */
function deduplicateEntityTransfers(transfers: ReadonlyMap<EntityId, InventoryTransfer[]>): Map<EntityId, InventoryTransfer[]> {
    const result: Map<EntityId, InventoryTransfer[]> = new Map();

    const seenTransferSignatures: Map<string, EntityId> = new Map();

    transfers.forEach((transferList, entityId) => {
        // create a signature for the transfer list
        const signature = transferList
            .map(transfer => `${transfer.item_name}:${transfer.tick_range.start_inclusive}-${transfer.tick_range.end_inclusive}`)
            .sort() // sort to ensure order doesn't matter
            .join("|");

        if (!seenTransferSignatures.has(signature)) {
            seenTransferSignatures.set(signature, entityId);
            result.set(entityId, transferList);
        } else {
            // duplicate found, skip adding this entity
        }
    });

    return result;
}


function computeLastSwingOffsetDuration(
    source_entity: Entity,
    inserter: Inserter,
    entity_transfer_count: EntityTransferCount
): Duration {
    if (Entity.isChest(source_entity)) {
        const animation = inserter.animation
        const offset = animation.rotation.ticks
        return Duration.ofTicks(-1 * offset);
    }
    assertIsMachine(source_entity)
    const source_machine = source_entity;
    const mode = computeSimulationMode(source_machine, inserter, entity_transfer_count);
    if (mode === SimulationMode.NORMAL) {
        const animation = inserter.animation
        const offset = animation.rotation.ticks
        return Duration.ofTicks(-1 * offset);
    }

    if (mode === SimulationMode.PREVENT_DESYNCS || mode === SimulationMode.LOW_INSERTION_LIMITS) {
        return Duration.zero
    }
    return Duration.zero;
}
