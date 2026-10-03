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
            entity_transitions = {
                entity_id,
                entity_type,
                transitions: [],
            };
            this.set(entity_id, entity_transitions);
        }
        entity_transitions.transitions.push(transition);
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
