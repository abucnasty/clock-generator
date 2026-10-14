import assert from "../common/assert"
import { Belt } from "./belt";
import { EntityId } from "./entity-id";
import { Inserter } from "./inserter";
import { Machine } from "./machine";
import { MiningDrill } from "./drill";
import { Chest } from "./chest/chest";

export interface Entity {
    readonly entity_id: EntityId
}

function isInserter(entity: Entity): entity is Inserter {
    return EntityId.isInserter(entity.entity_id);
}

function isMachine(entity: Entity): entity is Machine {
    return EntityId.isMachine(entity.entity_id);
}

function isBelt(entity: Entity): entity is Belt {
    return EntityId.isBelt(entity.entity_id);
}

function isDrill(entity: Entity): entity is MiningDrill {
    return EntityId.isDrill(entity.entity_id);
}

function isChest(entity: Entity): entity is Chest {
    return EntityId.isChest(entity.entity_id);
}

export function assertIsInserter(entity: Entity): asserts entity is Inserter {
    assert(isInserter(entity), `Entity with id ${entity.entity_id} is not an inserter`);
}

export function assertIsMachine(entity: Entity): asserts entity is Machine {
    assert(isMachine(entity), `Entity with id ${entity.entity_id} is not a machine`);
}

export function assertIsBelt(entity: Entity): asserts entity is Belt {
    assert(isBelt(entity), `Entity with id ${entity.entity_id} is not a belt`);
}

export function assertIsChest(entity: Entity): asserts entity is Chest {
    assert(isChest(entity), `Entity with id ${entity.entity_id} is not a chest`);
}

export const Entity = {
    isInserter: isInserter,
    isMachine: isMachine,
    isBelt: isBelt,
    isDrill: isDrill,
    isChest: isChest,
};