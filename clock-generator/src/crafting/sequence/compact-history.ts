// Reading a recorded history needs no simulation, so the browser can take it from the light entry (see light.ts)

import { reasonText } from "../../control-logic/mode/reason-table";
import type { EntityType } from "../../entities/entity-type";
import { FACTORIO_STATE_NAMES, STATUS_NAMES, factorioStateCode, statusCode } from "../../state/status-codes";
import type { StateTransitionEntityType } from "./state-transition-history";
import type { SealedEntityColumns } from "./transition-columns";

/**
 * A single state transition entry that is JSON-serializable
 */
export interface SerializableStateTransition {
    tick: number;
    from_status: string;
    to_status: string;
    reason: string;
    /** Duration until next transition (computed when the transition is read) */
    duration_ticks: number;
}

/** An entity at either end of an inserter or a drill */
export interface HistoryEntityEnd {
    entity_id: string;
    entity_type: EntityType;
    label: string;
}

/** What a history says of an entity besides its transitions */
interface HistoryEntity {
    /** Entity ID string (e.g., "inserter:1") */
    entity_id: string;
    /** Entity type */
    entity_type: StateTransitionEntityType;
    /** Human-readable label for the entity */
    label: string;
    /** The source entity info (for inserters) */
    source?: HistoryEntityEnd;
    /** The sink/target entity info (for inserters, drills) */
    sink?: HistoryEntityEnd;
    /** Item names associated with this entity (recipe output for machines, resource for drills, filtered items for inserters) */
    items: string[];
    /** Initial status at start of simulation */
    initial_status: string;
    /** The state the entity would show in Factorio at the start of the run */
    initial_factorio_state: string;
}

/**
 * A serializable representation of state transitions for a single entity
 */
export interface SerializableEntityStateTransitions extends HistoryEntity {
    /** All state transitions for this entity */
    transitions: SerializableStateTransition[];
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

/** An entity of a recorded history: what the serializable form says of it, and its transitions as sealed columns */
export interface CompactEntityStateTransitions extends HistoryEntity {
    columns: SealedEntityColumns;
}

/**
 * The state transitions of a run, as it recorded them: one sealed copy, which the run, the memo of runs and every
 * result that reads it share. The reasons are numbers of this module's reason table (control-logic/mode/reason-table.ts).
 */
export interface CompactStateTransitionHistory {
    /** Total simulation duration in ticks */
    total_duration_ticks: number;
    /** In the order of the serializable form: machines, inserters, drills, each by entity id */
    entities: CompactEntityStateTransitions[];
}

/**
 * The same, with a table of the reasons of its own, so it reads the same where the reason table is not (on the page,
 * in kept results): the reason numbers count into `reasons`.
 */
export interface PortableStateTransitionHistory extends CompactStateTransitionHistory {
    reasons: string[];
}

function reasonTextOf(history: CompactStateTransitionHistory): (id: number) => string {
    const reasons = (history as Partial<PortableStateTransitionHistory>).reasons;
    return reasons === undefined ? reasonText : id => reasons[id];
}

function transitionsWith(entity: CompactEntityStateTransitions, total_duration_ticks: number, reason: (id: number) => string): SerializableStateTransition[] {
    const columns = entity.columns;
    const count = columns.tick.length;
    const transitions = new Array<SerializableStateTransition>(count);
    for (let index = 0; index < count; index++) {
        const tick = columns.tick[index];
        const next = index + 1 < count ? columns.tick[index + 1] : total_duration_ticks;
        transitions[index] = {
            tick,
            from_status: STATUS_NAMES[columns.from[index]],
            to_status: STATUS_NAMES[columns.to[index]],
            reason: reason(columns.reason[index]),
            duration_ticks: Math.max(0, next - tick),
        };
    }
    return transitions;
}

/** The transitions of an entity of the history, in the order recorded, each with how long it lasts */
export function transitionsOf(history: CompactStateTransitionHistory, entity: CompactEntityStateTransitions): SerializableStateTransition[] {
    return transitionsWith(entity, history.total_duration_ticks, reasonTextOf(history));
}

/** The states the game would show for an entity of the history, each time it changes, with how long it lasts */
export function factorioStatesOf(history: CompactStateTransitionHistory, entity: CompactEntityStateTransitions): SerializableFactorioState[] {
    const { state_tick, state } = entity.columns;
    const count = state_tick.length;
    const states = new Array<SerializableFactorioState>(count);
    for (let index = 0; index < count; index++) {
        const tick = state_tick[index];
        const next = index + 1 < count ? state_tick[index + 1] : history.total_duration_ticks;
        states[index] = { tick, state: FACTORIO_STATE_NAMES[state[index]], duration_ticks: Math.max(0, next - tick) };
    }
    return states;
}

/** The serializable form of a history: an object per transition and per change of the game's state */
export function expandStateTransitionHistory(history: CompactStateTransitionHistory): SerializableStateTransitionHistory {
    const reason = reasonTextOf(history);
    return {
        total_duration_ticks: history.total_duration_ticks,
        entities: history.entities.map(entity => ({
            entity_id: entity.entity_id,
            entity_type: entity.entity_type,
            label: entity.label,
            source: entity.source,
            sink: entity.sink,
            items: entity.items,
            initial_status: entity.initial_status,
            transitions: transitionsWith(entity, history.total_duration_ticks, reason),
            initial_factorio_state: entity.initial_factorio_state,
            factorio_states: factorioStatesOf(history, entity),
        })),
    };
}

/**
 * A history that reads the same without this module's reason table: its reasons renumbered into a table of its own,
 * holding only the texts it gives. The other columns are shared with the history, not copied.
 */
export function toPortable(history: CompactStateTransitionHistory): PortableStateTransitionHistory {
    if ((history as Partial<PortableStateTransitionHistory>).reasons !== undefined) {
        return history as PortableStateTransitionHistory;
    }
    const local_ids = new Map<number, number>();
    const reasons: string[] = [];
    const entities = history.entities.map(entity => {
        const ids = entity.columns.reason;
        const local = new Uint32Array(ids.length);
        for (let index = 0; index < ids.length; index++) {
            const id = ids[index];
            let local_id = local_ids.get(id);
            if (local_id === undefined) {
                local_id = reasons.length;
                local_ids.set(id, local_id);
                reasons.push(reasonText(id));
            }
            local[index] = local_id;
        }
        return { ...entity, columns: { ...entity.columns, reason: local } };
    });
    return { total_duration_ticks: history.total_duration_ticks, entities, reasons };
}

/**
 * The portable form of a serializable history, which reads back as it (the durations are worked out again from the
 * ticks). For histories made by hand, as in the tests of the page.
 */
export function portableFromSerializable(history: SerializableStateTransitionHistory): PortableStateTransitionHistory {
    const reasons: string[] = [];
    const local_ids = new Map<string, number>();
    const idOf = (reason: string) => {
        let id = local_ids.get(reason);
        if (id === undefined) {
            id = reasons.length;
            local_ids.set(reason, id);
            reasons.push(reason);
        }
        return id;
    };
    const entities = history.entities.map(({ transitions, factorio_states, ...entity }) => ({
        ...entity,
        columns: {
            tick: Int32Array.from(transitions, it => it.tick),
            from: Uint8Array.from(transitions, it => statusCode(it.from_status)),
            to: Uint8Array.from(transitions, it => statusCode(it.to_status)),
            reason: Uint32Array.from(transitions, it => idOf(it.reason)),
            state_tick: Int32Array.from(factorio_states, it => it.tick),
            state: Uint8Array.from(factorio_states, it => factorioStateCode(it.state)),
        },
    }));
    return { total_duration_ticks: history.total_duration_ticks, entities, reasons };
}
