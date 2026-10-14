import { EntityType } from "./entity-type";

/**
 * An entity of the config: its type and its id there. `id` is the one string both make, as "inserter:3", for keys of
 * maps and records; read the type and number from the fields, not from that string.
 */
export class EntityId {

    public static forEntity(id: number, type: EntityType): EntityId {
        return new EntityId(`${type}:${id}`, type, id);
    }

    public static forBelt(id: number): EntityId {
        return this.forEntity(id, EntityType.BELT);
    }

    public static forInserter(id: number): EntityId {
        return this.forEntity(id, EntityType.INSERTER);
    }

    public static forMachine(id: number): EntityId {
        return this.forEntity(id, EntityType.MACHINE);
    }

    public static forDrill(id: number): EntityId {
        return this.forEntity(id, EntityType.DRILL);
    }

    public static forChest(id: number): EntityId {
        return this.forEntity(id, EntityType.CHEST);
    }

    public static isInserter(entityId: EntityId): boolean {
        return entityId.type === EntityType.INSERTER;
    }

    public static isBelt(entityId: EntityId): boolean {
        return entityId.type === EntityType.BELT;
    }

    public static isMachine(entityId: EntityId): boolean {
        return entityId.type === EntityType.MACHINE;
    }

    public static isDrill(entityId: EntityId): boolean {
        return entityId.type === EntityType.DRILL;
    }

    public static isChest(entityId: EntityId): boolean {
        return entityId.type === EntityType.CHEST;
    }

    private constructor(
        public readonly id: string,
        public readonly type: EntityType,
        /** The id of the entity in the config */
        public readonly number: number,
    ) { }

    compareTo(other: EntityId): number {
        return this.id.localeCompare(other.id);
    }

    valueOf(): string {
        return this.id;
    }

    toString(): string {
        return this.id;
    }
}