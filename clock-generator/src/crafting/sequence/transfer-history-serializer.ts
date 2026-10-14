import { InventoryTransferHistory } from "./inventory-transfer-history";
import { ReadableEntityRegistry, Entity } from "../../entities";

/**
 * A single transfer entry that is JSON-serializable
 */
export interface SerializableTransferEntry {
    item_name: string;
    start_tick: number;
    end_tick: number;
    amount: number;
}

/**
 * A serializable representation of transfer history for a single entity
 */
export interface SerializableEntityTransferHistory {
    /** Entity ID string (e.g., "inserter:1") */
    entity_id: string;
    /** Entity type ("inserter" or "drill") */
    entity_type: 'inserter' | 'drill';
    /** Human-readable label for the entity */
    label: string;
    /** The source entity info (for inserters) */
    source?: {
        entity_id: string;
        label: string;
    };
    /** The sink/target entity info (for inserters) */
    sink?: {
        entity_id: string;
        label: string;
    };
    /** All transfers for this entity */
    transfers: SerializableTransferEntry[];
}

/**
 * The complete serializable transfer history
 */
export interface SerializableTransferHistory {
    /** Total simulation duration in ticks */
    total_duration_ticks: number;
    /** All entity transfer histories */
    entities: SerializableEntityTransferHistory[];
}

/**
 * Convert an InventoryTransferHistory to a serializable format suitable for JSON
 */
export function serializeTransferHistory(
    history: InventoryTransferHistory,
    entity_registry: ReadableEntityRegistry,
    total_duration_ticks: number
): SerializableTransferHistory {
    const entities: SerializableEntityTransferHistory[] = [];

    history.forEach((transfers, entityId) => {
        const entity = entity_registry.getEntityById(entityId);
        
        let entity_type: 'inserter' | 'drill';
        let label: string;
        let source: SerializableEntityTransferHistory['source'];
        let sink: SerializableEntityTransferHistory['sink'];

        if (entity && Entity.isInserter(entity)) {
            entity_type = 'inserter';
            label = `Inserter ${entityId.number}`;
            
            const sourceEntity = entity_registry.getEntityById(entity.source.entity_id);
            const sinkEntity = entity_registry.getEntityById(entity.sink.entity_id);
            
            source = {
                entity_id: entity.source.entity_id.id,
                label: sourceEntity ? getEntityLabel(sourceEntity) : entity.source.entity_id.id,
            };
            sink = {
                entity_id: entity.sink.entity_id.id,
                label: sinkEntity ? getEntityLabel(sinkEntity) : entity.sink.entity_id.id,
            };
        } else if (entity && Entity.isDrill(entity)) {
            entity_type = 'drill';
            label = `Drill ${entityId.number}`;
            
            const targetEntity = entity_registry.getEntityById(entity.sink_id);
            sink = {
                entity_id: entity.sink_id.id,
                label: targetEntity ? getEntityLabel(targetEntity) : entity.sink_id.id,
            };
        } else {
            // Unknown entity type, skip
            return;
        }

        const serializedTransfers: SerializableTransferEntry[] = transfers.map(t => ({
            item_name: t.item_name,
            start_tick: t.tick_range.start_inclusive,
            end_tick: t.tick_range.end_inclusive,
            amount: t.amount,
        }));

        entities.push({
            entity_id: entityId.id,
            entity_type,
            label,
            source,
            sink,
            transfers: serializedTransfers,
        });
    });

    // Sort entities by type (inserters first) then by ID
    entities.sort((a, b) => {
        if (a.entity_type !== b.entity_type) {
            return a.entity_type === 'inserter' ? -1 : 1;
        }
        return a.entity_id.localeCompare(b.entity_id);
    });

    return {
        total_duration_ticks: total_duration_ticks,
        entities,
    };
}

function getEntityLabel(entity: Entity): string {
    if (Entity.isMachine(entity)) {
        return `Machine ${entity.entity_id.number} (${entity.metadata.recipe.name})`;
    }
    if (Entity.isBelt(entity)) {
        return `Belt ${entity.entity_id.number}`;
    }
    if (Entity.isDrill(entity)) {
        return `Drill ${entity.entity_id.number} (${entity.item.name})`;
    }
    if (Entity.isInserter(entity)) {
        return `Inserter ${entity.entity_id.number}`;
    }
    return entity.entity_id.id;
}
