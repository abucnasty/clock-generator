import { Entity, ReadableEntityRegistry } from "../../entities";
import { StateTransitionHistory, StateTransitionEntityType, EntityStatus } from "./state-transition-history";

/**
 * A single state transition entry that is JSON-serializable
 */
export interface SerializableStateTransition {
    tick: number;
    from_status: string;
    to_status: string;
    reason: string;
    /** Duration until next transition (computed during serialization) */
    duration_ticks: number;
}

/**
 * A serializable representation of state transitions for a single entity
 */
export interface SerializableEntityStateTransitions {
    /** Entity ID string (e.g., "inserter:1") */
    entity_id: string;
    /** Entity type */
    entity_type: StateTransitionEntityType;
    /** Human-readable label for the entity */
    label: string;
    /** The source entity info (for inserters) */
    source?: {
        entity_id: string;
        label: string;
    };
    /** The sink/target entity info (for inserters, drills) */
    sink?: {
        entity_id: string;
        label: string;
    };
    /** Item names associated with this entity (recipe output for machines, resource for drills, filtered items for inserters) */
    items: string[];
    /** Initial status at start of simulation */
    initial_status: string;
    /** All state transitions for this entity */
    transitions: SerializableStateTransition[];
    /** The state the entity would show in Factorio at the start of the run */
    initial_factorio_state: string;
    /** The state the entity would show in Factorio, each time it changes, with how long it lasts */
    factorio_states: SerializableFactorioState[];
}

export interface SerializableFactorioState {
    tick: number;
    state: string;
    duration_ticks: number;
}

/**
 * The complete serializable state transition history
 */
export interface SerializableStateTransitionHistory {
    /** Total simulation duration in ticks */
    total_duration_ticks: number;
    /** All entity state transition histories */
    entities: SerializableEntityStateTransitions[];
}

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
            label = `Inserter ${entityId.id.split(':')[1]}`;
            
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

            // Get items from inserter filters, or from source/sink if available
            if (entity.filtered_items && entity.filtered_items.size > 0) {
                items = Array.from(entity.filtered_items);
            } else if (sourceEntity && Entity.isMachine(sourceEntity)) {
                items = [sourceEntity.output.item_name];
            } else if (sinkEntity && Entity.isMachine(sinkEntity)) {
                items = Array.from(sinkEntity.inputs.keys());
            }
        } else if (Entity.isMachine(entity)) {
            label = `Machine ${entityId.id.split(':')[1]} (${entity.metadata.recipe.name})`;
            items = [entity.output.item_name];
        } else if (Entity.isDrill(entity)) {
            label = `Drill ${entityId.id.split(':')[1]} (${entity.item.name})`;
            items = [entity.item.name];
            
            const targetEntity = entity_registry.getEntityById(entity.sink_id);
            sink = {
                entity_id: entity.sink_id.id,
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
        return `Machine ${entity.entity_id.id.split(':')[1]} (${entity.metadata.recipe.name})`;
    }
    if (Entity.isBelt(entity)) {
        return `Belt ${entity.entity_id.id.split(':')[1]}`;
    }
    if (Entity.isDrill(entity)) {
        return `Drill ${entity.entity_id.id.split(':')[1]} (${entity.item.name})`;
    }
    if (Entity.isInserter(entity)) {
        return `Inserter ${entity.entity_id.id.split(':')[1]}`;
    }
    return entity.entity_id.id;
}
