import { Entity, ReadableEntityRegistry } from "../../entities";
import { StateTransitionHistory, StateTransitionEntityType } from "./state-transition-history";
import { chestName } from "../../common/entity-types";
import type {
    SerializableEntityStateTransitions,
    SerializableFactorioState,
    SerializableStateTransition,
    SerializableStateTransitionHistory,
} from "./compact-history";

export type { SerializableEntityStateTransitions, SerializableFactorioState, SerializableStateTransition, SerializableStateTransitionHistory };

/**
 * Convert a StateTransitionHistory to a serializable format suitable for JSON
 */
export function serializeStateTransitionHistory(
    history: StateTransitionHistory,
    entity_registry: ReadableEntityRegistry,
    total_duration_ticks: number
): SerializableStateTransitionHistory {
    const entities: SerializableEntityStateTransitions[] = [];

    history.getAllTransitions().forEach((entityTransitions, entityId) => {
        const entity = entity_registry.getEntityById(entityId);
        if (!entity) {
            return;
        }

        let label: string;
        let source: SerializableEntityStateTransitions['source'];
        let sink: SerializableEntityStateTransitions['sink'];
        let items: string[] = [];

        if (Entity.isInserter(entity)) {
            label = `Inserter ${entityId.number}`;
            
            const sourceEntity = entity_registry.getEntityById(entity.source.entity_id);
            const sinkEntity = entity_registry.getEntityById(entity.sink.entity_id);
            
            source = {
                entity_id: entity.source.entity_id.id,
                entity_type: entity.source.entity_id.type,
                label: sourceEntity ? getEntityLabel(sourceEntity) : entity.source.entity_id.id,
            };
            sink = {
                entity_id: entity.sink.entity_id.id,
                entity_type: entity.sink.entity_id.type,
                label: sinkEntity ? getEntityLabel(sinkEntity) : entity.sink.entity_id.id,
            };

            // Get items from inserter filters, or from source/sink if available
            if (entity.filtered_items && entity.filtered_items.size > 0) {
                items = Array.from(entity.filtered_items);
            } else if (sourceEntity && Entity.isMachine(sourceEntity)) {
                items = [sourceEntity.output.item_name];
            } else if (sinkEntity && Entity.isMachine(sinkEntity)) {
                items = Array.from(sinkEntity.inputs.keys());
            }
        } else if (Entity.isMachine(entity)) {
            label = `Machine ${entityId.number} (${entity.metadata.recipe.name})`;
            items = [entity.output.item_name];
        } else if (Entity.isDrill(entity)) {
            label = `Drill ${entityId.number} (${entity.item.name})`;
            items = [entity.item.name];
            
            const targetEntity = entity_registry.getEntityById(entity.sink_id);
            sink = {
                entity_id: entity.sink_id.id,
                entity_type: entity.sink_id.type,
                label: targetEntity ? getEntityLabel(targetEntity) : entity.sink_id.id,
            };
        } else {
            label = entityId.id;
        }

        const transitions = entityTransitions.transitions;
        
        // Compute durations for each transition
        const serializedTransitions: SerializableStateTransition[] = transitions.map((t, index) => {
            const nextTransition = transitions[index + 1];
            const duration_ticks = nextTransition 
                ? nextTransition.tick - t.tick 
                : total_duration_ticks - t.tick;
            
            return {
                tick: t.tick,
                from_status: String(t.from_status),
                to_status: String(t.to_status),
                reason: t.reason,
                duration_ticks: Math.max(0, duration_ticks),
            };
        });

        // Determine initial status (from the first transition's from_status, or from first to_status if no transitions)
        const initial_status = transitions.length > 0 
            ? String(transitions[0].from_status)
            : 'UNKNOWN';

        const factorio_states = entityTransitions.factorio_states ?? [];
        const serializedFactorioStates: SerializableFactorioState[] = factorio_states.map((change, index) => {
            const next = factorio_states[index + 1];
            return {
                tick: change.tick,
                state: change.state,
                duration_ticks: Math.max(0, (next ? next.tick : total_duration_ticks) - change.tick),
            };
        });

        entities.push({
            entity_id: entityId.id,
            entity_type: entityTransitions.entity_type,
            label,
            source,
            sink,
            items,
            initial_status,
            transitions: serializedTransitions,
            initial_factorio_state: factorio_states.length > 0 ? factorio_states[0].state : "unknown",
            factorio_states: serializedFactorioStates,
        });
    });

    // Sort entities by type (machines first, then inserters, then drills) then by ID
    const typeOrder: Record<StateTransitionEntityType, number> = {
        machine: 0,
        inserter: 1,
        drill: 2,
    };
    
    entities.sort((a, b) => {
        const typeComparison = typeOrder[a.entity_type] - typeOrder[b.entity_type];
        if (typeComparison !== 0) {
            return typeComparison;
        }
        return a.entity_id.localeCompare(b.entity_id);
    });

    return {
        total_duration_ticks,
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
    if (Entity.isChest(entity)) {
        return chestName(entity.chest_type, entity.entity_id.number);
    }
    return entity.entity_id.id;
}
