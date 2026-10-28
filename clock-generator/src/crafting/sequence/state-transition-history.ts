import { chestName } from "../../common/entity-types";
import { Entity, EntityId, ReadableEntityRegistry } from "../../entities";
import { DrillStatus, InserterStatus, MachineStatus } from "../../state/entity-status";
import { FACTORIO_STATE_NAMES, STATUS_NAMES, factorioStateCode, statusCode } from "../../state/status-codes";
import type { CompactEntityStateTransitions, CompactStateTransitionHistory, HistoryEntityEnd } from "./compact-history";
import { EntityTransitionColumns } from "./transition-columns";

/**
 * Union type representing any entity status
 */
export type EntityStatus = InserterStatus | MachineStatus | DrillStatus;

/**
 * Entity type discriminator for state transitions
 */
export type StateTransitionEntityType = 'inserter' | 'machine' | 'drill';

/**
 * What one entity records into the history: its state transitions and each change of the state the game would show.
 * The entity's observers call it; nothing is kept while the history does not record.
 */
export class EntityTransitionRecorder {
    /** Recorded something since the history was last cleared, and so listed in it */
    listed = false;
    readonly columns = new EntityTransitionColumns();

    constructor(
        readonly history: StateTransitionHistory,
        readonly entity_id: EntityId,
        readonly entity_type: StateTransitionEntityType,
    ) { }

    recordTransition(tick: number, from_status: EntityStatus, to_status: EntityStatus, reason_id: number): void {
        if (!this.history.recording) {
            return;
        }
        if (!this.listed) {
            this.history.list(this);
        }
        this.columns.push(tick, statusCode(from_status), statusCode(to_status), reason_id);
    }

    /** Record the state the entity would show in Factorio from this tick on */
    recordFactorioState(tick: number, state: string): void {
        if (!this.history.recording) {
            return;
        }
        if (!this.listed) {
            this.history.list(this);
        }
        this.columns.pushState(tick, factorioStateCode(state));
    }
}

const TYPE_ORDER: Record<StateTransitionEntityType, number> = {
    machine: 0,
    inserter: 1,
    drill: 2,
};

/**
 * History of the state transitions of every entity of a run, recorded into columns (see transition-columns.ts) and
 * sealed once when the recorded run ends.
 */
export class StateTransitionHistory {
    /** Off during prepare and warmup, whose transitions are cleared before the measured run anyway */
    public recording = true;

    private readonly recorders: EntityTransitionRecorder[] = [];
    /** The recorders that recorded something since the last clear, in the order they first did */
    private listed: EntityTransitionRecorder[] = [];

    /** The recorder of an entity, made when its observers are attached; it is listed once it records something */
    recorderFor(entity_id: EntityId, entity_type: StateTransitionEntityType): EntityTransitionRecorder {
        const recorder = new EntityTransitionRecorder(this, entity_id, entity_type);
        this.recorders.push(recorder);
        return recorder;
    }

    /** Called by a recorder the first time it records after a clear */
    list(recorder: EntityTransitionRecorder): void {
        recorder.listed = true;
        this.listed.push(recorder);
    }

    /**
     * Clear all recorded transitions
     */
    public clear(): void {
        for (const recorder of this.listed) {
            recorder.columns.clear();
            recorder.listed = false;
        }
        this.listed = [];
    }

    /**
     * What the run recorded, sealed: every entity that recorded something and that the registry knows, machines first,
     * then inserters, then drills, each by entity id, with its labels and its columns copied at their exact length.
     * The history records nothing after it, and gives back the room it recorded in.
     */
    public seal(entity_registry: ReadableEntityRegistry, total_duration_ticks: number): CompactStateTransitionHistory {
        const entities: CompactEntityStateTransitions[] = [];
        for (const recorder of this.listed) {
            const entity = entity_registry.getEntityById(recorder.entity_id);
            if (!entity) {
                continue;
            }
            const columns = recorder.columns.seal();
            entities.push({
                ...describedEntity(entity, recorder.entity_id, entity_registry),
                entity_type: recorder.entity_type,
                // the first transition's from_status, or unknown with no transitions
                initial_status: columns.from.length > 0 ? STATUS_NAMES[columns.from[0]] : 'UNKNOWN',
                initial_factorio_state: columns.state.length > 0 ? FACTORIO_STATE_NAMES[columns.state[0]] : "unknown",
                columns,
            });
        }
        entities.sort((a, b) => {
            const typeComparison = TYPE_ORDER[a.entity_type] - TYPE_ORDER[b.entity_type];
            if (typeComparison !== 0) {
                return typeComparison;
            }
            return a.entity_id.localeCompare(b.entity_id);
        });
        this.recording = false;
        this.listed = [];
        for (const recorder of this.recorders) {
            recorder.listed = false;
            recorder.columns.release();
        }
        return { total_duration_ticks, entities };
    }
}

/** The labels of an entity of a history, and the items it is about */
function describedEntity(entity: Entity, entity_id: EntityId, entity_registry: ReadableEntityRegistry):
    Pick<CompactEntityStateTransitions, "entity_id" | "label" | "source" | "sink" | "items"> {
    let label: string;
    let source: HistoryEntityEnd | undefined;
    let sink: HistoryEntityEnd | undefined;
    let items: string[] = [];

    if (Entity.isInserter(entity)) {
        label = `Inserter ${entity_id.number}`;

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
        label = `Machine ${entity_id.number} (${entity.metadata.recipe.name})`;
        items = [entity.output.item_name];
    } else if (Entity.isDrill(entity)) {
        label = `Drill ${entity_id.number} (${entity.item.name})`;
        items = [entity.item.name];

        const targetEntity = entity_registry.getEntityById(entity.sink_id);
        sink = {
            entity_id: entity.sink_id.id,
            entity_type: entity.sink_id.type,
            label: targetEntity ? getEntityLabel(targetEntity) : entity.sink_id.id,
        };
    } else {
        label = entity_id.id;
    }
    return { entity_id: entity_id.id, label, source, sink, items };
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
