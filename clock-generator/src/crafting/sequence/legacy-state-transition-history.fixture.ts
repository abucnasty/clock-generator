/**
 * The state transition history as it was recorded before it went into columns: an object per transition, kept in a
 * map per entity, and serialized into the objects every reader took. Kept for the tests only, as what a history read
 * back from its columns has to equal (see state-transition-history.test.ts).
 */
import { MapExtended } from "../../data-types";
import { Entity, EntityId, ReadableEntityRegistry } from "../../entities";
import { chestName } from "../../common/entity-types";
import { TickProvider } from "../../control-logic/current-tick-provider";
import { reasonText } from "../../control-logic/mode/reason-table";
import { FactorioStateTracker } from "../../simulation/observers/factorio-state-tracker";
import type { StatusChangeReason } from "../../simulation/observers/observer";
import { StateTransitionTracker } from "../../simulation/observers/state-transition-tracker";
import { EntityStatus, EntityTransitionRecorder, StateTransitionEntityType, StateTransitionHistory } from "./state-transition-history";
import type {
    CompactStateTransitionHistory,
    SerializableEntityStateTransitions,
    SerializableFactorioState,
    SerializableStateTransition,
    SerializableStateTransitionHistory,
} from "./compact-history";

interface StateTransition {
    tick: number;
    from_status: EntityStatus;
    to_status: EntityStatus;
    reason: string;
}
interface EntityStateTransitions {
    entity_id: EntityId;
    entity_type: StateTransitionEntityType;
    transitions: StateTransition[];
    /** The state the entity would show in Factorio, each time it changes */
    factorio_states: FactorioStateChange[];
}
interface FactorioStateChange {
    tick: number;
    state: string;
}

export class LegacyStateTransitionHistory extends MapExtended<EntityId, EntityStateTransitions> {
    /** Off during prepare and warmup, whose transitions are cleared before the measured run anyway */
    public recording = true;

    public recordTransition(entity_id: EntityId, entity_type: StateTransitionEntityType, transition: StateTransition): void {
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

    public recordFactorioState(entity_id: EntityId, entity_type: StateTransitionEntityType, change: FactorioStateChange): void {
        if (!this.recording) {
            return;
        }
        const entity_transitions = this.get(entity_id) ?? this.entryFor(entity_id, entity_type);
        entity_transitions.factorio_states.push(change);
    }

    public getAllTransitions(): Map<EntityId, EntityStateTransitions> {
        return new Map(this.entries());
    }
}

/**
 * Convert a StateTransitionHistory to a serializable format suitable for JSON
 */
export function serializeStateTransitionHistory(
    history: LegacyStateTransitionHistory,
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

/** What a sealed history was, and what the object-per-transition history recorded beside it serialized to */
export interface RecordedBothWays {
    sealed: CompactStateTransitionHistory;
    legacy: SerializableStateTransitionHistory;
}

/** The parts of the trackers the mirror reads */
interface TrackerInternals {
    tick_provider: TickProvider;
    recorder: EntityTransitionRecorder;
}
interface StateTransitionInternals extends TrackerInternals {
    status_of: (code: number) => EntityStatus;
}
interface FactorioStateInternals extends TrackerInternals {
    last_state: string | null;
}

/**
 * Until `restore` is called, every state transition history also records into an object-per-transition history, from
 * the same tracker calls, with the same recording switch and clears; each time a history is sealed, `seen` is called
 * with the sealed history and the other one serialized as it used to be. The trackers and the history are patched on
 * their prototypes, so it reaches every run however it is started.
 */
export function recordBothWays(seen: (recorded: RecordedBothWays) => void): { restore: () => void } {
    const legacies = new WeakMap<StateTransitionHistory, LegacyStateTransitionHistory>();
    const legacyOf = (history: StateTransitionHistory) => {
        let legacy = legacies.get(history);
        if (legacy === undefined) {
            legacy = new LegacyStateTransitionHistory();
            legacies.set(history, legacy);
        }
        legacy.recording = history.recording;
        return legacy;
    };
    const restores: (() => void)[] = [];
    const patch = <T extends object, K extends keyof T>(target: T, key: K, replacement: (original: T[K]) => T[K]) => {
        const original = target[key];
        target[key] = replacement(original);
        restores.push(() => { target[key] = original; });
    };

    // an inserter, a machine or a drill tells its observers of a change by its status codes and what answers its reason;
    // the tracker names the statuses with its kind's function and asks for the reason while its history records
    const tracker = StateTransitionTracker.prototype as unknown as { onStatusChange(from: number, to: number, reason: StatusChangeReason<number>): void };
    patch(tracker, "onStatusChange", original => function (this: StateTransitionInternals, from: number, to: number, reason: StatusChangeReason<number>) {
        const { recorder } = this;
        if (recorder.history.recording) {
            legacyOf(recorder.history).recordTransition(recorder.entity_id, recorder.entity_type, {
                tick: this.tick_provider.getCurrentTick(),
                from_status: this.status_of(from),
                to_status: this.status_of(to),
                reason: reasonText(reason.reasonId(from, to)),
            });
        }
        original.call(this, from, to, reason);
    });
    const factorio_state = FactorioStateTracker.prototype as unknown as { onTick(): void };
    patch(factorio_state, "onTick", original => function (this: FactorioStateInternals) {
        const before = this.last_state;
        original.call(this);
        if (this.last_state !== before && this.last_state !== null) {
            const { recorder } = this;
            legacyOf(recorder.history).recordFactorioState(recorder.entity_id, recorder.entity_type,
                { tick: this.tick_provider.getCurrentTick(), state: this.last_state });
        }
    });
    patch(StateTransitionHistory.prototype, "clear", original => function (this: StateTransitionHistory) {
        legacyOf(this).clear();
        original.call(this);
    });
    patch(StateTransitionHistory.prototype, "seal", original => function (this: StateTransitionHistory, registry: ReadableEntityRegistry, total_duration_ticks: number) {
        const legacy = serializeStateTransitionHistory(legacyOf(this), registry, total_duration_ticks);
        // nothing is recorded after the seal
        legacies.delete(this);
        const sealed = original.call(this, registry, total_duration_ticks);
        seen({ sealed, legacy });
        return sealed;
    });
    return { restore: () => restores.reverse().forEach(it => it()) };
}

/**
 * Where two serializable histories differ first, or null when they are equal: members that are undefined count as
 * missing. A history of millions of transitions is compared without making anything of that size.
 */
export function historyDifference(expected: SerializableStateTransitionHistory, actual: SerializableStateTransitionHistory): string | null {
    const differs = (path: string, a: unknown, b: unknown): string | null => {
        if (a === b) return null;
        if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
            return `${path}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`;
        }
        if (Array.isArray(a) !== Array.isArray(b)) return `${path}: one is an array`;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return `${path}: expected ${a.length} entries, got ${b.length}`;
            for (let index = 0; index < a.length; index++) {
                const found = differs(`${path}[${index}]`, a[index], b[index]);
                if (found !== null) return found;
            }
            return null;
        }
        const record_a = a as Record<string, unknown>;
        const record_b = b as Record<string, unknown>;
        const keys = new Set([...Object.keys(record_a), ...Object.keys(record_b)]);
        for (const key of keys) {
            const found = differs(`${path}.${key}`, record_a[key], record_b[key]);
            if (found !== null) return found;
        }
        return null;
    };
    return differs("history", expected, actual);
}
