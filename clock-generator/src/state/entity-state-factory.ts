import { Entity, EntityId, ReadableEntityRegistry } from "../entities";
import { ContainerStorage } from "../simulation/components/container-storage";
import { TransportBelt } from "../simulation/archetypes/transport-belt";
import { DrillState } from "./drill-state";
import { EntityState } from "./entity-state";
import { InserterState } from "./inserter-state";
import { MachineState } from "./machine-state";

export class EntityStateFactory {

    constructor(
        private readonly entityRegistry: ReadableEntityRegistry,
    ) {}

    createStateForEntity(entityId: EntityId): EntityState {

        const entity = this.entityRegistry.getEntityByIdOrThrow(entityId);

        if(Entity.isBelt(entity)) {
            return TransportBelt.create(entity)
        }

        if(Entity.isMachine(entity)) {
            return MachineState.forMachine(entity);
        }

        if (Entity.isInserter(entity)) {
            return InserterState.createIdle(entity);
        }

        if (Entity.isDrill(entity)) {
            return DrillState.fromEntity(entity);
        }

        if (Entity.isChest(entity)) {
            return ContainerStorage.forChest(entity);
        }

        throw new Error(`Cannot create state for unsupported entity type: ${entity.entity_id.type}`);
    }
}