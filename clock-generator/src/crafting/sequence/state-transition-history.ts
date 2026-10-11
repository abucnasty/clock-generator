import { MapExtended } from "../../data-types";
import { EntityId } from "../../entities";
import { DrillStatus, InserterStatus, MachineStatus } from "../../state";

/**
 * Union type representing any entity status
 */
export type EntityStatus = InserterStatus | MachineStatus | DrillStatus;

/**
 * Entity type discriminator for state transitions
 */
export type StateTransitionEntityType = 'inserter' | 'machine' | 'drill';

/**
 * Represents a single state transition for any entity type
 */
export interface StateTransition {
    tick: number;
    from_status: EntityStatus;
    to_status: EntityStatus;
    reason: string;
}

/**
 * Collection of state transitions for a single entity
 */
export interface EntityStateTransitions {
    entity_id: EntityId;
    entity_type: StateTransitionEntityType;
    transitions: StateTransition[];
    /** The state the entity would show in Factorio, each time it changes */
    factorio_states: FactorioStateChange[];
}

/** A change of the state an entity would show in Factorio */
export interface FactorioStateChange {
    tick: number;
    state: string;
}

/**
 * History of state transitions for all entities, keyed by EntityId.
 * Similar to InventoryTransferHistory but for state transitions.
 */
export class StateTransitionHistory extends MapExtended<EntityId, EntityStateTransitions> {
    
    constructor(entries?: readonly (readonly [EntityId, EntityStateTransitions])[] | null) {
        super(entries);
    }

    /** Off during prepare and warmup, whose transitions are cleared before the measured run anyway */
    public recording = true;

    /**
     * Record a state transition for an entity
     */
    public recordTransition(
        entity_id: EntityId,
        entity_type: StateTransitionEntityType,
        transition: StateTransition
    ): void {
        if (!this.recording) {
            return;
        }
        let entity_transitions = this.get(entity_id);
        if (!entity_transitions) {
            entity_transitions = this.entryFor(entity_id, entity_type);
        }
        entity_transitions.transitions.push(transition);
    }

    private entryFor(entity_id: EntityId, entity_type: StateTransitionEntityType): EntityStateTransitions {
        const entry: EntityStateTransitions = { entity_id, entity_type, transitions: [], factorio_states: [] };
        this.set(entity_id, entry);
        return entry;
    }

    /** Record the state an entity would show in Factorio from this tick on */
    public recordFactorioState(entity_id: EntityId, entity_type: StateTransitionEntityType, change: FactorioStateChange): void {
        if (!this.recording) {
            return;
        }
        const entity_transitions = this.get(entity_id) ?? this.entryFor(entity_id, entity_type);
        entity_transitions.factorio_states.push(change);
    }

    public createFactorioStateCallback(entity_type: StateTransitionEntityType): (change: { entity_id: EntityId; tick: number; state: string }) => void {
        return (change) => this.recordFactorioState(change.entity_id, entity_type, { tick: change.tick, state: change.state });
    }

    /**
     * Create a callback function for recording inserter transitions
     */
    public createInserterCallback(): (transition: { entity_id: EntityId; tick: number; from_status: InserterStatus; to_status: InserterStatus; reason: string }) => void {
        return (transition) => {
            this.recordTransition(
                transition.entity_id,
                'inserter',
                {
                    tick: transition.tick,
                    from_status: transition.from_status,
                    to_status: transition.to_status,
                    reason: transition.reason,
                }
            );
        };
    }

    /**
     * Create a callback function for recording machine transitions
     */
    public createMachineCallback(): (transition: { entity_id: EntityId; tick: number; from_status: MachineStatus; to_status: MachineStatus; reason: string }) => void {
        return (transition) => {
            this.recordTransition(
                transition.entity_id,
                'machine',
                {
                    tick: transition.tick,
                    from_status: transition.from_status,
                    to_status: transition.to_status,
                    reason: transition.reason,
                }
            );
        };
    }

    /**
     * Create a callback function for recording drill transitions
     */
    public createDrillCallback(): (transition: { entity_id: EntityId; tick: number; from_status: DrillStatus; to_status: DrillStatus; reason: string }) => void {
        return (transition) => {
            this.recordTransition(
                transition.entity_id,
                'drill',
                {
                    tick: transition.tick,
                    from_status: transition.from_status,
                    to_status: transition.to_status,
                    reason: transition.reason,
                }
            );
        };
    }

    /**
     * Get all entity transitions
     */
    public getAllTransitions(): Map<EntityId, EntityStateTransitions> {
        return new Map(this.entries());
    }

    /**
     * Clear all recorded transitions
     */
    public clear(): void {
        super.clear();
    }
}
